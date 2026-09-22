import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Persisted keyset cursor for A5 catalog refresh fair progression.
 * One row per scope (global or source-filtered).
 *
 * `revision` is the authoritative optimistic-concurrency token (ABA-safe).
 * Matching afterProductId alone must never authorize a commit.
 *
 * scopeKey capacity: "source:" (7) + max DTO source (64) = 71 → varchar(96).
 */
@Entity('catalog_refresh_checkpoint')
export class CatalogRefreshCheckpointEntity {
  @PrimaryColumn('varchar', { name: 'scopeKey', length: 96 })
  scopeKey: string;

  /** Exclusive lower bound for the next candidate keyset scan (product.id). */
  @Column('bigint', { name: 'afterProductId', default: 0 })
  afterProductId: string | number;

  /**
   * Monotonic generation counter. Incremented on every successful commit.
   * Uninitialized / missing row is treated as revision 0 by the executor.
   */
  @Column('bigint', { name: 'revision', default: 0 })
  revision: string | number;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt: Date;
}

/** Max source filter length accepted by CatalogRefreshRunDto. */
export const CATALOG_REFRESH_SOURCE_FILTER_MAX_LENGTH = 64;

/** DB/entity capacity for scopeKey ("source:" + source + headroom). */
export const CATALOG_REFRESH_CHECKPOINT_SCOPE_KEY_MAX_LENGTH = 96;

export function catalogRefreshCheckpointScopeKey(
  sourceFilter: string | null,
): string {
  if (sourceFilter && sourceFilter.trim()) {
    const key = `source:${sourceFilter.trim().toLowerCase()}`;
    if (key.length > CATALOG_REFRESH_CHECKPOINT_SCOPE_KEY_MAX_LENGTH) {
      throw new Error(
        `catalog refresh checkpoint scopeKey exceeds ${CATALOG_REFRESH_CHECKPOINT_SCOPE_KEY_MAX_LENGTH} chars`,
      );
    }
    return key;
  }
  return 'global';
}

export type CatalogRefreshCheckpointSnapshot = {
  afterProductId: number;
  revision: number;
};
