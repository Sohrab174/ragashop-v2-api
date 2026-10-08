/**
 * SCOPE-3/4 — read-only AUTO-MAP dry-run gated by assortment policy.
 *
 * Runs the same AUTO-MAP-0 pipeline as `catalog:auto-map:analyze` and applies
 * the assortment gate: only IN_SCOPE nodes receive mapping tiers; REVIEW goes
 * to the assortment queue; OUT stops. Never writes mappings.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { discoveryEligibilitySql } from '../../product/discovery-eligibility';
import { ProductEntity } from '../../product/entities/product.entity';
import { AutoMapTier, TIER_ORDER } from '../auto-map-0.matcher';
import { AutoMapProductRow, buildAutoMapContext } from '../auto-map-0.pipeline';
import {
  AssortmentAwareCoverage,
  buildAssortmentAwareCoverage,
  resolveAssortmentGate,
} from './assortment-auto-map.gate';

export type AssortmentAutoMapNode = {
  sourceCategoryId: number;
  assortmentStatus: string | null;
  gate: string;
  tier: AutoMapTier | null;
  ownDiscoverable: number;
  routedOwn: number;
};

export type AssortmentAutoMapResult = {
  policyVersion: number;
  coverage: AssortmentAwareCoverage;
  inScopeByTier: Record<
    string,
    { categories: number; products: number; routable: number }
  >;
  nodes: AssortmentAutoMapNode[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AssortmentAutoMapService {
  private cache: { key: string; at: number; value: AssortmentAutoMapResult } | null =
    null;

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
  ) {}

  async computeAdmin(): Promise<AssortmentAutoMapResult> {
    const stateRows: Array<{ policyVersion: number }> =
      await this.productRepo.query(
        `SELECT policyVersion FROM assortment_policy_state WHERE id = 1`,
      );
    const policyVersion = Number(stateRows[0]?.policyVersion ?? 0);
    const key = `v${policyVersion}`;
    if (
      this.cache &&
      this.cache.key === key &&
      Date.now() - this.cache.at < CACHE_TTL_MS
    ) {
      return this.cache.value;
    }

    const [canonicals, categories, products, resolutions] = await Promise.all([
      this.productRepo.query(
        `SELECT id, parentId, name, status, audience FROM canonical_category ORDER BY id`,
      ),
      this.productRepo.query(
        `SELECT id, parentId, source, sourceName, name, hierarchy, bankTypeName,
                gender, status
         FROM category ORDER BY id`,
      ),
      this.productRepo.query(
        `SELECT p.id, p.categoryId, p.gender, p.ageGroup, p.sourceName
         FROM product p
         WHERE p.isDeleted = 0 AND p.status = 'active' AND p.price > 0
           AND p.categoryId != 1 AND ${discoveryEligibilitySql('p')}`,
      ) as Promise<AutoMapProductRow[]>,
      this.productRepo.query(
        `SELECT categoryId, status FROM category_assortment_resolution`,
      ),
    ]);

    const value = this.evaluate({
      policyVersion,
      canonicals,
      categories,
      products,
      resolutions,
    });
    this.cache = { key, at: Date.now(), value };
    return value;
  }

  /** Pure core (exported for tests). */
  evaluate(input: {
    policyVersion: number;
    canonicals: any[];
    categories: any[];
    products: AutoMapProductRow[];
    resolutions: Array<{ categoryId: number; status: string }>;
  }): AssortmentAutoMapResult {
    const statusById = new Map(
      input.resolutions.map((r) => [Number(r.categoryId), String(r.status)]),
    );
    const ctx = buildAutoMapContext({
      canonicals: input.canonicals,
      categories: input.categories,
      products: input.products,
    });

    const inScopeByTier: AssortmentAutoMapResult['inScopeByTier'] = {};
    for (const t of TIER_ORDER)
      inScopeByTier[t] = { categories: 0, products: 0, routable: 0 };

    const highIds = new Set<number>();
    const highSuggestIds = new Set<number>();
    const nodes: AssortmentAutoMapNode[] = [];
    let missingCats = 0;
    let missingProducts = 0;

    for (const id of ctx.productNodes) {
      const st = statusById.get(id) ?? null;
      const gate = resolveAssortmentGate(st);
      const own = ctx.ownDist.get(id)?.total || 0;
      if (!gate.mappingEligible) {
        nodes.push({
          sourceCategoryId: id,
          assortmentStatus: st,
          gate: gate.action,
          tier: null,
          ownDiscoverable: own,
          routedOwn: 0,
        });
        continue;
      }
      const r = ctx.evaluate(id);
      const routed = ctx.routedOwnProductIds(id, r.rules);
      const bucket = inScopeByTier[r.tier];
      bucket.categories++;
      bucket.products += own;
      bucket.routable += routed.length;
      if (r.tier === 'AUTO_MAP_HIGH_CONFIDENCE') {
        for (const pid of routed) {
          highIds.add(pid);
          highSuggestIds.add(pid);
        }
      } else if (r.tier === 'AUTO_SUGGEST_REVIEW') {
        for (const pid of routed) highSuggestIds.add(pid);
      } else if (r.tier === 'NO_DESTINATION') {
        missingCats++;
        missingProducts += own;
      }
      nodes.push({
        sourceCategoryId: id,
        assortmentStatus: st,
        gate: gate.action,
        tier: r.tier,
        ownDiscoverable: own,
        routedOwn: routed.length,
      });
    }

    const byStatus: Record<
      string,
      { categories: number; discoverableProducts: number }
    > = {
      IN_SCOPE: { categories: 0, discoverableProducts: 0 },
      REVIEW_REQUIRED: { categories: 0, discoverableProducts: 0 },
      OUT_OF_SCOPE: { categories: 0, discoverableProducts: 0 },
    };
    for (const [cid, st] of statusById) {
      if (!byStatus[st]) continue;
      byStatus[st].categories++;
      byStatus[st].discoverableProducts += ctx.ownDist.get(cid)?.total || 0;
    }

    const coverage = buildAssortmentAwareCoverage({
      totalDiscoverable: ctx.totalDiscoverable,
      byStatus,
      inScopeMissingDestination: {
        categories: missingCats,
        discoverableProducts: missingProducts,
      },
      autoMapHighRoutable: highIds.size,
      autoMapHighSuggestRoutable: highSuggestIds.size,
    });

    return {
      policyVersion: input.policyVersion,
      coverage,
      inScopeByTier,
      nodes,
    };
  }

  invalidate(): void {
    this.cache = null;
  }
}
