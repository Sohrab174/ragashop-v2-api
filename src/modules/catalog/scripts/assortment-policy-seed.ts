/**
 * SCOPE-2 — seed initial assortment policy rules + atomic recompute.
 *
 * Usage (from ragashop-api):
 *   npm run catalog:assortment-policy:seed
 *
 * Idempotent for the initial path-rule set: existing selectorKeys are left
 * unchanged; missing drafts are inserted. Resolutions + policy version are
 * only rewritten when rules or resulting resolutions actually changed.
 */
import { createConnection } from 'typeorm';
import {
  ASSORTMENT_POLICY_SYSTEM_ACTOR,
  SCOPE2_INITIAL_PATH_RULE_DRAFTS,
} from '../assortment-policy/assortment-policy.seed-data';
import {
  evaluateAssortmentPolicy,
  summarizeAssortmentDecisions,
} from '../assortment-policy/assortment-policy.evaluate';
import { validateAssortmentRuleDraft } from '../assortment-policy/assortment-policy.validate';
import { planAssortmentRecompute } from '../assortment-policy/assortment-policy.recompute-plan';

async function main() {
  const conn = await createConnection();
  const qr = conn.createQueryRunner();
  await qr.connect();
  try {
    const stateRows = await qr.query(
      `SELECT policyVersion FROM assortment_policy_state WHERE id = 1`,
    );
    if (!stateRows.length) {
      throw new Error(
        'assortment_policy_state missing — run migration 197 first',
      );
    }
    const previousVersion = Number(stateRows[0].policyVersion);

    let inserted = 0;
    let skipped = 0;
    for (const draft of SCOPE2_INITIAL_PATH_RULE_DRAFTS) {
      const validated = validateAssortmentRuleDraft(draft);
      const existing = await qr.query(
        `SELECT id FROM assortment_policy_rule WHERE selectorKey = ? LIMIT 1`,
        [validated.selectorKey],
      );
      if (existing.length) {
        skipped++;
        continue;
      }
      const now = new Date();
      const result = await qr.query(
        `INSERT INTO assortment_policy_rule
          (provider, matchType, pathPrefixNorm, categoryId, selectorKey,
           status, reasonCode, businessDomain, note, isActive,
           createdBy, createdAt, updatedBy, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          validated.provider,
          validated.matchType,
          validated.pathPrefixNorm,
          validated.categoryId,
          validated.selectorKey,
          validated.status,
          validated.reasonCode,
          validated.businessDomain,
          validated.note,
          ASSORTMENT_POLICY_SYSTEM_ACTOR,
          now,
          ASSORTMENT_POLICY_SYSTEM_ACTOR,
          now,
        ],
      );
      const ruleId = Number(result.insertId);
      await qr.query(
        `INSERT INTO assortment_policy_audit
          (operation, ruleId, actor, beforeJson, afterJson, policyVersion, createdAt)
         VALUES ('rule_create', ?, ?, NULL, ?, ?, ?)`,
        [
          ruleId,
          ASSORTMENT_POLICY_SYSTEM_ACTOR,
          JSON.stringify({
            id: ruleId,
            selectorKey: validated.selectorKey,
            status: validated.status,
            reasonCode: validated.reasonCode,
            businessDomain: validated.businessDomain,
            isActive: true,
          }),
          previousVersion,
          now,
        ],
      );
      inserted++;
    }

    const rules = await qr.query(
      `SELECT id, provider, matchType, pathPrefixNorm, categoryId, status,
              reasonCode, businessDomain, isActive
       FROM assortment_policy_rule
       WHERE isActive = 1
       ORDER BY id ASC`,
    );
    const categories = await qr.query(
      `SELECT id, parentId, source, hierarchy FROM category ORDER BY id ASC`,
    );
    const liveRows = await qr.query(
      `SELECT categoryId, COUNT(*) AS live
       FROM product WHERE isDeleted = 0 GROUP BY categoryId`,
    );
    const liveProductCountByCategoryId: Record<number, number> = {};
    for (const row of liveRows) {
      liveProductCountByCategoryId[Number(row.categoryId)] = Number(row.live);
    }

    const ruleInputs = rules.map((r: any) => ({
      id: Number(r.id),
      provider: r.provider,
      matchType: r.matchType,
      pathPrefixNorm: r.pathPrefixNorm,
      categoryId: r.categoryId == null ? null : Number(r.categoryId),
      status: r.status,
      reasonCode: r.reasonCode,
      businessDomain: r.businessDomain,
      isActive: !!r.isActive,
    }));
    const decisions = evaluateAssortmentPolicy({
      categories: categories.map((c: any) => ({
        id: Number(c.id),
        parentId: c.parentId == null ? null : Number(c.parentId),
        source: c.source ?? null,
        hierarchy: c.hierarchy ?? null,
      })),
      rules: ruleInputs,
      liveProductCountByCategoryId,
      policyVersion: previousVersion + 1,
    });

    if (decisions.length !== categories.length) {
      throw new Error(
        `Incomplete evaluation: ${decisions.length} vs ${categories.length}`,
      );
    }

    const previousResolutions = await qr.query(
      `SELECT categoryId, status, reasonCode, ruleId, via, businessDomain
       FROM category_assortment_resolution`,
    );
    const lastAudit = await qr.query(
      `SELECT afterJson FROM assortment_policy_audit
       WHERE operation = 'resolution_recompute'
       ORDER BY id DESC LIMIT 1`,
    );
    let lastAfter: any = lastAudit[0]?.afterJson ?? null;
    if (typeof lastAfter === 'string') {
      try {
        lastAfter = JSON.parse(lastAfter);
      } catch {
        lastAfter = null;
      }
    }
    const plan = planAssortmentRecompute({
      previousVersion,
      previousResolutions: previousResolutions.map((r: any) => ({
        categoryId: Number(r.categoryId),
        status: r.status,
        reasonCode: r.reasonCode,
        ruleId: r.ruleId == null ? null : Number(r.ruleId),
        via: r.via,
        businessDomain: r.businessDomain ?? null,
      })),
      decisions,
      rules: ruleInputs,
      lastRuleFingerprint:
        typeof lastAfter?.ruleFingerprint === 'string'
          ? lastAfter.ruleFingerprint
          : null,
      rulesChanged: inserted > 0,
    });
    const nextVersion = plan.policyVersion;

    if (!plan.changed) {
      console.log(
        JSON.stringify(
          {
            insertedRules: inserted,
            skippedRules: skipped,
            activeRules: rules.length,
            previousVersion,
            policyVersion: previousVersion,
            changed: false,
            categoryCount: decisions.length,
            byStatus: summarizeAssortmentDecisions(decisions),
          },
          null,
          2,
        ),
      );
      return;
    }

    await qr.startTransaction();
    try {
      await qr.query(`DELETE FROM category_assortment_resolution`);
      const now = new Date();
      const chunkSize = 200;
      for (let i = 0; i < decisions.length; i += chunkSize) {
        const chunk = decisions.slice(i, i + chunkSize);
        const values: any[] = [];
        const placeholders: string[] = [];
        for (const d of chunk) {
          placeholders.push('(?,?,?,?,?,?,?,?)');
          values.push(
            d.categoryId,
            d.status,
            d.reasonCode,
            d.ruleId,
            d.via,
            d.businessDomain,
            nextVersion,
            now,
          );
        }
        await qr.query(
          `INSERT INTO category_assortment_resolution
            (categoryId, status, reasonCode, ruleId, via, businessDomain, policyVersion, resolvedAt)
           VALUES ${placeholders.join(',')}`,
          values,
        );
      }
      await qr.query(
        `UPDATE assortment_policy_state
         SET policyVersion = ?, updatedAt = ?
         WHERE id = 1`,
        [nextVersion, now],
      );
      await qr.query(
        `INSERT INTO assortment_policy_audit
          (operation, ruleId, actor, beforeJson, afterJson, policyVersion, createdAt)
         VALUES ('resolution_recompute', NULL, ?, ?, ?, ?, ?)`,
        [
          ASSORTMENT_POLICY_SYSTEM_ACTOR,
          JSON.stringify({ policyVersion: previousVersion }),
          JSON.stringify({
            policyVersion: nextVersion,
            byStatus: summarizeAssortmentDecisions(decisions),
            insertedRules: inserted,
            skippedRules: skipped,
            changedCount: plan.changedCategoryIds.length,
            removedCount: plan.removedCategoryIds.length,
            rulesChanged: plan.rulesChanged,
            ruleFingerprint: plan.ruleFingerprint,
          }),
          nextVersion,
          now,
        ],
      );
      await qr.commitTransaction();
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    }

    console.log(
      JSON.stringify(
        {
          insertedRules: inserted,
          skippedRules: skipped,
          activeRules: rules.length,
          previousVersion,
          policyVersion: nextVersion,
          changed: true,
          categoryCount: decisions.length,
          byStatus: summarizeAssortmentDecisions(decisions),
        },
        null,
        2,
      ),
    );
  } finally {
    await qr.release();
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
