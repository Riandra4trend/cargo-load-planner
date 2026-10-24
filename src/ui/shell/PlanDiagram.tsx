import { useMemo } from 'react';
import { TEMP_COLORS, TEMP_LABELS } from '../../domain/colors';
import { footprintOverlap } from '../../domain/geometry';
import type { Id, Plan, Vehicle } from '../../domain/types';
import { formatLength, formatWeight } from '../../domain/units';
import { axleGroups, axlePositions } from '../../physics';
import { loadingSequence, type LoadStep } from '../../sim/sequence';
import { evaluatePlan } from '../../state/evaluate';
import { ColorDot } from '../common/Chip';
import { stopColorsBySeq } from './shellFormat';

export interface PlanDiagramProps {
  plan: Plan;
  vehicleId: Id;
  mode: 'top' | 'side';
  /** Rendered width in CSS pixels; the height follows from the vehicle proportions. */
  width: number;
  /** Optional interactivity (the on-screen Plan view); the printed report omits these. */
  selection?: readonly Id[];
  onSelect?: (unitIds: Id[]) => void;
}

interface Stack {
  floor: LoadStep;
  steps: LoadStep[];
  seq: number[];
  kg: number;
}

const INK = 'var(--color-ink)';
const MUTED = 'var(--color-muted)';
const LINE = 'var(--color-line-strong)';
const FONT = 'var(--font-sans)';

/** Axle positions in the cargo frame (metres from the front wall), with their group index. */
function cargoFrameAxles(v: Vehicle): { x: number; groupIndex: number }[] {
  const s = v.statics;
  return axlePositions(v).map((a) => ({ x: s.type === 'rigid' ? a.pos : a.pos - s.fifthWheelX + s.kingpinX, groupIndex: a.groupIndex }));
}

function fit(text: string, px: number, fontSize: number): string {
  const max = Math.floor(px / (fontSize * 0.56));
  if (max < 3) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Arrow-less engineering dimension line with end ticks and a centred label. */
function DimLine({ x1, y1, x2, y2, label, vertical }: { x1: number; y1: number; x2: number; y2: number; label: string; vertical?: boolean }) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g stroke={MUTED} strokeWidth={0.9} fill="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {vertical ? (
        <>
          <line x1={x1 - 4} x2={x1 + 4} y1={y1} y2={y1} />
          <line x1={x2 - 4} x2={x2 + 4} y1={y2} y2={y2} />
        </>
      ) : (
        <>
          <line x1={x1} x2={x1} y1={y1 - 4} y2={y1 + 4} />
          <line x1={x2} x2={x2} y1={y2 - 4} y2={y2 + 4} />
        </>
      )}
      <g transform={vertical ? `translate(${mx + 4} ${my}) rotate(90)` : `translate(${mx} ${my})`}>
        <rect x={-label.length * 3.1 - 4} y={-7} width={label.length * 6.2 + 8} height={14} fill="white" stroke="none" />
        <text textAnchor="middle" y={3.5} fontSize={10} fill={INK} stroke="none" fontFamily={FONT} className="num">
          {label}
        </text>
      </g>
    </g>
  );
}

/** Groups the loading sequence into floor stacks (each upper unit joins the floor unit it overlaps most). */
function buildStacks(steps: LoadStep[], weightOf: (id: Id) => number): Stack[] {
  const floor = steps.filter((s) => s.layer === 1);
  const stacks = new Map<Id, Stack>(floor.map((f) => [f.unitId, { floor: f, steps: [f], seq: [], kg: 0 }]));
  for (const s of steps) {
    if (s.layer === 1) continue;
    let best: LoadStep | null = null;
    let bestArea = 0;
    for (const f of floor) {
      const a = footprintOverlap(f.box, s.box);
      if (a > bestArea) {
        bestArea = a;
        best = f;
      }
    }
    if (best) stacks.get(best.unitId)!.steps.push(s);
    else stacks.set(s.unitId, { floor: s, steps: [s], seq: [], kg: 0 });
  }
  steps.forEach((s, i) => {
    const stack = [...stacks.values()].find((st) => st.steps.includes(s));
    if (!stack) return;
    stack.seq.push(i + 1);
    stack.kg += weightOf(s.unitId);
  });
  return [...stacks.values()];
}

/**
 * Printable, dimensioned 2D drawing of one vehicle: top-down floor plan or side elevation, units
 * coloured by stop and labelled with their loading-sequence number, bays, temperature zones and axles.
 */
