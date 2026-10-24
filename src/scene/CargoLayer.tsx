import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  LineBasicMaterial,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type InstancedMesh,
} from 'three';
import { hazmatColor } from '../domain/colors';
import { footprintOverlap, type Box } from '../domain/geometry';
import type { CargoUnit, Customer, Id, Orientation, Stop, UnitSystem } from '../domain/types';
import { formatDims, formatWeight } from '../domain/units';
import { boxToThree, setThree, toThree } from './coords';
import { GOODS_FILM, GOODS_SOLID, GOODS_TAG, goodsModelFor, useRetainGoods } from './goods/cache';
import type { GoodsModel } from './goods/model';
import { goodsInstanceMatrix } from './goods/orientation';
import { SceneLabel } from './labels';
import { UNIT_BOX, UNIT_CYLINDER, UNIT_PALLET, UNIT_PLANE } from './materials';
import { unitColor, type ColorContext } from './palette';
import { fragileTexture, hazmatTexture } from './textures';
import type { CargoLook } from './sceneUi';
import { axisAlignedTransform, edgeSegmentCount, PALLET_SHADE, unitParts, writePartEdges } from './unitParts';

/** One unit to draw: its cargo-space box (inside the vehicle or on the dock) and orientation. */
export interface CargoItem {
  unit: CargoUnit;
  orient: Orientation;
  box: Box;
}

export interface CargoHighlights {
  selected: ReadonlySet<Id>;
  /** Hovered in the table or the scene. */
  hover: Id | null;
  /** Top contributors to the hovered axle group. */
  axle: ReadonlySet<Id>;
}

export interface CargoTween {
  /** Identity of the tween; a new key restarts it. */
  key: object;
  /** Start boxes of the units that move. */
  from: ReadonlyMap<Id, Box>;
}

const TWEEN_MS = 650;
const HIGHLIGHT_COLORS = { selected: new Color('#f59e0b'), hover: new Color('#1d1d1b'), axle: new Color('#2563eb') };
const HULL_PAD = 0.05;
const WHITE = new Color('#ffffff');

const bodyMaterial = new MeshStandardMaterial({ roughness: 0.78, metalness: 0.02 });
const hullMaterial = new MeshBasicMaterial({ side: BackSide });
const edgeMaterial = new LineBasicMaterial({ color: '#1d1d1b', transparent: true, opacity: 0.32 });
const markerMaterials = new Map<string, MeshBasicMaterial>();

function markerMaterial(key: string): MeshBasicMaterial {
  let m = markerMaterials.get(key);
  if (!m) {
    const hazClass = key.startsWith('haz:') ? key.slice(4) : null;
    m = new MeshBasicMaterial({ map: hazClass ? hazmatTexture(hazClass, hazmatColor(hazClass)) : fragileTexture(), transparent: true, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -4 });
    markerMaterials.set(key, m);
  }
  return m;
}

const capacityFor = (n: number): number => Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, n))));

// Scratch objects (no per-frame allocation in the hot paths).
const sPos = new Vector3();
const sQuat = new Quaternion();
const sScale = new Vector3();
const sMat = new Matrix4();
const sColor = new Color();
const Q_TOP = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
const Q_REAR = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
/** Plane facing +Z three = the unit's left face (cargo -y); also the identity for hull boxes. */
const Q_IDENTITY = new Quaternion();

interface GoodsGroup {
  key: string;
  model: GoodsModel;
  /** Item index of every instance. */
  items: number[];
}

interface Structure {
  /** Blocks look: item index of every instance, per mesh. */
  box: number[];
  cyl: number[];
  pallet: number[];
  segments: number;
  /** Realistic look: one instanced model per distinct goods geometry. */
  goods: GoodsGroup[];
  /** Marker groups: texture key -> item indices (hazmat diamond / fragile glyph). */
  markers: { key: string; slot: (i: number) => number; items: number[] }[];
}

