/**
 * SCOPE-2/3 — recompute category_assortment_resolution from active rules.
 *
 * Usage:
 *   npm run catalog:assortment-policy:recompute
 *
 * Uses createConnection (not Nest bootstrap) so the CLI stays lightweight.
 * Idempotent: unchanged rules+resolutions do not advance policyVersion.
 */
import { createConnection } from 'typeorm';
import {
  evaluateAssortmentPolicy,
  summarizeAssortmentDecisions,
} from '../assortment-policy/assortment-policy.evaluate';
import { planAssortmentRecompute } from '../assortment-policy/assortment-policy.recompute-plan';

async function main() {
  const conn = await createConnection();
  const qr = conn.createQueryRunner();
  await qr.connect();
  try {
    const stateRows = await qr.query(
      `SELECT policyVersion FROM assortment_policy_state WHERE id = 1 FOR UPDATE`,
    );
    if (!stateRows.length) {
      throw new Error('assortment_policy_state missing');
    }
    const previousVersion = Number(stateRows[0].policyVersion);

    const rules = await qr.query(
      `SELECT id, provider, matchType, pathPrefixNorm, categoryId, status,
              reasonCode, businessDomain, isActive
       FROM assortment_policy_rule WHERE isActive = 1 ORDER BY id ASC`,
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
    });

    if (!plan.changed) {
      console.log(
        JSON.stringify(
          {
            changed: false,
            previousVersion,
            policyVersion: previousVersion,
            categoryCount: decisions.length,
            ruleCount: rules.length,
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
            plan.policyVersion,
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
        `UPDATE assortment_policy_state SET policyVersion = ?, updatedAt = ? WHERE id = 1`,
        [plan.policyVersion, now],
      );
      await qr.query(
        `INSERT INTO assortment_policy_audit
          (operation, ruleId, actor, beforeJson, afterJson, policyVersion, createdAt)
         VALUES ('resolution_recompute', NULL, ?, ?, ?, ?, ?)`,
        [
          'system:recompute-cli',
          JSON.stringify({
            policyVersion: previousVersion,
            resolutionCount: previousResolutions.length,
          }),
          JSON.stringify({
            policyVersion: plan.policyVersion,
            resolutionCount: decisions.length,
            byStatus: summarizeAssortmentDecisions(decisions),
            changedCount: plan.changedCategoryIds.length,
            removedCount: plan.removedCategoryIds.length,
            rulesChanged: plan.rulesChanged,
            ruleFingerprint: plan.ruleFingerprint,
          }),
          plan.policyVersion,
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
          changed: true,
          previousVersion,
          policyVersion: plan.policyVersion,
          categoryCount: decisions.length,
          ruleCount: rules.length,
          changedCategoryIds: plan.changedCategoryIds.length,
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