export function PlanDiagram({ plan, vehicleId, mode, width, selection, onSelect }: PlanDiagramProps) {
  const evaluation = evaluatePlan(plan);
  const v = plan.vehicles.find((x) => x.id === vehicleId) ?? plan.vehicles[0];
  const sys = plan.settings.units;
  const steps = useMemo(() => loadingSequence(plan, v.id), [plan, v.id]);
  const colors = stopColorsBySeq(plan);
  const selected = new Set(selection ?? []);
  const weightOf = (id: Id) => evaluation.unitById.get(id)?.spec.weightKg ?? 0;
  const seqOf = new Map(steps.map((s, i) => [s.unitId, i + 1]));
  const bays = evaluation.byVehicle[v.id]?.bays ?? [];
  const showZones = v.tempControlled || v.zones.length > 1;
  const groups = axleGroups(v);

  const axles = mode === 'side' ? cargoFrameAxles(v) : [];
  const xMin = mode === 'side' ? Math.min(0, ...axles.map((a) => a.x - 1.1)) : 0;
  const xMax = mode === 'side' ? Math.max(v.cargo.l, ...axles.map((a) => a.x + 0.7)) : v.cargo.l;
  const ml = mode === 'top' ? 34 : 14;
  const mr = 40;
  const mt = mode === 'top' ? 22 : 34;
  const s = Math.max(1, (width - ml - mr) / (xMax - xMin));
  const X = (x: number) => ml + (x - xMin) * s;

  if (mode === 'top') {
    const mb = showZones ? 52 : 40;
    const height = mt + v.cargo.w * s + mb;
    const Y = (y: number) => mt + y * s;
    const stacks = buildStacks(steps, weightOf);
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Top view of ${v.name}: ${steps.length} units`} className="h-auto max-w-full" style={{ fontFamily: FONT }}>
        {showZones &&
          v.zones.map((z) => (
            <g key={z.id}>
              <rect x={X(z.fromX)} y={Y(0)} width={(z.toX - z.fromX) * s} height={v.cargo.w * s} fill={TEMP_COLORS[z.temp]} fillOpacity={0.14} />
              <rect x={X(z.fromX) + 1} y={Y(v.cargo.w) + 4} width={Math.max(1, (z.toX - z.fromX) * s - 2)} height={3} rx={1.5} fill={TEMP_COLORS[z.temp]} />
              <text x={X(z.fromX) + 2} y={Y(v.cargo.w) + 17} fontSize={9} fill={TEMP_COLORS[z.temp]} fontWeight={600} letterSpacing={0.5}>
                {fit(`${TEMP_LABELS[z.temp].toUpperCase()} ${formatLength(z.toX - z.fromX, sys, { big: true })}`, (z.toX - z.fromX) * s - 4, 9)}
              </text>
            </g>
          ))}
        {bays.map((b, i) => (
          <g key={b.label}>
            {i > 0 && <line x1={X(b.fromX)} x2={X(b.fromX)} y1={Y(0)} y2={Y(v.cargo.w)} stroke={LINE} strokeDasharray="3 3" strokeWidth={0.75} />}
            {(b.toX - b.fromX) * s >= 26 && (
              <text x={X((b.fromX + b.toX) / 2)} y={mt - 6} textAnchor="middle" fontSize={8.5} fill={MUTED} className="num">
                {b.label}
              </text>
            )}
          </g>
        ))}
        {stacks.map((st) => {
          const b = st.floor.box;
          const x = X(b.min.x);
          const y = Y(b.min.y);
          const w = (b.max.x - b.min.x) * s;
          const h = (b.max.y - b.min.y) * s;
          const color = colors.get(st.floor.stopSeq) ?? '#999';
          const isSel = st.steps.some((x2) => selected.has(x2.unitId));
          const names = [...new Set(st.steps.map((x2) => x2.name))];
          const seqText = st.seq.join('+');
          return (
            <g
              key={st.floor.unitId}
              onClick={onSelect ? () => onSelect(st.steps.map((x2) => x2.unitId)) : undefined}
              style={onSelect ? { cursor: 'pointer' } : undefined}
            >
              <title>{`Step ${seqText}: ${names.join(', ')} · ${formatWeight(st.kg, sys)} · stop ${st.floor.stopSeq}`}</title>
              <rect x={x + 0.75} y={y + 0.75} width={Math.max(1, w - 1.5)} height={Math.max(1, h - 1.5)} rx={2} fill={color} fillOpacity={0.82} stroke={isSel ? INK : 'white'} strokeWidth={isSel ? 2.25 : 1} />
              {w > 18 && h > 14 && (
                <>
                  <circle cx={x + 10} cy={y + 10} r={seqText.length > 2 ? 8.5 : 7} fill="white" />
                  <text x={x + 10} y={y + 13} textAnchor="middle" fontSize={seqText.length > 3 ? 6.5 : 8.5} fontWeight={700} fill={INK} className="num">
                    {seqText.length > 5 ? `${st.seq[0]}…` : seqText}
                  </text>
                </>
              )}
              {h > 30 && (
                <text x={x + 4} y={y + 30} fontSize={9} fontWeight={600} fill={INK}>
                  {fit(names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0], w - 8, 9)}
                </text>
              )}
              {h > 42 && (
                <text x={x + 4} y={y + 41} fontSize={8.5} fill={INK} fillOpacity={0.8} className="num">
                  {fit(formatWeight(st.kg, sys), w - 8, 8.5)}
                </text>
              )}
              {st.steps.length > 1 && w > 30 && (
                <g>
                  <rect x={x + w - 22} y={y + 3} width={19} height={12} rx={6} fill={INK} />
                  <text x={x + w - 12.5} y={y + 12} textAnchor="middle" fontSize={8} fontWeight={700} fill="white" className="num">
                    ×{st.steps.length}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        <rect x={X(0)} y={Y(0)} width={v.cargo.l * s} height={v.cargo.w * s} fill="none" stroke={INK} strokeWidth={1.75} />
        <text transform={`translate(${ml - 10} ${Y(v.cargo.w / 2)}) rotate(-90)`} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={MUTED} letterSpacing={1}>
          FRONT
        </text>
        <text transform={`translate(${X(v.cargo.l) + 12} ${Y(v.cargo.w / 2)}) rotate(90)`} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={MUTED} letterSpacing={1}>
          {v.access.includes('rear') ? 'REAR DOORS' : 'REAR'}
        </text>
        <DimLine x1={X(0)} y1={Y(v.cargo.w) + mb - 18} x2={X(v.cargo.l)} y2={Y(v.cargo.w) + mb - 18} label={formatLength(v.cargo.l, sys, { big: true })} />
        <DimLine x1={X(v.cargo.l) + 28} y1={Y(0)} x2={X(v.cargo.l) + 28} y2={Y(v.cargo.w)} label={formatLength(v.cargo.w, sys, { big: true })} vertical />
      </svg>
    );
  }

  // Side elevation, viewed from the left (y = 0) wall: nearer units are drawn last.
  const wheelR = Math.min(0.5, v.deckHeight * 0.75);
  const mb = 30;
  const height = mt + (v.cargo.h + v.deckHeight) * s + mb;
  const floorY = mt + v.cargo.h * s;
  const groundY = floorY + v.deckHeight * s;
  const Z = (z: number) => floorY - z * s;
  const sorted = [...steps].sort((a, b) => b.box.min.y - a.box.min.y || a.box.min.z - b.box.min.z);
  const front = Math.min(...axles.map((a) => a.x)) - 0.9;
  const cabRear = v.statics.type === 'rigid' ? -0.15 : Math.min(-0.15, front + 3.1);
  const cabTop = Z(Math.min(v.cargo.h, v.cargo.h * 0.92 - (v.statics.type === 'rigid' ? 0.1 : 0)));
  const groupCentres = groups.map((g, gi) => {
    const xs = axles.filter((a) => a.groupIndex === gi).map((a) => a.x);
    return { label: g.label, x: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length) };
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Side view of ${v.name}`} className="h-auto max-w-full" style={{ fontFamily: FONT }}>
      <line x1={0} x2={width} y1={groundY} y2={groundY} stroke={LINE} strokeWidth={1} />
      {front < -0.2 && (
        <g>
          <path
            d={`M${X(front)},${groundY - wheelR * s * 0.6} L${X(front)},${cabTop + 10} Q${X(front)},${cabTop} ${X(front) + 10},${cabTop} L${X(cabRear)},${cabTop} L${X(cabRear)},${groundY - wheelR * s * 0.6} Z`}
            fill="#ECEAE4"
            stroke={LINE}
          />
          <rect x={X(front) + 6} y={cabTop + 8} width={Math.max(8, (cabRear - front) * s * 0.38)} height={Math.max(8, (floorY - cabTop) * 0.32)} rx={3} fill="#D8E4EE" stroke={LINE} strokeWidth={0.75} />
        </g>
      )}
      <rect x={X(Math.min(0, front + 0.6))} y={floorY} width={(Math.max(...axles.map((a) => a.x), v.cargo.l) - Math.min(0, front + 0.6)) * s} height={Math.max(3, v.deckHeight * s * 0.35)} fill="#D9D6CF" />
      {axles.map((a, i) => (
        <g key={i}>
          <circle cx={X(a.x)} cy={groundY - wheelR * s} r={wheelR * s} fill="#3A3A37" />
          <circle cx={X(a.x)} cy={groundY - wheelR * s} r={wheelR * s * 0.42} fill="#B9B6AE" />
        </g>
      ))}
      {groupCentres.map((g) => (
        <text key={g.label} x={X(g.x)} y={groundY + 12} textAnchor="middle" fontSize={8.5} fill={MUTED}>
          {g.label}
        </text>
      ))}
      {showZones &&
        v.zones.map((z) => (
          <rect key={z.id} x={X(z.fromX)} y={Z(v.cargo.h)} width={(z.toX - z.fromX) * s} height={v.cargo.h * s} fill={TEMP_COLORS[z.temp]} fillOpacity={0.12} />
        ))}
      {bays.slice(1).map((b) => (
        <line key={b.label} x1={X(b.fromX)} x2={X(b.fromX)} y1={Z(v.cargo.h)} y2={floorY} stroke={LINE} strokeDasharray="3 3" strokeWidth={0.6} />
      ))}
      {sorted.map((st) => {
        const b = st.box;
        const x = X(b.min.x);
        const y = Z(b.max.z);
        const w = (b.max.x - b.min.x) * s;
        const h = (b.max.z - b.min.z) * s;
        const seq = seqOf.get(st.unitId) ?? 0;
        const isSel = selected.has(st.unitId);
        return (
          <g key={st.unitId} onClick={onSelect ? () => onSelect([st.unitId]) : undefined} style={onSelect ? { cursor: 'pointer' } : undefined}>
            <title>{`Step ${seq}: ${st.name} · ${formatWeight(weightOf(st.unitId), sys)} · ${st.position}`}</title>
            <rect x={x + 0.5} y={y + 0.5} width={Math.max(1, w - 1)} height={Math.max(1, h - 1)} rx={1.5} fill={colors.get(st.stopSeq) ?? '#999'} fillOpacity={0.85} stroke={isSel ? INK : 'white'} strokeWidth={isSel ? 2 : 0.9} />
            {w > 14 && h > 14 && (
              <text x={x + w / 2} y={y + h / 2 + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill={INK} className="num">
                {seq}
              </text>
            )}
          </g>
        );
      })}
      <rect x={X(0)} y={Z(v.cargo.h)} width={v.cargo.l * s} height={v.cargo.h * s} fill="none" stroke={INK} strokeWidth={1.75} strokeDasharray={v.walls ? undefined : '6 4'} />
      <DimLine x1={X(0)} y1={mt - 16} x2={X(v.cargo.l)} y2={mt - 16} label={formatLength(v.cargo.l, sys, { big: true })} />
      <DimLine x1={X(v.cargo.l) + 22} y1={Z(v.cargo.h)} x2={X(v.cargo.l) + 22} y2={floorY} label={formatLength(v.cargo.h, sys, { big: true })} vertical />
    </svg>
  );
}

