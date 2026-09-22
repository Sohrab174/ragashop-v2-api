import { CatalogLifecycleRuntimeConfig } from './catalog-lifecycle.config';

type CircuitState = {
  failures: number[];
  openUntil: number | null;
};

/**
 * In-process circuit breaker for BACKGROUND catalog refresh only.
 * Does not mark products unavailable. Customer imports are not gated here.
 *
 * Deployment limits (carry-forward for multi-instance):
 * - Safe only for a single API/runtime process: state is process-local Map.
 * - After process restart, open circuits reset (fail-open until threshold again).
 * - Multi-instance production should share Redis/DB circuit state if required.
 */
export class CatalogRefreshCircuitBreaker {
  private readonly bySource = new Map<string, CircuitState>();

  constructor(private readonly config: CatalogLifecycleRuntimeConfig) {}

  isOpen(source: string, now: Date = new Date()): boolean {
    const state = this.bySource.get(source);
    if (!state?.openUntil) return false;
    if (now.getTime() >= state.openUntil) {
      state.openUntil = null;
      state.failures = [];
      return false;
    }
    return true;
  }

  recordSuccess(source: string): void {
    this.bySource.set(source, { failures: [], openUntil: null });
  }

  recordFailure(source: string, now: Date = new Date()): void {
    const state = this.bySource.get(source) || {
      failures: [],
      openUntil: null,
    };
    const windowStart = now.getTime() - this.config.circuitWindowMs;
    state.failures = state.failures.filter((t) => t >= windowStart);
    state.failures.push(now.getTime());
    if (state.failures.length >= this.config.circuitFailureThreshold) {
      state.openUntil = now.getTime() + this.config.circuitCooldownMs;
      state.failures = [];
    }
    this.bySource.set(source, state);
  }

  /** Test/reset helper */
  reset(source?: string): void {
    if (source) this.bySource.delete(source);
    else this.bySource.clear();
  }
}
