import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CategoryEntity } from '../../category/entities/category.entity';
import { ProductEntity } from '../../product/entities/product.entity';
import {
  evaluateAssortmentPolicy,
  summarizeAssortmentDecisions,
} from './assortment-policy.evaluate';
import { planAssortmentRecompute } from './assortment-policy.recompute-plan';
import {
  AssortmentCategoryInput,
  AssortmentPolicyDecision,
  AssortmentPolicyRuleInput,
} from './assortment-policy.types';
import { AssortmentPolicyAuditEntity } from './entities/assortment-policy-audit.entity';
import { AssortmentPolicyRuleEntity } from './entities/assortment-policy-rule.entity';
import { AssortmentPolicyStateEntity } from './entities/assortment-policy-state.entity';
import { CategoryAssortmentResolutionEntity } from './entities/category-assortment-resolution.entity';

export type AssortmentRecomputeResult = {
  previousVersion: number;
  policyVersion: number;
  categoryCount: number;
  ruleCount: number;
  byStatus: Record<string, number>;
  changedCategoryIds: number[];
  /** False when rules + resolutions were unchanged (version not advanced). */
  changed: boolean;
};

export type AssortmentRecomputeOptions = {
  /** Set when the caller mutated rules in the same transaction. */
  rulesChanged?: boolean;
  /** Extra audit context merged into the recompute audit afterJson. */
  auditContext?: Record<string, unknown>;
};

export type AssortmentEvaluationInputs = {
  rules: AssortmentPolicyRuleInput[];
  categories: AssortmentCategoryInput[];
  liveProductCountByCategoryId: Record<number, number>;
};

export function toRuleInput(r: AssortmentPolicyRuleEntity): AssortmentPolicyRuleInput {
  return {
    id: Number(r.id),
    provider: r.provider,
    matchType: r.matchType,
    pathPrefixNorm: r.pathPrefixNorm,
    categoryId: r.categoryId == null ? null : Number(r.categoryId),
    status: r.status,
    reasonCode: r.reasonCode,
    businessDomain: r.businessDomain,
    isActive: !!r.isActive,
  };
}

@Injectable()
export class AssortmentPolicyRecomputeService {
  constructor(
    @InjectRepository(AssortmentPolicyRuleEntity)
    private readonly ruleRepo: Repository<AssortmentPolicyRuleEntity>,
    @InjectRepository(CategoryAssortmentResolutionEntity)
    private readonly resolutionRepo: Repository<CategoryAssortmentResolutionEntity>,
    @InjectRepository(AssortmentPolicyStateEntity)
    private readonly stateRepo: Repository<AssortmentPolicyStateEntity>,
    @InjectRepository(AssortmentPolicyAuditEntity)
    private readonly auditRepo: Repository<AssortmentPolicyAuditEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepo: Repository<CategoryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
  ) {}

  /** Read-only: the exact inputs a real recompute would evaluate. */
  async loadEvaluationInputs(
    manager?: EntityManager,
  ): Promise<AssortmentEvaluationInputs> {
    const em = manager || this.ruleRepo.manager;
    const rules = await em.find(AssortmentPolicyRuleEntity, {
      where: { isActive: true },
      order: { id: 'ASC' },
    });
    const categories = await em.find(CategoryEntity, {
      select: ['id', 'parentId', 'source', 'hierarchy'],
      order: { id: 'ASC' },
    });
    const liveRows: Array<{ categoryId: number; live: string }> =
      await em.query(
        `SELECT categoryId, COUNT(*) AS live
         FROM product
         WHERE isDeleted = 0
         GROUP BY categoryId`,
      );
    const liveProductCountByCategoryId: Record<number, number> = {};
    for (const row of liveRows) {
      liveProductCountByCategoryId[Number(row.categoryId)] = Number(row.live);
    }
    return {
      rules: rules.map(toRuleInput),
      categories: categories.map((c) => ({
        id: Number(c.id),
        parentId: c.parentId == null ? null : Number(c.parentId),
        source: c.source ?? null,
        hierarchy: c.hierarchy ?? null,
      })),
      liveProductCountByCategoryId,
    };
  }

