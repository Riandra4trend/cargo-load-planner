import { useFrame, useThree } from '@react-three/fiber';
import { createContext, useContext, useEffect, useId, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Vector3 } from 'three';

/**
 * Screen-space labels for a canvas: scene components declare a label at a world position with
 * `<SceneLabel>`, the DOM `<LabelLayer>` (outside the canvas) renders them, and `<LabelProjector>`
 * (inside the canvas) moves them every frame. One React tree, no per-label React roots.
 */

interface LabelEntry {
  node: ReactNode;
  /** World position (three.js coordinates). */
  position: Vector3;
  zIndex: number;
  interactive: boolean;
}

export class LabelStore {
  private readonly entries = new Map<string, LabelEntry>();
  private list: [string, LabelEntry][] = [];
  private readonly listeners = new Set<() => void>();
  /** Mounted DOM element of each label (filled by LabelLayer). */
  readonly elements = new Map<string, HTMLDivElement>();
  /** Last screen position written per label, to skip unchanged style writes. */
  readonly placed = new Map<string, { x: number; y: number; visible: boolean }>();

  get(id: string): LabelEntry | undefined {
    return this.entries.get(id);
  }

  set(id: string, entry: LabelEntry): void {
    this.entries.set(id, entry);
    this.placed.delete(id);
    this.emit();
  }

  delete(id: string): void {
    if (!this.entries.delete(id)) return;
    this.placed.delete(id);
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): [string, LabelEntry][] => this.list;

  private emit(): void {
    this.list = [...this.entries];
    for (const l of this.listeners) l();
  }
}

export const LabelContext = createContext<LabelStore | null>(null);

/** A DOM label anchored at a world position (its top-left corner sits on the projected point). */
export function SceneLabel({ position, zIndex = 10, interactive = false, children }: { position: readonly [number, number, number]; zIndex?: number; interactive?: boolean; children: ReactNode }) {
  const store = useContext(LabelContext);
  const id = useId();
  const [x, y, z] = position;
  useLayoutEffect(() => {
    store?.set(id, { node: children, position: new Vector3(x, y, z), zIndex, interactive });
  }, [store, id, children, x, y, z, zIndex, interactive]);
  useLayoutEffect(() => () => store?.delete(id), [store, id]);
  return null;
}

/** DOM container for a canvas' labels; place it right after the <Canvas> inside a relative wrapper. */
export function LabelLayer({ store }: { store: LabelStore }) {
  const list = useSyncExternalStore(store.subscribe, store.snapshot);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {list.map(([id, e]) => (
        <div
          key={id}
          ref={(el) => {
            if (el) store.elements.set(id, el);
            else store.elements.delete(id);
          }}
          className="absolute top-0 left-0"
          style={{ zIndex: e.zIndex, pointerEvents: e.interactive ? 'auto' : 'none', visibility: 'hidden' }}
        >
          {e.node}
        </div>
      ))}
    </div>
  );
}

const projected = new Vector3();

/** Projects every label to the screen each rendered frame (inside the canvas). */
export function LabelProjector({ store }: { store: LabelStore }) {
  const invalidate = useThree((s) => s.invalidate);
  // On-demand canvases need a frame whenever labels change.
  useEffect(() => store.subscribe(() => invalidate()), [store, invalidate]);
  useFrame(({ camera, size }) => {
    for (const [id, el] of store.elements) {
      const entry = store.get(id);
      if (!entry) continue;
      projected.copy(entry.position).project(camera);
      const visible = projected.z > -1 && projected.z < 1;
      const x = Math.round((projected.x * 0.5 + 0.5) * size.width * 10) / 10;
      const y = Math.round((-projected.y * 0.5 + 0.5) * size.height * 10) / 10;
      const last = store.placed.get(id);
      if (last && last.x === x && last.y === y && last.visible === visible) continue;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      el.style.visibility = visible ? 'visible' : 'hidden';
      if (last) {
        last.x = x;
        last.y = y;
        last.visible = visible;
      } else store.placed.set(id, { x, y, visible });
    }
  });
  return null;
}