function buildStructure(items: readonly CargoItem[], look: CargoLook): Structure {
  const s: Structure = { box: [], cyl: [], pallet: [], segments: 0, goods: [], markers: [] };
  const markerItems = new Map<string, number[]>();
  const goods = new Map<string, GoodsGroup>();
  const both = new Set<number>();
  items.forEach((it, i) => {
    if (look === 'realistic') {
      const model = goodsModelFor(it.unit.spec);
      const group = goods.get(model.key);
      if (group) group.items.push(i);
      else goods.set(model.key, { key: model.key, model, items: [i] });
    } else {
      for (const p of unitParts(it.unit.spec, it.orient, it.box)) {
        (p.kind === 'pallet' ? s.pallet : p.kind === 'cylinder' ? s.cyl : s.box).push(i);
        s.segments += edgeSegmentCount(p);
      }
    }
    const haz = it.unit.spec.hazmat?.hazClass;
    if (haz) markerItems.set(`haz:${haz}`, [...(markerItems.get(`haz:${haz}`) ?? []), i]);
    if (it.unit.spec.fragile) markerItems.set('fragile', [...(markerItems.get('fragile') ?? []), i]);
    if (haz && it.unit.spec.fragile) both.add(i);
  });
  s.goods = [...goods.values()];
  for (const [key, list] of markerItems) {
    const side = key === 'fragile' ? 1 : -1;
    s.markers.push({ key, items: list, slot: (i) => (both.has(i) ? side : 0) });
  }
  return s;
}

interface GoodsMeshes {
  solid?: InstancedMesh;
  tag?: InstancedMesh;
  film?: InstancedMesh;
}