  /** Pure evaluation over loaded inputs (used by preview and recompute). */
  evaluate(
    inputs: AssortmentEvaluationInputs,
    policyVersion: number,
  ): AssortmentPolicyDecision[] {
    const decisions = evaluateAssortmentPolicy({
      categories: inputs.categories,
      rules: inputs.rules,
      liveProductCountByCategoryId: inputs.liveProductCountByCategoryId,
      policyVersion,
    });
    this.assertCompleteResolution(inputs.categories, decisions);
    return decisions;
  }

  /**
   * Cheap gap check: source/local categories with no resolution row.
   * Used so new category creation does not force a full recompute unless needed.
   */
  async countMissingResolutions(manager?: EntityManager): Promise<number> {
    const em = manager || this.ruleRepo.manager;
    const rows: Array<{ missing: string | number }> = await em.query(
      `SELECT COUNT(*) AS missing
       FROM category c
       LEFT JOIN category_assortment_resolution r ON r.categoryId = c.id
       WHERE r.categoryId IS NULL`,
    );
    return Number(rows[0]?.missing ?? 0);
  }

  /**
   * Materialize resolutions for newly-created categories by reusing the
   * existing evaluator/recompute path. No-op (no version bump, no audit)
   * when every category already has a row — avoids full-table work on every
   * import. Does NOT invent parent→child inheritance outside the evaluator.
   */
  async materializeMissingResolutions(
    actor: string | null = 'system:materialize-missing',
  ): Promise<AssortmentRecomputeResult & { missingBefore: number }> {
    const missingBefore = await this.countMissingResolutions();
    if (missingBefore <= 0) {
      const state = await this.stateRepo.findOne({ where: { id: 1 } });
      const policyVersion = Number(state?.policyVersion ?? 0);
      return {
        previousVersion: policyVersion,
        policyVersion,
        categoryCount: 0,
        ruleCount: 0,
        byStatus: {},
        changedCategoryIds: [],
        changed: false,
        missingBefore: 0,
      };
    }
    const result = await this.recompute(actor, {
      auditContext: {
        trigger: 'materialize_missing',
        missingBefore,
      },
    });
    return { ...result, missingBefore };
  }

  /**
   * Evaluate + persist atomically. Idempotent: when active rules and the
   * resulting resolutions are unchanged nothing is written and the policy
   * version does not advance.
   */
  async recompute(
    actor: string | null = 'system:recompute',
    options: AssortmentRecomputeOptions = {},
  ): Promise<AssortmentRecomputeResult> {
    return this.ruleRepo.manager.transaction((em) =>
      this.recomputeWithin(em, actor, options),
    );
  }

