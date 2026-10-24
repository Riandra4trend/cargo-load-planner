import { ChartArea } from 'lucide-react';
import { useId } from 'react';
import { bigLengthUnit, formatLength, formatMass, formatNumber, fromKg, fromMetres, toKg, toMetres } from '../../domain/units';
import type { CurvePoint } from '../../domain/types';
import { useUnitSystem } from '../../state/hooks';
import { frontLabel } from './bulk';
import { Section } from './Section';
import { lowerFirst, niceTicks, STATUS_COLOR } from './shellFormat';
import type { ShownState } from './useShownState';

const W = 320;
const H = 180;
const PAD = { l: 36, r: 10, t: 12, b: 28 };

/** Linear interpolation of the curve's max payload at x. */
function curveAt(curve: readonly CurvePoint[], x: number): number {
  if (x <= curve[0].x) return curve[0].maxKg;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (x <= b.x) return a.maxKg + ((b.maxKg - a.maxKg) * (x - a.x)) / Math.max(1e-9, b.x - a.x);
  }
  return curve[curve.length - 1].maxKg;
}

/** Max legal payload vs cargo COG position, legal area shaded, current point marked. */
export function LoadDistributionChart({ shown }: { shown: ShownState }) {
  const sys = useUnitSystem();
  const clipId = `ldc${useId().replace(/[^\w-]/g, '')}`;
  const { vehicleEval: ve, axle, remaining } = shown;
  const v = ve.vehicle;
  const front = frontLabel(v);
  const curve = ve.curve;
  const lenUnit = bigLengthUnit(sys);
  const massUnit = sys === 'metric' ? 't' : 'lb';
  const massScale = sys === 'metric' ? 1 : 1000;

  const yMaxKg = Math.max(ve.peak.maxKg, v.payloadKg, axle.cargoKg, 1) * 1.12;
  const sx = (x: number) => PAD.l + (x / v.cargo.l) * (W - PAD.l - PAD.r);
  const sy = (kg: number) => H - PAD.b - (Math.max(0, kg) / yMaxKg) * (H - PAD.t - PAD.b);

  const pts = curve.map((p) => `${sx(p.x).toFixed(1)},${sy(p.maxKg).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  const area = `M${sx(0)},${sy(0)}L${pts.join('L')}L${sx(v.cargo.l)},${sy(0)}Z`;
  const xTicks = niceTicks(fromMetres(v.cargo.l, lenUnit), 5).map((t) => ({ label: formatNumber(t, t % 1 ? 1 : 0), x: toMetres(t, lenUnit) }));
  const yTicks = niceTicks(fromKg(yMaxKg, massUnit) / massScale, 5).map((t) => ({ label: formatNumber(t, t % 1 ? 1 : 0), kg: toKg(t * massScale, massUnit) }));

  const cog = axle.cog;
  const color = STATUS_COLOR[axle.status];
  const allowedHere = cog ? curveAt(curve, cog.x) : ve.peak.maxKg;
  const limitedHere = cog ? (curve.reduce((best, p) => (Math.abs(p.x - cog.x) < Math.abs(best.x - cog.x) ? p : best), curve[0]).limitedBy) : ve.peak.limitedBy;

  return (
    <Section title="Load distribution" icon={<ChartArea />}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Load distribution diagram: maximum legal payload by cargo COG position. ${cog ? `Current load ${formatMass(axle.cargoKg, sys)} at ${formatLength(cog.x, sys, { big: true })}; allowed there ${formatMass(allowedHere, sys)}.` : 'Vehicle empty.'}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} />
          </clipPath>
        </defs>
        {yTicks.map((t) => (
          <g key={`y${t.kg}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t.kg)} y2={sy(t.kg)} stroke="var(--color-line)" strokeWidth={0.75} />
            <text x={PAD.l - 4} y={sy(t.kg) + 3} textAnchor="end" className="fill-muted num" fontSize={8.5}>
              {t.label}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t.x}`}>
            <line x1={sx(t.x)} x2={sx(t.x)} y1={H - PAD.b} y2={H - PAD.b + 3} stroke="var(--color-line-strong)" />
            <text x={sx(t.x)} y={H - PAD.b + 12} textAnchor="middle" className="fill-muted num" fontSize={8.5}>
              {t.label}
            </text>
          </g>
        ))}
        <text x={W - PAD.r} y={H - 2} textAnchor="end" className="fill-muted" fontSize={8.5}>
          COG from {front} ({lenUnit})
        </text>
        <text x={4} y={PAD.t - 3} className="fill-muted" fontSize={8.5}>
          {sys === 'metric' ? 'payload (t)' : 'payload (1,000 lb)'}
        </text>
        <g clipPath={`url(#${clipId})`}>
          <path d={area} fill="var(--color-ok)" fillOpacity={0.12} />
          <path d={line} fill="none" stroke="var(--color-ok)" strokeWidth={1.75} strokeLinejoin="round" />
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(v.payloadKg)} y2={sy(v.payloadKg)} stroke="var(--color-ink-soft)" strokeDasharray="4 3" strokeWidth={1} />
        </g>
        <text x={W - PAD.r - 2} y={sy(v.payloadKg) - 3} textAnchor="end" className="fill-ink-soft" fontSize={8.5}>
          rated payload {formatMass(v.payloadKg, sys)}
        </text>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--color-line-strong)" />
        {cog && (
          <g>
            <line x1={sx(cog.x)} x2={sx(cog.x)} y1={sy(axle.cargoKg)} y2={H - PAD.b} stroke={color} strokeDasharray="2 2" />
            <circle cx={sx(cog.x)} cy={sy(axle.cargoKg)} r={5} fill={color} stroke="white" strokeWidth={1.75} />
          </g>
        )}
      </svg>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        {cog ? (
          <>
            Cargo COG <b className="num font-mono font-semibold">{formatLength(cog.x, sys, { big: true })}</b> from the {front}, {formatMass(axle.cargoKg, sys)} aboard; up to{' '}
            {formatMass(allowedHere, sys)} allowed there ({lowerFirst(limitedHere)}).{' '}
            {remaining.kg > 0 ? (
              <>
                <b className="num font-mono font-semibold">{formatMass(remaining.kg, sys)}</b> remaining; the {lowerFirst(remaining.limitedBy)} limits it here.
              </>
            ) : (
              <b className="text-bad">No capacity left: {lowerFirst(remaining.limitedBy)} limit broken.</b>
            )}
          </>
        ) : (
          <>
            Empty. Best case {formatMass(ve.peak.maxKg, sys)} with the COG {formatLength(ve.peak.x, sys, { big: true })} from the {front} ({lowerFirst(ve.peak.limitedBy)}).
          </>
        )}
      </p>
    </Section>
  );
}
