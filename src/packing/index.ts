/**
 * Packing and optimisation: extreme-point 3D packing that honours every hard rule, simulated
 * annealing for axle loads at every stage, LIFO, COG window, lateral balance and stack quality,
 * a Web Worker client, single-unit placement and fleet proposals.
 */
import type { OptimiseRequest, OptimiseResult, WorkerMessage } from './types';

export { optimise } from './optimise';
export { findPlacementFor } from './place';
export { proposeVehicles } from './propose';
export type { OptimiseRequest, OptimiseResult } from './types';

/** Runs optimise() in a Web Worker. cancel() terminates the worker and rejects with Error('cancelled'). */
export function runOptimiseInWorker(req: OptimiseRequest, onProgress?: (fraction: number) => void): { promise: Promise<OptimiseResult>; cancel: () => void } {
  const worker = new Worker(new URL('./optimiser.worker.ts', import.meta.url), { type: 'module' });
  const { promise, resolve, reject } = Promise.withResolvers<OptimiseResult>();
  let settled = false;
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    worker.terminate();
    fn();
  };
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      if (!settled) onProgress?.(msg.fraction);
    } else if (msg.type === 'done') {
      settle(() => resolve(msg.result));
    } else {
      settle(() => reject(new Error(msg.message)));
    }
  };
  worker.onerror = (e: ErrorEvent) => {
    e.preventDefault();
    settle(() => reject(new Error(e.message || 'The optimiser failed')));
  };
  worker.postMessage(req);
  return { promise, cancel: () => settle(() => reject(new Error('cancelled'))) };
}
