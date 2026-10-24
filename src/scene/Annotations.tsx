import { memo, useMemo } from 'react';
import { LineBasicMaterial, SphereGeometry } from 'three';
import type { Box } from '../domain/geometry';
import type { AxleState, Id, UnitSystem, Vec3, Vehicle, Violation } from '../domain/types';
import { useStore } from '../state/store';
import { toThree } from './coords';
import { SceneLabel } from './labels';
import { COG_OVERLAY, LINE_MATERIALS } from './materials';
import { boxEdgePoints, CLines } from './prims';
import { axleLoadText } from './sceneFormat';

const STATUS_CLASS: Record<AxleState['status'], string> = {
  legal: 'border-ok/40 bg-ok-soft text-ok',
  near: 'border-warn/40 bg-warn-soft text-warn',
  under: 'border-warn/40 bg-warn-soft text-warn',
  over: 'border-bad/50 bg-bad-soft text-bad',
};

/** Load / limit chip under every axle group, coloured by status; hovering highlights its top contributors. */
export function AxleLabels({ vehicle, axle, groupX, units }: { vehicle: Vehicle; axle: AxleState; groupX: number[]; units: UnitSystem }) {
  const setHoverAxle = useStore((s) => s.setHoverAxle);
  return (
    <>
      {axle.axles.map((a, i) => (
        <SceneLabel key={a.id} position={toThree(groupX[i] ?? 0, -0.55, -vehicle.deckHeight - 0.05)} zIndex={20} interactive>
          <div
            role="note"
            aria-label={`${a.label}: ${axleLoadText(a.kg, a.maxKg, units)}`}
            title={`${a.label} · hover to highlight the top contributors`}
            onPointerEnter={() => setHoverAxle({ vehicleId: vehicle.id, axleId: a.id })}
            onPointerLeave={() => setHoverAxle(null)}
            className={`num w-max -translate-x-1/2 cursor-default rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-tight font-semibold whitespace-nowrap shadow-sm select-none ${STATUS_CLASS[a.status]}`}
          >
            {axleLoadText(a.kg, a.maxKg, units)}
          </div>
        </SceneLabel>
      ))}
    </>
  );
}

const COG_SPHERE = new SphereGeometry(0.11, 20, 14);
const COG_RING = new LineBasicMaterial({ color: '#f59e0b' });

/** Cargo centre of gravity: sphere plus a vertical line from the ground through the roof. */
export const CogMarker = memo(function CogMarker({ cog, vehicle }: { cog: Vec3; vehicle: Vehicle }) {
  const lines = useMemo(() => [cog.x, cog.y, -vehicle.deckHeight, cog.x, cog.y, vehicle.cargo.h + 0.45], [cog.x, cog.y, vehicle.deckHeight, vehicle.cargo.h]);
  const ring = useMemo(() => {
    const pts: number[] = [];
    const n = 32;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      pts.push(cog.x + Math.cos(a0) * 0.3, cog.y + Math.sin(a0) * 0.3, 0.012, cog.x + Math.cos(a1) * 0.3, cog.y + Math.sin(a1) * 0.3, 0.012);
    }
    return pts;
  }, [cog.x, cog.y]);
  return (
    <group>
      <CLines points={lines} material={LINE_MATERIALS.cog} />
      <CLines points={ring} material={COG_RING} />
      <mesh geometry={COG_SPHERE} material={COG_OVERLAY} position={toThree(cog.x, cog.y, cog.z)} renderOrder={10} />
      <SceneLabel position={toThree(cog.x, cog.y, vehicle.cargo.h + 0.45)} zIndex={15}>
        <div className="-translate-x-1/2 -translate-y-full rounded bg-ink px-1 py-px text-[10px] font-semibold tracking-wide text-white">COG</div>
      </SceneLabel>
    </group>
  );
});

const GHOST_LINE = new LineBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.55 });

/** Wireframes at the pre-optimisation positions of units the optimiser moved. */
export const DiffGhosts = memo(function DiffGhosts({ boxes }: { boxes: Box[] }) {
  const points = useMemo(() => boxes.flatMap((b) => boxEdgePoints([b.min.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.max.z])), [boxes]);
  if (!points.length) return null;
  return <CLines points={points} material={GHOST_LINE} />;
});

const MAX_CALLOUTS = 4;

/** Red callouts above the first responsible unit of hard and last-in-first-out violations. */
export function Callouts({ violations, boxes }: { violations: Violation[]; boxes: ReadonlyMap<Id, Box> }) {
  const select = useStore((s) => s.select);
  const requestFocus = useStore((s) => s.requestFocus);
  const callouts = useMemo(() => {
    const out: { unitId: Id; box: Box; messages: string[] }[] = [];
    for (const v of violations) {
      if (!v.hard && v.kind !== 'lifo') continue;
      const unitId = v.unitIds.find((id) => boxes.has(id));
      const box = unitId ? boxes.get(unitId) : undefined;
      if (!unitId || !box) continue;
      const existing = out.find((c) => c.unitId === unitId);
      if (existing) {
        if (!existing.messages.includes(v.message)) existing.messages.push(v.message);
        continue;
      }
      if (out.length >= MAX_CALLOUTS) continue;
      out.push({ unitId, box, messages: [v.message] });
    }
    return out;
  }, [violations, boxes]);
  return (
    <>
      {callouts.map((c) => (
        <SceneLabel key={c.unitId} position={toThree((c.box.min.x + c.box.max.x) / 2, (c.box.min.y + c.box.max.y) / 2, c.box.max.z + 0.3)} zIndex={30} interactive>
          <button
            type="button"
            title="Select and focus the unit"
            onClick={() => {
              select([c.unitId], 'replace');
              requestFocus(c.unitId);
            }}
            className="flex w-max max-w-64 -translate-x-1/2 -translate-y-full flex-col items-start gap-0.5 rounded-md bg-bad px-2 py-1 text-left text-[11px] leading-snug font-medium text-white shadow-card ring-2 ring-white/70 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad"
          >
            {c.messages.slice(0, 2).map((m) => (
              <span key={m}>{m}</span>
            ))}
            {c.messages.length > 2 && <span className="opacity-80">+{c.messages.length - 2} more</span>}
          </button>
        </SceneLabel>
      ))}
    </>
  );
}
