import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AssortmentPolicyAuditEntity } from './entities/assortment-policy-audit.entity';
import { AssortmentPolicyRuleEntity } from './entities/assortment-policy-rule.entity';
import { AssortmentPolicyStateEntity } from './entities/assortment-policy-state.entity';
import { AssortmentRuleDraft } from './assortment-policy.types';
import {
  AssortmentPolicyRuleValidationError,
  validateAssortmentRuleDraft,
} from './assortment-policy.validate';

function serializeRule(
  rule: AssortmentPolicyRuleEntity | null,
): Record<string, unknown> | null {
  if (!rule) return null;
  return {
    id: rule.id,
    provider: rule.provider,
    matchType: rule.matchType,
    pathPrefixNorm: rule.pathPrefixNorm,
    categoryId: rule.categoryId,
    selectorKey: rule.selectorKey,
    status: rule.status,
    reasonCode: rule.reasonCode,
    businessDomain: rule.businessDomain,
    note: rule.note,
    isActive: !!rule.isActive,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
  };
}

@Injectable()
export class AssortmentPolicyRuleService {
  constructor(
    @InjectRepository(AssortmentPolicyRuleEntity)
    private readonly ruleRepo: Repository<AssortmentPolicyRuleEntity>,
    @InjectRepository(AssortmentPolicyAuditEntity)
    private readonly auditRepo: Repository<AssortmentPolicyAuditEntity>,
    @InjectRepository(AssortmentPolicyStateEntity)
    private readonly stateRepo: Repository<AssortmentPolicyStateEntity>,
  ) {}

  async getPolicyVersion(): Promise<number> {
    const state = await this.stateRepo.findOne({ where: { id: 1 } });
    return state?.policyVersion ?? 0;
  }

  async listActiveRules(): Promise<AssortmentPolicyRuleEntity[]> {
    return this.ruleRepo.find({
      where: { isActive: true },
      order: { id: 'ASC' },
    });
  }

  async listAllRules(): Promise<AssortmentPolicyRuleEntity[]> {
    return this.ruleRepo.find({ order: { id: 'ASC' } });
  }

  /**
   * Create a structurally valid rule + append-only audit row.
   * Does NOT recompute resolutions (caller decides).
   */
  async createRule(
    draft: AssortmentRuleDraft,
    actor: string | null,
    manager?: EntityManager,
  ): Promise<AssortmentPolicyRuleEntity> {
    const validated = validateAssortmentRuleDraft(draft);
    const run = async (em: EntityManager) => {
      const existing = await em.findOne(AssortmentPolicyRuleEntity, {
        where: { selectorKey: validated.selectorKey },
      });
      if (existing) {
        throw new AssortmentPolicyRuleValidationError(
          `Duplicate selectorKey: ${validated.selectorKey}`,
          'duplicate_selector',
        );
      }

      const now = new Date();
      const rule = em.create(AssortmentPolicyRuleEntity, {
        provider: validated.provider,
        matchType: validated.matchType,
        pathPrefixNorm: validated.pathPrefixNorm,
        categoryId: validated.categoryId,
        selectorKey: validated.selectorKey,
        status: validated.status,
        reasonCode: validated.reasonCode,
        businessDomain: validated.businessDomain,
        note: validated.note,
        isActive: validated.isActive,
        createdBy: actor,
        createdAt: now,
        updatedBy: actor,
        updatedAt: now,
      });
      const saved = await em.save(AssortmentPolicyRuleEntity, rule);
      const version = await this.readVersion(em);
      await em.insert(AssortmentPolicyAuditEntity, {
        operation: 'rule_create',
        ruleId: saved.id,
        actor,
        beforeJson: null,
        afterJson: serializeRule(saved),
        policyVersion: version,
        createdAt: now,
      });
      return saved;
    };

    if (manager) return run(manager);
    return this.ruleRepo.manager.transaction(run);
  }

  /**
   * Update an existing rule in place + audit.
   * Does NOT recompute resolutions.
   */
  async updateRule(
    ruleId: number,
    patch: Partial<AssortmentRuleDraft> & { isActive?: boolean },
    actor: string | null,
    manager?: EntityManager,
  ): Promise<AssortmentPolicyRuleEntity> {
    const run = async (em: EntityManager) => {
      const existing = await em.findOne(AssortmentPolicyRuleEntity, {
        where: { id: ruleId },
      });
      if (!existing) {
        throw new AssortmentPolicyRuleValidationError(
          `Rule not found: ${ruleId}`,
          'invalid_selector',
        );
      }
      const before = serializeRule(existing);
      const draft: AssortmentRuleDraft = {
        provider:
          patch.provider !== undefined ? patch.provider : existing.provider,
        matchType: (patch.matchType ||
          existing.matchType) as AssortmentRuleDraft['matchType'],
        pathPrefix:
          patch.pathPrefix !== undefined
            ? patch.pathPrefix
            : existing.pathPrefixNorm,
        categoryId:
          patch.categoryId !== undefined
            ? patch.categoryId
            : existing.categoryId,
        status: (patch.status ||
          existing.status) as AssortmentRuleDraft['status'],
        reasonCode: patch.reasonCode || existing.reasonCode,
        businessDomain:
          patch.businessDomain !== undefined
            ? patch.businessDomain
            : existing.businessDomain,
        note: patch.note !== undefined ? patch.note : existing.note,
        isActive:
          patch.isActive !== undefined ? patch.isActive : existing.isActive,
      };
      const validated = validateAssortmentRuleDraft(draft);
      if (validated.selectorKey !== existing.selectorKey) {
        const clash = await em.findOne(AssortmentPolicyRuleEntity, {
          where: { selectorKey: validated.selectorKey },
        });
        if (clash && clash.id !== existing.id) {
          throw new AssortmentPolicyRuleValidationError(
            `Duplicate selectorKey: ${validated.selectorKey}`,
            'duplicate_selector',
          );
        }
      }

      existing.provider = validated.provider;
      existing.matchType = validated.matchType;
      existing.pathPrefixNorm = validated.pathPrefixNorm;
      existing.categoryId = validated.categoryId;
      existing.selectorKey = validated.selectorKey;
      existing.status = validated.status;
      existing.reasonCode = validated.reasonCode;
      existing.businessDomain = validated.businessDomain;
      existing.note = validated.note;
      existing.isActive = validated.isActive;
      existing.updatedBy = actor;
      const saved = await em.save(AssortmentPolicyRuleEntity, existing);
      const version = await this.readVersion(em);
      await em.insert(AssortmentPolicyAuditEntity, {
        operation: 'rule_update',
        ruleId: saved.id,
        actor,
        beforeJson: before,
        afterJson: serializeRule(saved),
        policyVersion: version,
        createdAt: new Date(),
      });
      return saved;
    };

    if (manager) return run(manager);
    return this.ruleRepo.manager.transaction(run);
  }

  private async readVersion(em: EntityManager): Promise<number> {
    const state = await em.findOne(AssortmentPolicyStateEntity, {
      where: { id: 1 },
    });
    return state?.policyVersion ?? 0;
  }
}
