import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, type Group } from 'three';
import type { Box } from '../domain/geometry';
import type { ItemSpec, Orientation } from '../domain/types';
import { GOODS_FILM, GOODS_SOLID, GOODS_TAG, goodsModelFor, useRetainGoods } from './goods/cache';
import { goodsInstanceMatrix } from './goods/orientation';
import { UNIT_BOX, UNIT_CYLINDER, UNIT_PALLET } from './materials';
import { axisAlignedTransform, edgeSegmentCount, PALLET_SHADE, unitParts, writePartEdges } from './unitParts';

interface UnitMeshProps {
  spec: ItemSpec;
  orient: Orientation;
  /** Cargo-space box of the unit (wrap in a group to move it). */
  box: Box;
  /** Unit colour (blocks) or colour-mode tag colour (realistic). */
  color: string;
  /** Fades the unit per frame (0..1). */
  opacityRef?: RefObject<number>;
  /** Realistic goods model instead of a flat coloured block. */
  realistic?: boolean;
}

/** One cargo unit as ordinary meshes (item preview, the forklift's load, units leaving the vehicle, drag ghost). */
export function UnitMesh({ realistic = false, ...props }: UnitMeshProps) {
  return realistic ? <GoodsUnitMesh {...props} /> : <BlockUnitMesh {...props} />;
}

function GoodsUnitMesh({ spec, orient, box, color, opacityRef }: Omit<UnitMeshProps, 'realistic'>) {
  const model = goodsModelFor(spec);
  useRetainGoods([model.key]);
  const group = useRef<Group>(null);
  const fading = opacityRef !== undefined;
  const materials = useMemo(() => {
    const solid = fading ? GOODS_SOLID.clone() : GOODS_SOLID;
    const film = fading ? GOODS_FILM.clone() : GOODS_FILM;
    const tag = GOODS_TAG.clone();
    tag.color.set(color);
    if (fading) {
      solid.transparent = true;
      tag.transparent = true;
    }
    return { solid, tag, film, owned: fading ? [solid, tag, film] : [tag] };
  }, [color, fading]);
  useEffect(() => () => materials.owned.forEach((m) => m.dispose()), [materials]);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    goodsInstanceMatrix(orient, spec.dims, box.min, g.matrix);
    g.matrixWorldNeedsUpdate = true;
  }, [orient, spec.dims, box.min]);
  useFrame(() => {
    if (!opacityRef) return;
    const o = opacityRef.current ?? 1;
    materials.solid.opacity = o;
    materials.tag.opacity = o;
    materials.film.opacity = GOODS_FILM.opacity * o;
  });
  return (
    <group ref={group} matrixAutoUpdate={false}>
      <mesh geometry={model.solid} material={materials.solid} castShadow receiveShadow />
      {model.tags && <mesh geometry={model.tags} material={materials.tag} castShadow />}
      {model.film && <mesh geometry={model.film} material={materials.film} />}
    </group>
  );
}

function BlockUnitMesh({ spec, orient, box, color, opacityRef }: Omit<UnitMeshProps, 'realistic'>) {
  const parts = useMemo(() => unitParts(spec, orient, box), [spec, orient, box]);
  const fading = opacityRef !== undefined;
  const materials = useMemo(() => {
    const body = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02, transparent: fading });
    const pallet = new MeshStandardMaterial({ color: new Color(color).multiplyScalar(PALLET_SHADE), roughness: 0.9, transparent: fading });
    const edge = new LineBasicMaterial({ color: '#1d1d1b', transparent: true, opacity: 0.35 });
    return { body, pallet, edge };
  }, [color, fading]);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  const edges = useMemo(() => {
    const g = new BufferGeometry();
    const arr = new Float32Array(parts.reduce((n, p) => n + edgeSegmentCount(p), 0) * 6);
    let offset = 0;
    for (const p of parts) offset = writePartEdges(arr, offset, p);
    g.setAttribute('position', new BufferAttribute(arr, 3));
    return g;
  }, [parts]);
  useEffect(() => () => edges.dispose(), [edges]);

  const transforms = useMemo(
    () =>
      parts.map((p) => {
        const position = new Vector3();
        const quaternion = new Quaternion();
        const scale = new Vector3();
        axisAlignedTransform(p.box, p.axis, position, quaternion, scale);
        return { position, quaternion, scale };
      }),
    [parts],
  );

  useFrame(() => {
    if (!opacityRef) return;
    const o = opacityRef.current ?? 1;
    materials.body.opacity = o;
    materials.pallet.opacity = o;
    materials.edge.opacity = 0.35 * o;
  });

  return (
    <group>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={p.kind === 'pallet' ? UNIT_PALLET : p.kind === 'cylinder' ? UNIT_CYLINDER : UNIT_BOX}
          material={p.kind === 'pallet' ? materials.pallet : materials.body}
          position={transforms[i].position}
          quaternion={transforms[i].quaternion}
          scale={transforms[i].scale}
        />
      ))}
      <lineSegments geometry={edges} material={materials.edge} />
    </group>
  );
}
