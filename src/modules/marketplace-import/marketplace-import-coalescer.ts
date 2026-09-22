import { Injectable } from '@nestjs/common';

@Injectable()
export class MarketplaceImportCoalescer {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async coalesce<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = factory().finally(() => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  reset(): void {
    this.inFlight.clear();
  }
}
