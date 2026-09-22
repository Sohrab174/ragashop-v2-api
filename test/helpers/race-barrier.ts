/**
 * Deterministic test-only synchronization for lifecycle race tests.
 */
export class RaceBarrier {
  private releaseGate!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });
  private signalReached!: () => void;
  readonly reached = new Promise<void>((resolve) => {
    this.signalReached = resolve;
  });

  markReached(): void {
    this.signalReached();
  }

  release(): void {
    this.releaseGate();
  }

  async waitUntilReached(timeoutMs = 15000, label = 'race'): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.reached,
        new Promise<void>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(new Error(`${label}: operation did not reach barrier`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  async pauseAtBarrier<T>(fn: () => Promise<T>): Promise<T> {
    this.markReached();
    await this.gate;
    return fn();
  }
}