/** Interpolated box (writes into `out`). */
function lerpBox(a: Box, b: Box, t: number, out: Box): Box {
  out.min.x = a.min.x + (b.min.x - a.min.x) * t;
  out.min.y = a.min.y + (b.min.y - a.min.y) * t;
  out.min.z = a.min.z + (b.min.z - a.min.z) * t;
  out.max.x = a.max.x + (b.max.x - a.max.x) * t;
  out.max.y = a.max.y + (b.max.y - a.max.y) * t;
  out.max.z = a.max.z + (b.max.z - a.max.z) * t;
  return out;
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface CargoLayerProps {
  items: CargoItem[];
  colors: ColorContext;
  highlights: CargoHighlights;
  tween: CargoTween | null;
  /** Context for the hover tooltip. */
  stops: Stop[];
  customers: Customer[];
  units: UnitSystem;
  /** Pointer pressed on a unit (left button). */
  onUnitPointerDown: (unitId: Id, event: ThreeEvent<PointerEvent>) => void;
  onUnitHover: (unitId: Id | null) => void;
  /** Hover tooltips and pointer handling are suspended (e.g. while dragging). */
  suspended: boolean;
  look: CargoLook;
}

/** All cargo units as instanced meshes: realistic goods or blocks, plus outlines, highlights and markers. */
export const CargoLayer = memo(function CargoLayer(props: CargoLayerProps) {
  const { items, colors, highlights, tween, onUnitPointerDown, onUnitHover, suspended, look } = props;
  const structure = useMemo(() => buildStructure(items, look), [items, look]);
  useRetainGoods(structure.goods.map((g) => g.key));
  const goodsRefs = useRef(new Map<string, GoodsMeshes>());
  const boxRef = useRef<InstancedMesh>(null);
  const cylRef = useRef<InstancedMesh>(null);
  const palletRef = useRef<InstancedMesh>(null);
  const hullRef = useRef<InstancedMesh>(null);
  const markerRefs = useRef(new Map<string, InstancedMesh>());
  const tweenRef = useRef<{ start: number; from: ReadonlyMap<Id, Box> } | null>(null);
  const scratch = useRef<Box>({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } });

  const hull = useMemo(() => {
    const list: { item: number; color: Color }[] = [];
    items.forEach((it, i) => {
      const id = it.unit.id;
      if (highlights.selected.has(id)) list.push({ item: i, color: HIGHLIGHT_COLORS.selected });
      else if (highlights.hover === id) list.push({ item: i, color: HIGHLIGHT_COLORS.hover });
      else if (highlights.axle.has(id)) list.push({ item: i, color: HIGHLIGHT_COLORS.axle });
    });
    return list;
  }, [items, highlights]);

  const edgeCapacity = capacityFor(structure.segments);
  const edgeGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(edgeCapacity * 6), 3));
    return g;
  }, [edgeCapacity]);
  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry]);

  /** Writes every transform (bodies, pallets, outlines, hulls, markers) at tween progress `t`. */
  const write = useCallback(
    (t: number) => {
      const from = tweenRef.current?.from;
      const boxAt = (i: number): Box => {
        const it = items[i];
        const start = t < 1 ? from?.get(it.unit.id) : undefined;
        return start ? lerpBox(start, it.box, t, scratch.current) : it.box;
      };
      const meshes = { box: boxRef.current, cylinder: cylRef.current, pallet: palletRef.current };
      const counters = { box: 0, cylinder: 0, pallet: 0 };
      const edgeAttr = edgeGeometry.getAttribute('position') as BufferAttribute;
      const edgeArr = edgeAttr.array as Float32Array;
      let offset = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        for (const part of unitParts(it.unit.spec, it.orient, boxAt(i))) {
          axisAlignedTransform(part.box, part.axis, sPos, sQuat, sScale);
          sMat.compose(sPos, sQuat, sScale);
          meshes[part.kind]?.setMatrixAt(counters[part.kind]++, sMat);
          offset = writePartEdges(edgeArr, offset, part);
        }
      }
      for (const mesh of Object.values(meshes)) {
        if (!mesh) continue;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      for (const g of structure.goods) {
        const m = goodsRefs.current.get(g.key);
        if (!m) continue;
        g.items.forEach((i, k) => {
          const it = items[i];
          goodsInstanceMatrix(it.orient, it.unit.spec.dims, boxAt(i).min, sMat);
          m.solid?.setMatrixAt(k, sMat);
          m.tag?.setMatrixAt(k, sMat);
          m.film?.setMatrixAt(k, sMat);
        });
        for (const mesh of [m.solid, m.tag, m.film]) {
          if (!mesh) continue;
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        }
      }
      edgeAttr.needsUpdate = true;
      edgeGeometry.setDrawRange(0, offset / 3);

      const hullMesh = hullRef.current;
      if (hullMesh) {
        hull.forEach((h, k) => {
          const b = boxAt(h.item);
          boxToThree(b, sPos, sScale);
          sScale.addScalar(HULL_PAD * 2);
          sMat.compose(sPos, Q_IDENTITY, sScale);
          hullMesh.setMatrixAt(k, sMat);
        });
        hullMesh.instanceMatrix.needsUpdate = true;
      }

      for (const group of structure.markers) {
        const mesh = markerRefs.current.get(group.key);
        if (!mesh) continue;
        let k = 0;
        for (const i of group.items) {
          const b = boxAt(i);
          const sx = b.max.x - b.min.x;
          const sy = b.max.y - b.min.y;
          const sz = b.max.z - b.min.z;
          const size = Math.min(0.42, Math.max(0.12, 0.42 * Math.min(sx, sy, sz)));
          const off = group.slot(i) * size * 0.55;
          const cx = (b.min.x + b.max.x) / 2;
          const cy = (b.min.y + b.max.y) / 2;
          const upper = b.max.z - size * 0.7;
          sScale.set(size, size, 1);
          setThree(sPos, cx + off, b.min.y - 0.006, upper);
          mesh.setMatrixAt(k++, sMat.compose(sPos, Q_IDENTITY, sScale));
          setThree(sPos, cx + off, cy, b.max.z + 0.006);
          mesh.setMatrixAt(k++, sMat.compose(sPos, Q_TOP, sScale));
          setThree(sPos, b.max.x + 0.006, cy + off, upper);
          mesh.setMatrixAt(k++, sMat.compose(sPos, Q_REAR, sScale));
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    [items, edgeGeometry, hull, structure],
  );

  useLayoutEffect(() => {
    tweenRef.current = tween ? { start: performance.now(), from: tween.from } : null;
  }, [tween]);

  useLayoutEffect(() => {
    const tw = tweenRef.current;
    write(tw ? easeInOut(Math.min(1, (performance.now() - tw.start) / TWEEN_MS)) : 1);
  }, [write]);

  useFrame(() => {
    const tw = tweenRef.current;
    if (!tw) return;
    const p = Math.min(1, (performance.now() - tw.start) / TWEEN_MS);
    write(easeInOut(p));
    if (p >= 1) tweenRef.current = null;
  });

  // Per-instance colours.
  useLayoutEffect(() => {
    const paint = (mesh: InstancedMesh | null, indices: number[], shade: number) => {
      if (!mesh) return;
      indices.forEach((itemIndex, k) => {
        const it = items[itemIndex];
        sColor.set(unitColor(it.unit, colors));
        if (highlights.hover === it.unit.id || highlights.axle.has(it.unit.id)) sColor.lerp(WHITE, 0.28);
        sColor.multiplyScalar(shade);
        mesh.setColorAt(k, sColor);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    paint(boxRef.current, structure.box, 1);
    paint(cylRef.current, structure.cyl, 1);
    paint(palletRef.current, structure.pallet, PALLET_SHADE);
    for (const g of structure.goods) paint(goodsRefs.current.get(g.key)?.tag ?? null, g.items, 1);
    const hullMesh = hullRef.current;
    if (hullMesh) {
      hull.forEach((h, k) => hullMesh.setColorAt(k, h.color));
      if (hullMesh.instanceColor) hullMesh.instanceColor.needsUpdate = true;
    }
  }, [items, structure, colors, highlights, hull]);

  // Pointer handling: resolve instance -> unit.
  const [hovered, setHovered] = useState<Id | null>(null);
  const hoveredRef = useRef<Id | null>(null);
  const idOf = useCallback((indices: number[], e: ThreeEvent<PointerEvent>): Id | null => (e.instanceId === undefined ? null : (items[indices[e.instanceId]]?.unit.id ?? null)), [items]);
  const setHover = useCallback(
    (id: Id | null) => {
      if (hoveredRef.current === id) return;
      hoveredRef.current = id;
      setHovered(id);
      onUnitHover(id);
    },
    [onUnitHover],
  );
  useEffect(() => {
    if (suspended) setHover(null);
  }, [suspended, setHover]);
  const handlers = (indices: number[]) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!suspended) setHover(idOf(indices, e));
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      if (idOf(indices, e) === hoveredRef.current) setHover(null);
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const id = idOf(indices, e);
      if (id) onUnitPointerDown(id, e);
    },
  });

  const hoveredItem = hovered && !suspended ? items.find((it) => it.unit.id === hovered) : undefined;

  return (
    <group>
      {structure.box.length > 0 && (
        <instancedMesh key={`b${capacityFor(structure.box.length)}`} ref={boxRef} args={[UNIT_BOX, bodyMaterial, capacityFor(structure.box.length)]} count={structure.box.length} {...handlers(structure.box)} />
      )}
      {structure.cyl.length > 0 && (
        <instancedMesh key={`c${capacityFor(structure.cyl.length)}`} ref={cylRef} args={[UNIT_CYLINDER, bodyMaterial, capacityFor(structure.cyl.length)]} count={structure.cyl.length} {...handlers(structure.cyl)} />
      )}
      {structure.pallet.length > 0 && (
        <instancedMesh key={`p${capacityFor(structure.pallet.length)}`} ref={palletRef} args={[UNIT_PALLET, bodyMaterial, capacityFor(structure.pallet.length)]} count={structure.pallet.length} {...handlers(structure.pallet)} />
      )}
      {look === 'blocks' && <lineSegments geometry={edgeGeometry} material={edgeMaterial} frustumCulled={false} />}
      {structure.goods.map((g) => {
        const cap = capacityFor(g.items.length);
        const register = (layer: keyof GoodsMeshes) => (mesh: InstancedMesh | null) => {
          const entry = goodsRefs.current.get(g.key) ?? {};
          if (mesh) entry[layer] = mesh;
          else delete entry[layer];
          goodsRefs.current.set(g.key, entry);
        };
        return (
          <group key={`${g.key}#${cap}`}>
            <instancedMesh ref={register('solid')} args={[g.model.solid, GOODS_SOLID, cap]} count={g.items.length} castShadow receiveShadow {...handlers(g.items)} />
            {g.model.tags && <instancedMesh ref={register('tag')} args={[g.model.tags, GOODS_TAG, cap]} count={g.items.length} castShadow {...handlers(g.items)} />}
            {g.model.film && <instancedMesh ref={register('film')} args={[g.model.film, GOODS_FILM, cap]} count={g.items.length} raycast={() => undefined} />}
          </group>
        );
      })}
      {hull.length > 0 && <instancedMesh key={`h${capacityFor(hull.length)}`} ref={hullRef} args={[UNIT_BOX, hullMaterial, capacityFor(hull.length)]} count={hull.length} frustumCulled={false} />}
      {structure.markers.map((g) => (
        <instancedMesh
          key={`${g.key}:${capacityFor(g.items.length * 3)}`}
          ref={(mesh) => {
            if (mesh) markerRefs.current.set(g.key, mesh);
            else markerRefs.current.delete(g.key);
          }}
          args={[UNIT_PLANE, markerMaterial(g.key), capacityFor(g.items.length * 3)]}
          count={g.items.length * 3}
          frustumCulled={false}
        />
      ))}
      {hoveredItem && <UnitTooltip item={hoveredItem} items={items} stops={props.stops} customers={props.customers} units={props.units} />}
    </group>
  );
});

