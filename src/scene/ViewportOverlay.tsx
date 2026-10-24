import { Camera, Keyboard } from 'lucide-react';
import { useMemo, type RefObject } from 'react';
import type { WebGLRenderer } from 'three';
import { heatColor } from '../domain/colors';
import type { ColorMode } from '../domain/types';
import { formatWeight } from '../domain/units';
import { downloadBlob, fileSlug } from '../io/planFile';
import { loadingSequence } from '../sim/sequence';
import { useActiveVehicle, useDisplayPlan, useEvaluation, useUnitSystem } from '../state/hooks';
import { useStore } from '../state/store';
import { Button } from '../ui/common/Button';
import { SegmentedControl } from '../ui/common/fields';
import { colorContext, legendEntries } from './palette';
import { useSceneUi, type CargoLook } from './sceneUi';

const COLOR_MODES: { value: ColorMode; label: string; title: string }[] = [
  { value: 'stop', label: 'Stop', title: 'Colour by delivery stop' },
  { value: 'customer', label: 'Customer', title: 'Colour by customer (item colours override)' },
  { value: 'temperature', label: 'Temp', title: 'Colour by temperature class' },
  { value: 'hazmat', label: 'Hazmat', title: 'Colour by dangerous-goods class' },
  { value: 'weight', label: 'Weight', title: 'Weight heat map' },
];

const LOOKS: { value: CargoLook; label: string; title: string }[] = [
  { value: 'realistic', label: 'Realistic', title: 'Cargo as realistic goods with colour tags' },
  { value: 'blocks', label: 'Blocks', title: 'Cargo as flat coloured blocks (analysis)' },
];

/** DOM overlay on the 3D viewport: colour mode, legend, snapshot, drag hints and the current load step. */
export function ViewportOverlay({ glRef }: { glRef: RefObject<WebGLRenderer | null> }) {
  const plan = useDisplayPlan();
  const evaluation = useEvaluation();
  const vehicle = useActiveVehicle();
  const units = useUnitSystem();
  const colorMode = useStore((s) => s.ui.colorMode);
  const setColorMode = useStore((s) => s.setColorMode);
  const dragging = useStore((s) => s.ui.drag !== null);
  const animation = useStore((s) => s.ui.animation);
  const toast = useStore((s) => s.toast);
  const look = useSceneUi((s) => s.look);
  const setLook = useSceneUi((s) => s.setLook);

  const ctx = useMemo(() => colorContext(plan, evaluation.units, colorMode), [plan, evaluation.units, colorMode]);
  const entries = useMemo(() => legendEntries(plan, evaluation.units, ctx), [plan, evaluation.units, ctx]);
  const loadStep = useMemo(() => {
    if (animation.mode !== 'load') return null;
    const seq = loadingSequence(plan, animation.vehicleId ?? vehicle.id);
    if (!seq.length) return null;
    const i = Math.min(animation.step, seq.length);
    return i >= seq.length ? { label: `All ${seq.length} units loaded`, index: null, total: seq.length } : { label: `${seq[i].name} → ${seq[i].position}`, index: i + 1, total: seq.length };
  }, [animation.mode, animation.vehicleId, animation.step, plan, vehicle.id]);

  const snapshot = () => {
    const canvas = glRef.current?.domElement;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${fileSlug(plan.name)}-${fileSlug(vehicle.name)}-3d.png`);
      else toast('Snapshot failed: the canvas could not be exported', 'error');
    }, 'image/png');
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-start gap-2">
          <div className="pointer-events-auto rounded-lg bg-card/90 shadow-sm backdrop-blur-sm">
            <SegmentedControl<ColorMode> size="sm" label="Colour cargo by" value={colorMode} onChange={setColorMode} options={COLOR_MODES} />
          </div>
          <div className="pointer-events-auto rounded-lg bg-card/90 shadow-sm backdrop-blur-sm">
            <SegmentedControl<CargoLook> size="sm" label="Cargo look" value={look} onChange={setLook} options={LOOKS} />
          </div>
        </div>
        <Button size="sm" className="pointer-events-auto bg-card/90 backdrop-blur-sm" icon={<Camera size={14} aria-hidden />} onClick={snapshot} aria-label="Download a PNG snapshot of the 3D view">
          Snapshot
        </Button>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="pointer-events-auto max-h-44 max-w-64 overflow-y-auto rounded-lg border border-line bg-card/90 px-2.5 py-2 text-[11px] shadow-sm backdrop-blur-sm" aria-label="Colour legend">
          {colorMode === 'weight' ? (
            <div className="flex flex-col gap-1">
              <span className="font-medium text-ink-soft">Unit weight</span>
              <div className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
              <div className="num flex justify-between font-mono text-muted">
                <span>{formatWeight(0, units)}</span>
                <span>{formatWeight(ctx.maxKg, units)}</span>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {entries.map((e) => (
                <li key={e.key} className="flex items-center gap-1.5 text-ink-soft">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10" style={{ background: e.color }} />
                  <span className="truncate">{e.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(dragging || loadStep) && (
          <div className="pointer-events-none mx-auto mb-0.5 flex items-center gap-1.5 rounded-full bg-ink/85 px-3 py-1 text-xs text-white shadow-card">
            {dragging ? (
              <>
                <Keyboard size={13} aria-hidden />
                <span>
                  <kbd className="font-mono">R</kbd> rotate · <kbd className="font-mono">Esc</kbd> cancel · release to drop
                </span>
              </>
            ) : (
              loadStep && (
                <span className="num">
                  {loadStep.index === null ? loadStep.label : `Step ${loadStep.index}/${loadStep.total}: ${loadStep.label}`}
                </span>
              )
            )}
          </div>
        )}
        <div className="w-px" />
      </div>
    </div>
  );
}