/** Legend for PlanDiagram: stops present on the vehicle, temperature zones and symbol meanings. */
export function PlanLegend({ plan, vehicleId }: { plan: Plan; vehicleId: Id }) {
  const v = plan.vehicles.find((x) => x.id === vehicleId) ?? plan.vehicles[0];
  const evaluation = evaluatePlan(plan);
  const seqs = new Set(evaluation.byVehicle[v.id]?.points.map((p) => p.stopSeq) ?? []);
  const colors = stopColorsBySeq(plan);
  const customers = new Map(plan.customers.map((c) => [c.id, c.name]));
  const stops = [...plan.stops].sort((a, b) => a.sequence - b.sequence).filter((s) => seqs.has(s.sequence));
  const temps = v.tempControlled || v.zones.length > 1 ? [...new Set(v.zones.map((z) => z.temp))] : [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-soft">
      {stops.map((s) => (
        <span key={s.id} className="flex items-center gap-1.5">
          <ColorDot color={colors.get(s.sequence) ?? '#999'} />
          <span className="num font-semibold">{s.sequence}</span> {customers.get(s.customerId) ?? s.name}
        </span>
      ))}
      {temps.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: TEMP_COLORS[t], opacity: 0.35 }} aria-hidden />
          {TEMP_LABELS[t]} zone
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="num inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-strong bg-white text-[9px] font-bold">7</span>
        loading step
      </span>
      <span className="flex items-center gap-1.5">
        <span className="num inline-flex h-3.5 items-center rounded-full bg-ink px-1.5 text-[9px] font-bold text-white">×2</span>
        stacked units
      </span>
    </div>
  );
}