  /** Same as recompute() but joins the caller's transaction. */
  async recomputeWithin(
    em: EntityManager,
    actor: string | null,
    options: AssortmentRecomputeOptions = {},
  ): Promise<AssortmentRecomputeResult> {
    const stateRows: Array<{ policyVersion: number }> = await em.query(
      `SELECT policyVersion FROM assortment_policy_state WHERE id = 1 FOR UPDATE`,
    );
    const previousVersion = Number(stateRows[0]?.policyVersion ?? 0);

    const inputs = await this.loadEvaluationInputs(em);
    const candidate = this.evaluate(inputs, previousVersion + 1);
    const previousResolutions = await em.find(
      CategoryAssortmentResolutionEntity,
    );
    const lastRuleFingerprint = await this.readLastRuleFingerprint(em);

    const plan = planAssortmentRecompute({
      previousVersion,
      previousResolutions: previousResolutions.map((r) => ({
        categoryId: Number(r.categoryId),
        status: r.status,
        reasonCode: r.reasonCode,
        ruleId: r.ruleId == null ? null : Number(r.ruleId),
        via: r.via,
        businessDomain: r.businessDomain ?? null,
      })),
      decisions: candidate,
      rules: inputs.rules,
      lastRuleFingerprint,
      rulesChanged: options.rulesChanged,
    });

    const byStatus = summarizeAssortmentDecisions(candidate);
    if (!plan.changed) {
      return {
        previousVersion,
        policyVersion: previousVersion,
        categoryCount: candidate.length,
        ruleCount: inputs.rules.length,
        byStatus,
        changedCategoryIds: [],
        changed: false,
      };
    }

    await this.persistResolutions(em, candidate, plan.policyVersion);
    await em.update(
      AssortmentPolicyStateEntity,
      { id: 1 },
      { policyVersion: plan.policyVersion, updatedAt: new Date() },
    );
    await em.insert(AssortmentPolicyAuditEntity, {
      operation: 'resolution_recompute',
      ruleId: null,
      actor,
      beforeJson: {
        policyVersion: previousVersion,
        resolutionCount: previousResolutions.length,
      },
      afterJson: {
        policyVersion: plan.policyVersion,
        resolutionCount: candidate.length,
        byStatus,
        changedCount: plan.changedCategoryIds.length,
        removedCount: plan.removedCategoryIds.length,
        rulesChanged: plan.rulesChanged,
        ruleFingerprint: plan.ruleFingerprint,
        ...(options.auditContext || {}),
      },
      policyVersion: plan.policyVersion,
      createdAt: new Date(),
    });

    return {
      previousVersion,
      policyVersion: plan.policyVersion,
      categoryCount: candidate.length,
      ruleCount: inputs.rules.length,
      byStatus,
      changedCategoryIds: plan.changedCategoryIds,
      changed: true,
    };
  }

  private async readLastRuleFingerprint(
    em: EntityManager,
  ): Promise<string | null> {
    const rows: Array<{ afterJson: unknown }> = await em.query(
      `SELECT afterJson FROM assortment_policy_audit
       WHERE operation = 'resolution_recompute'
       ORDER BY id DESC LIMIT 1`,
    );
    if (!rows.length) return null;
    let after = rows[0].afterJson as any;
    if (typeof after === 'string') {
      try {
        after = JSON.parse(after);
      } catch {
        return null;
      }
    }
    const fp = after?.ruleFingerprint;
    return typeof fp === 'string' && fp ? fp : null;
  }

  private assertCompleteResolution(
    categories: AssortmentCategoryInput[],
    decisions: AssortmentPolicyDecision[],
  ): void {
    if (decisions.length !== categories.length) {
      throw new Error(
        `Assortment recompute incomplete: expected ${categories.length} decisions, got ${decisions.length}`,
      );
    }
    const ids = new Set(decisions.map((d) => d.categoryId));
    for (const c of categories) {
      if (!ids.has(c.id)) {
        throw new Error(
          `Assortment recompute missing decision for category ${c.id}`,
        );
      }
    }
    for (const d of decisions) {
      if (
        d.status !== 'IN_SCOPE' &&
        d.status !== 'OUT_OF_SCOPE' &&
        d.status !== 'REVIEW_REQUIRED'
      ) {
        throw new Error(`Invalid status for category ${d.categoryId}`);
      }
      if (d.status === 'OUT_OF_SCOPE' && d.via === 'unclassified') {
        throw new Error(
          `Fail-safe violation: unclassified category ${d.categoryId} resolved OUT`,
        );
      }
    }
  }

  private async persistResolutions(
    em: EntityManager,
    decisions: AssortmentPolicyDecision[],
    policyVersion: number,
  ): Promise<void> {
    const now = new Date();
    // Replace set inside the transaction so a failure leaves the prior set intact.
    await em
      .createQueryBuilder()
      .delete()
      .from(CategoryAssortmentResolutionEntity)
      .execute();

    if (!decisions.length) return;

    const chunkSize = 200;
    for (let i = 0; i < decisions.length; i += chunkSize) {
      const chunk = decisions.slice(i, i + chunkSize).map((d) => ({
        categoryId: d.categoryId,
        status: d.status,
        reasonCode: d.reasonCode,
        ruleId: d.ruleId,
        via: d.via,
        businessDomain: d.businessDomain,
        policyVersion,
        resolvedAt: now,
      }));
      await em.insert(CategoryAssortmentResolutionEntity, chunk);
    }
  }
}
