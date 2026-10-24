import { Crosshair } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatLength, formatPercent, formatWeight, lbToKg, M_PER_FT } from '../../domain/units';
import { bridgeFormulaChecks, lateralImbalance } from '../../physics';
import { useUnitSystem } from '../../state/hooks';
import { Chip } from '../common/Chip';
import { frontLabel } from './bulk';
import { Section } from './Section';
import { formatLinearLoad } from './shellFormat';
import type { ShownState } from './useShownState';

function Row({ label, value, sub, ok }: { label: string; value: ReactNode; sub?: ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-1 text-xs">
      <span className="w-28 shrink-0 text-ink-soft">{label}</span>
      <span className="flex-1 text-right">
        <span className="num font-mono text-[11.5px] text-ink">{value}</span>
        {sub && <span className="block text-[11px] text-muted">{sub}</span>}
      </span>
      {ok !== undefined && (
        <Chip tone={ok ? 'ok' : 'bad'} className="w-11 justify-center">
          {ok ? 'OK' : 'Over'}
        </Chip>
      )}
    </div>
  );
}

/** Cargo COG (longitudinal, lateral, height), floor load and Bridge Formula readout for the shown state. */
export function CogPanel({ shown }: { shown: ShownState }) {
  const sys = useUnitSystem();
  const { axle, vehicleEval: ve } = shown;
  const v = ve.vehicle;
  const cog = axle.cog;
  const lateral = lateralImbalance(v, cog);
  const bridge = v.bridgeFormula ? (shown.stage === 0 ? ve.bridge : bridgeFormulaChecks(v, axle)) : [];
  const worstBridge = bridge.reduce<(typeof bridge)[number] | null>((w, b) => (!w || b.actualLb / b.allowedLb > w.actualLb / w.allowedLb ? b : w), null);

  return (
    <Section title="Centre of gravity" icon={<Crosshair />}>
      {cog ? (
        <div className="divide-y divide-line/70">
          <Row
            label={`From ${frontLabel(v)}`}
            value={formatLength(cog.x, sys, { big: true })}
            sub={`of ${formatLength(v.cargo.l, sys, { big: true })} ${v.bulk ? (v.bulk.kind === 'tipper' ? 'body' : 'tank') : 'floor'}`}
          />
          <Row
            label="Lateral offset"
            value={Math.abs(cog.y - v.cargo.w / 2) < 0.005 ? 'centred' : `${formatLength(Math.abs(cog.y - v.cargo.w / 2), sys, { unit: sys === 'metric' ? 'cm' : 'in' })} ${cog.y < v.cargo.w / 2 ? 'left' : 'right'}`}
            sub={`imbalance ${formatPercent(lateral)} (max ${formatPercent(v.lateralMaxImbalance)})`}
            ok={lateral <= v.lateralMaxImbalance + 1e-9}
          />
          <Row
            label="Height above floor"
            value={formatLength(cog.z, sys, { big: true })}
            sub={`${formatLength(cog.z + v.deckHeight, sys, { big: true })} above ground · max ${formatLength(v.maxCogHeight, sys, { big: true })}`}
            ok={cog.z <= v.maxCogHeight + 1e-9}
          />
          {shown.stage === 0 && !v.bulk && (
            <Row
              label="Floor peak load"
              value={formatLinearLoad(ve.floorPeak.kgPerM, sys)}
              sub={`rating ${formatLinearLoad(v.floorKgPerM, sys)} · at ${formatLength(ve.floorPeak.x, sys, { big: true })}`}
              ok={ve.floorPeak.kgPerM <= v.floorKgPerM + 0.5}
            />
          )}
          {worstBridge && (
            <Row
              label="Bridge Formula"
              value={`${formatWeight(lbToKg(worstBridge.actualLb), sys)} / ${formatWeight(lbToKg(worstBridge.allowedLb), sys)}`}
              sub={`worst group: ${worstBridge.label}, ${worstBridge.n} axles over ${formatLength(worstBridge.lengthFt * M_PER_FT, sys, { big: true })}`}
              ok={bridge.every((b) => b.ok)}
            />
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">No cargo aboard{shown.stage ? ` ${shown.caption}` : ''}.</p>
      )}
    </Section>
  );
}
