/** Web Worker running optimise() off the main thread; see runOptimiseInWorker. */
import { optimise } from './optimise';
import type { OptimiseRequest, WorkerMessage } from './types';

/** The worker global scope, narrowed to what this worker uses (tsconfig targets the DOM lib). */
interface OptimiserScope {
  onmessage: ((e: MessageEvent<OptimiseRequest>) => void) | null;
  postMessage(message: WorkerMessage): void;
}

const scope = self as unknown as OptimiserScope;

scope.onmessage = (e) => {
  try {
    const result = optimise(e.data, (fraction) => scope.postMessage({ type: 'progress', fraction }));
    scope.postMessage({ type: 'done', result });
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
