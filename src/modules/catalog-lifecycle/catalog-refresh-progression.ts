/**
 * Pure helpers for A5 catalog refresh keyset progression.
 * Advance based on SCANNED window, not enqueue success.
 */

export type CatalogRefreshScanProgressInput = {
  /** Exclusive lower bound used for this scan. */
  scanAfterProductId: number;
  /** Product ids loaded in the bounded window (ascending). */
  scannedProductIds: number[];
  /** Cap used for this scan. */
  candidateWindowCap: number;
};

export type CatalogRefreshScanProgressResult = {
  /** Max id observed in the scanned window (0 if empty). */
  scannedMaxProductId: number;
  /** Next exclusive lower bound for the following cycle. */
  proposedNextAfterProductId: number;
  /** True when progression wraps to the start of the keyspace. */
  wrapped: boolean;
  /** True when the scanned window was a full capacity page. */
  fullWindow: boolean;
};

/**
 * Compute next keyset cursor from what was SCANNED.
 * - Full window → continue after max scanned id
 * - Empty or short window → wrap to 0 (end of keyspace)
 */
export function computeCatalogRefreshScanProgress(
  input: CatalogRefreshScanProgressInput,
): CatalogRefreshScanProgressResult {
  const ids = input.scannedProductIds.filter((id) => Number.isFinite(id) && id > 0);
  const scannedMaxProductId = ids.length ? Math.max(...ids) : 0;
  const fullWindow =
    ids.length > 0 && ids.length >= input.candidateWindowCap;

  if (!fullWindow) {
    return {
      scannedMaxProductId,
      proposedNextAfterProductId: 0,
      wrapped: true,
      fullWindow: false,
    };
  }

  return {
    scannedMaxProductId,
    proposedNextAfterProductId: scannedMaxProductId,
    wrapped: false,
    fullWindow: true,
  };
}