function UnitTooltip({ item, items, stops, customers, units }: { item: CargoItem; items: CargoItem[]; stops: Stop[]; customers: Customer[]; units: UnitSystem }) {
  const { spec } = item.unit;
  const b = item.box;
  const stop = stops.find((s) => s.id === item.unit.stopId);
  const customer = customers.find((c) => c.id === stop?.customerId);
  let onTop = 0;
  for (const other of items) {
    if (other !== item && other.box.min.z >= b.max.z - 0.02 && footprintOverlap(other.box, b) > 1e-4) onTop += other.unit.spec.weightKg;
  }
  const loadLine = spec.fragile
    ? `${formatWeight(onTop, units)} · fragile, nothing on top`
    : spec.stackable
      ? `${formatWeight(onTop, units)} / ${formatWeight(spec.maxLoadOnTopKg, units)}`
      : `${formatWeight(onTop, units)} · not stackable`;
  return (
    <SceneLabel position={toThree((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z + 0.1)} zIndex={40}>
      <div className="w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-card/95 px-2.5 py-2 text-xs shadow-card">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: customer?.color }} />
          <span className="truncate">{spec.name}</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted">
          <dt>Dims</dt>
          <dd className="num font-mono text-ink-soft">{formatDims(spec.dims, units)}</dd>
          <dt>Weight</dt>
          <dd className="num font-mono text-ink-soft">{formatWeight(spec.weightKg, units)}</dd>
          <dt>Stop</dt>
          <dd className="text-ink-soft">{stop ? `${stop.sequence} · ${customer?.name ?? stop.name}` : 'No stop'}</dd>
          <dt>Load on top</dt>
          <dd className="num font-mono text-ink-soft">{loadLine}</dd>
          {spec.hazmat && (
            <>
              <dt>Hazmat</dt>
              <dd className="text-ink-soft">
                {spec.hazmat.unNumber} · class {spec.hazmat.hazClass}
              </dd>
            </>
          )}
        </dl>
      </div>
    </SceneLabel>
  );
}
