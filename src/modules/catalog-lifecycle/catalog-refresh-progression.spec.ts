import { computeCatalogRefreshScanProgress } from './catalog-refresh-progression';

describe('A5 catalog refresh progression (Fix #1)', () => {
  it('full window advances cursor to scanned max (not enqueue-dependent)', () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    const result = computeCatalogRefreshScanProgress({
      scanAfterProductId: 0,
      scannedProductIds: ids,
      candidateWindowCap: 200,
    });
    expect(result.fullWindow).toBe(true);
    expect(result.wrapped).toBe(false);
    expect(result.scannedMaxProductId).toBe(200);
    expect(result.proposedNextAfterProductId).toBe(200);
  });

  it('subsequent cycle after full fresh window reaches overdue id beyond window', () => {
    const first = computeCatalogRefreshScanProgress({
      scanAfterProductId: 0,
      scannedProductIds: Array.from({ length: 200 }, (_, i) => i + 1),
      candidateWindowCap: 200,
    });
    expect(first.proposedNextAfterProductId).toBe(200);

    const second = computeCatalogRefreshScanProgress({
      scanAfterProductId: first.proposedNextAfterProductId,
      scannedProductIds: [201, 202],
      candidateWindowCap: 200,
    });
    // Short window → wrap, but 201 was scanned this cycle
    expect(second.scannedMaxProductId).toBe(202);
    expect(second.wrapped).toBe(true);
    expect(second.proposedNextAfterProductId).toBe(0);
  });

  it('empty window wraps to beginning', () => {
    const result = computeCatalogRefreshScanProgress({
      scanAfterProductId: 9000,
      scannedProductIds: [],
      candidateWindowCap: 200,
    });
    expect(result.wrapped).toBe(true);
    expect(result.proposedNextAfterProductId).toBe(0);
  });

  it('fresh/non-selected rows still advance when window is full', () => {
    const result = computeCatalogRefreshScanProgress({
      scanAfterProductId: 0,
      scannedProductIds: Array.from({ length: 200 }, (_, i) => i + 1),
      candidateWindowCap: 200,
    });
    expect(result.proposedNextAfterProductId).toBe(200);
  });

  it('candidate window remains bounded by cap input', () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    const result = computeCatalogRefreshScanProgress({
      scanAfterProductId: 0,
      scannedProductIds: ids,
      candidateWindowCap: 200,
    });
    expect(ids.length).toBeLessThanOrEqual(200);
    expect(result.fullWindow).toBe(true);
  });
});
