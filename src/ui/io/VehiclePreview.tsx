import { TEMP_COLORS } from '../../domain/colors';
import { sliderPositions, vehicleTareKg } from '../../domain/presets';
import type { CurvePoint, UnitSystem, Vehicle } from '../../domain/types';
import { formatLength, formatLitres, formatMass, formatMaterialVolume } from '../../domain/units';
import { axleGroups, axlePositions } from '../../physics';

/** viewBox width; matches the editor's preview column so 10–11 px text stays legible. */
const W = 440;
const WHEEL_R = 0.5;

/** Side-view schematic of a vehicle definition: cab, cargo box with temperature zones (or tank compartments / dump body), axles, kingpin and slider holes. */
export function VehicleSchematic({ vehicle: v, sys, peakX }: { vehicle: Vehicle; sys: UnitSystem; peakX?: number }) {
  const s = v.statics;
  const L = v.cargo.l;
  // Vehicle frame: rigid = cargo frame; articulated = tractor frame (steer axle at 0).
  const frame = (x: number) => (s.type === 'rigid' ? x : s.fifthWheelX + (x - s.kingpinX));
  const groups = axleGroups(v);
  const centres = s.type === 'rigid' ? [s.front.x, s.rear.x] : [s.steer.x, s.drive.x, frame(s.trailerAxle.x)];
  const wheels = axlePositions(v);
  const firstAxle = centres[0];
  const cabFront = firstAxle - 1.5;
  const cabRear = s.type === 'rigid' ? Math.max(cabFront + 0.8, frame(0) - 0.15) : firstAxle + 1.3;
  const minX = Math.min(cabFront, frame(0)) - 0.3;
  const maxX = Math.max(frame(L), ...wheels.map((w) => w.pos + WHEEL_R)) + 0.3;
  const deck = v.deckHeight;
  const top = deck + v.cargo.h;
  const cabTop = Math.min(top, Math.max(2.6, deck + 1.4));

  const scale = (W - 24) / (maxX - minX);
  if (!Number.isFinite(scale) || scale <= 0 || !(top > 0)) {
    return <p className="rounded-lg bg-canvas p-4 text-xs text-muted">Enter valid dimensions to see the side view.</p>;
  }
  const padTop = 30;
  const padBottom = 56;
  const X = (x: number) => 12 + (x - minX) * scale;
  const Y = (z: number) => padTop + (top - z) * scale;
  const height = Y(0) + padBottom;
  const big = (m: number) => formatLength(m, sys, { big: true });
  const chassisY = deck - 0.18;

  const dim = (from: number, to: number, y: number, label: string) => (
    <g className="text-muted">
      <line x1={X(from)} x2={X(to)} y1={y} y2={y} stroke="currentColor" strokeWidth={1} markerStart="url(#vs-arrow)" markerEnd="url(#vs-arrow)" />
      <text x={(X(from) + X(to)) / 2} y={y - 4} textAnchor="middle" fontSize={11} fill="currentColor" className="num">
        {label}
      </text>
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={`Side view of ${v.name}`}>
      <defs>
        <marker id="vs-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 z" fill="currentColor" />
        </marker>
      </defs>
      {/* ground */}
      <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} stroke="var(--color-line-strong)" strokeWidth={1.5} />
      {/* chassis */}
      <rect x={X(cabFront + 0.2)} y={Y(chassisY)} width={Math.max(0, X(s.type === 'rigid' ? frame(L) : centres[1] + 1.2) - X(cabFront + 0.2))} height={0.16 * scale} fill="var(--color-ink-soft)" />
      {s.type === 'artic' && <rect x={X(frame(0))} y={Y(chassisY)} width={Math.max(0, X(frame(L)) - X(frame(0)))} height={0.12 * scale} fill="var(--color-ink-soft)" opacity={0.85} />}
      {/* cab */}
      <rect x={X(cabFront)} y={Y(cabTop)} width={Math.max(0, X(cabRear) - X(cabFront))} height={(cabTop - chassisY + 0.1) * scale} rx={6} fill="var(--color-canvas)" stroke="var(--color-ink-soft)" strokeWidth={1.2} />
      <rect x={X(cabFront + 0.15)} y={Y(cabTop - 0.2)} width={Math.max(0, 0.7 * scale)} height={0.6 * scale} rx={3} fill="var(--color-info-soft)" stroke="var(--color-line-strong)" />
      {v.bulk?.kind === 'tipper' ? (
        <g>
          {/* open dump body: front wall, floor and tailgate; the dashed line is the struck (level-full) surface */}
          <rect x={X(frame(0))} y={Y(top)} width={L * scale} height={v.cargo.h * scale} fill="var(--color-accent-soft)" opacity={0.6} />
          <path
            d={`M${X(frame(0))},${Y(top)} L${X(frame(0))},${Y(deck)} L${X(frame(L))},${Y(deck)} L${X(frame(L))},${Y(top)}`}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={2}
          />
          <line x1={X(frame(0))} x2={X(frame(L))} y1={Y(top)} y2={Y(top)} stroke="var(--color-accent-strong)" strokeDasharray="5 4" />
          <text x={(X(frame(0)) + X(frame(L))) / 2} y={Y(deck + v.cargo.h / 2) + 4} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--color-ink-soft)" className="num">
            Body {formatMaterialVolume(v.bulk.compartments[0]?.capacityL ?? 0, 'solid', sys, 1)}
          </text>
        </g>
      ) : v.bulk ? (
        <g>
          {/* tank barrel with compartments */}
          <rect
            x={X(frame(0))}
            y={Y(top)}
            width={L * scale}
            height={v.cargo.h * scale}
            rx={v.bulk.pressurised ? (v.cargo.h * scale) / 2 : Math.min((v.cargo.h * scale) / 3, 16)}
            fill="var(--color-canvas)"
            stroke="var(--color-ink)"
            strokeWidth={v.bulk.insulated ? 3 : 1.5}
          />
          {v.bulk.compartments.map((c, i) => {
            const cx = (X(frame(c.fromX)) + X(frame(c.toX))) / 2;
            const wide = (c.toX - c.fromX) * scale > 44;
            return (
              <g key={c.id}>
                {i > 0 && <line x1={X(frame(c.fromX))} x2={X(frame(c.fromX))} y1={Y(top) + 2} y2={Y(deck) - 2} stroke="var(--color-info)" strokeWidth={2} />}
                <text x={cx} y={Y(deck + v.cargo.h / 2) - (wide ? 2 : -4)} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--color-ink-soft)">
                  {c.label}
                </text>
                {wide && (
                  <text x={cx} y={Y(deck + v.cargo.h / 2) + 11} textAnchor="middle" fontSize={9.5} fill="var(--color-muted)" className="num">
                    {formatLitres(c.capacityL, sys, 0)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ) : (
        <g>
          {/* cargo box with temperature zones */}
          {v.zones.map((z) => (
            <rect key={z.id} x={X(frame(z.fromX))} y={Y(top)} width={Math.max(0, (z.toX - z.fromX) * scale)} height={v.cargo.h * scale} fill={TEMP_COLORS[z.temp]} opacity={v.tempControlled ? 0.22 : 0.08} />
          ))}
          {v.zones.slice(0, -1).map((z) => (
            <line key={z.id} x1={X(frame(z.toX))} x2={X(frame(z.toX))} y1={Y(top)} y2={Y(deck)} stroke="var(--color-info)" strokeWidth={2} />
          ))}
          <rect
            x={X(frame(0))}
            y={Y(top)}
            width={L * scale}
            height={v.cargo.h * scale}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={1.5}
            strokeDasharray={v.walls ? undefined : '6 4'}
          />
        </g>
      )}
      {v.tempControlled && <rect x={X(frame(0)) - 0.35 * scale} y={Y(top - 0.2)} width={0.35 * scale} height={0.9 * scale} rx={2} fill="var(--color-info)" opacity={0.75} />}
      {/* best COG */}
      {peakX !== undefined && (
        <g>
          <line x1={X(frame(peakX))} x2={X(frame(peakX))} y1={Y(top) - 4} y2={Y(deck)} stroke="var(--color-accent-strong)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={X(frame(peakX))} y={Y(top) + 14} textAnchor="middle" fontSize={10.5} fill="var(--color-accent-strong)" fontWeight={600}>
            Best COG
          </text>
        </g>
      )}
      {/* kingpin + fifth wheel */}
      {s.type === 'artic' && (
        <g>
          <path d={`M${X(s.fifthWheelX) - 6},${Y(deck) - 1} L${X(s.fifthWheelX) + 6},${Y(deck) - 1} L${X(s.fifthWheelX)},${Y(deck) + 9} z`} fill="var(--color-accent)" />
          <rect x={X(s.fifthWheelX) - 0.45 * scale} y={Y(chassisY - 0.16)} width={0.9 * scale} height={0.08 * scale + 2} fill="var(--color-accent-strong)" />
        </g>
      )}
      {/* slider holes */}
      {sliderPositions(v).map((x) => (
        <line key={x} x1={X(frame(x))} x2={X(frame(x))} y1={Y(chassisY) + 0.12 * scale} y2={Y(chassisY) + 0.12 * scale + 5} stroke="var(--color-accent-strong)" strokeWidth={1} />
      ))}
      {/* wheels */}
      {wheels.map((w, i) => (
        <g key={i}>
          <circle cx={X(w.pos)} cy={Y(WHEEL_R)} r={WHEEL_R * scale} fill="var(--color-ink)" />
          <circle cx={X(w.pos)} cy={Y(WHEEL_R)} r={WHEEL_R * scale * 0.45} fill="var(--color-line-strong)" />
        </g>
      ))}
      {groups.map((g, i) => (
        <text key={g.id} x={X(centres[i])} y={Y(0) + 14} textAnchor="middle" fontSize={10.5} fill="var(--color-ink-soft)">
          {g.label}
        </text>
      ))}
      {dim(frame(0), frame(L), Y(top) - 12, `Cargo ${big(L)}`)}
      {s.type === 'rigid'
        ? dim(s.front.x, s.rear.x, Y(0) + 40, `Wheelbase ${big(s.rear.x - s.front.x)}`)
        : dim(s.fifthWheelX, frame(s.trailerAxle.x), Y(0) + 40, `Kingpin → trailer axle ${big(s.trailerAxle.x - s.kingpinX)}`)}
    </svg>
  );
}

/** Contiguous stretches of the curve limited by the same constraint. */
function limitSegments(curve: readonly CurvePoint[]): { from: number; to: number; limitedBy: string }[] {
  const out: { from: number; to: number; limitedBy: string }[] = [];
  for (const p of curve) {
    const last = out[out.length - 1];
    if (last && last.limitedBy === p.limitedBy) last.to = p.x;
    else out.push({ from: p.x, to: p.x, limitedBy: p.limitedBy });
  }
  return out;
}

/** Load distribution diagram: maximum legal payload against the cargo COG position. */
export function LoadCurveChart({ vehicle: v, curve, peak, sys }: { vehicle: Vehicle; curve: CurvePoint[]; peak: CurvePoint; sys: UnitSystem }) {
  const H = 190;
  const pad = { l: 60, r: 8, t: 12, b: 26 };
  const L = v.cargo.l;
  const cap = Math.min(v.payloadKg, v.grossLimitKg - vehicleTareKg(v));
  const yMax = Math.max(peak.maxKg, cap, 1) * 1.08;
  const X = (x: number) => pad.l + (x / L) * (W - pad.l - pad.r);
  const Y = (kg: number) => pad.t + (1 - kg / yMax) * (H - pad.t - pad.b);
  const line = curve.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.maxKg).toFixed(1)}`).join(' ');
  const area = `${line} L${X(L).toFixed(1)},${Y(0)} L${X(0)},${Y(0)} z`;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * L);
  const yTicks = [0, 1 / 3, 2 / 3, 1].map((f) => (f * yMax) / 1.08);
  const big = (m: number) => formatLength(m, sys, { big: true });

  return (
    <div>
      <p className="mb-1 text-sm text-ink">
        Max legal payload <span className="num font-mono font-semibold">{formatMass(peak.maxKg, sys)}</span> at COG{' '}
        <span className="num font-mono font-semibold">{big(peak.x)}</span> <span className="text-muted">from the front wall</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Load distribution diagram">
        {yTicks.map((kg) => (
          <g key={kg}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(kg)} y2={Y(kg)} stroke="var(--color-line)" />
            <text x={pad.l - 6} y={Y(kg) + 4} textAnchor="end" fontSize={10.5} fill="var(--color-muted)" className="num">
              {formatMass(kg, sys)}
            </text>
          </g>
        ))}
        {xTicks.map((x) => (
          <text key={x} x={X(x)} y={H - 8} textAnchor={x === 0 ? 'start' : x === L ? 'end' : 'middle'} fontSize={10.5} fill="var(--color-muted)" className="num">
            {big(x)}
          </text>
        ))}
        <path d={area} fill="var(--color-ok)" opacity={0.12} />
        <path d={line} fill="none" stroke="var(--color-ok)" strokeWidth={2} />
        {cap > 0 && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={Y(cap)} y2={Y(cap)} stroke="var(--color-muted)" strokeDasharray="5 4" />
            <text x={W - pad.r - 4} y={Y(cap) - 5} textAnchor="end" fontSize={10.5} fill="var(--color-muted)">
              {v.payloadKg <= v.grossLimitKg - vehicleTareKg(v) ? 'Rated payload' : 'Gross limit'}
            </text>
          </g>
        )}
        <circle cx={X(peak.x)} cy={Y(peak.maxKg)} r={5} fill="var(--color-accent)" stroke="white" strokeWidth={2} />
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={Y(0)} stroke="var(--color-line-strong)" />
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
        {limitSegments(curve).map((seg) => (
          <li key={`${seg.from}-${seg.limitedBy}`}>
            <span className="num font-mono">
              {big(seg.from)}–{big(seg.to)}
            </span>
            : {seg.limitedBy}
          </li>
        ))}
      </ul>
    </div>
  );
}
