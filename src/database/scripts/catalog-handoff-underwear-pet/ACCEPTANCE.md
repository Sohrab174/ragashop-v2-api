# Focused Codex re-review checklist (Final Three P1)

| P1 | Closed by |
|----|-----------|
| P1-A Complete drift identity | Shared `assertExactCatalogIdentityState` (incl. `m.source` / `c.source`) for apply/rollback/reconcile; pre-apply classification never uses curated/status alone |
| P1-B Crash recovery | Reconcile seals only after full pre-apply identity; no catalog writes; intent required + integrity/identity/execution-bound before any success (incl. already_complete); missing intent never succeeds |
| P1-C Backup restore evidence | Attestation binds executionId+DB+fingerprint+backup hash to hashed `RestoreEvidence`; YES-only rejected; Local ≠ Production recoverability; server-side gate documented |

## Accepted recoverability limitation (not a catalog data-safety P1)

Documented in `README.md` § **Accepted limitation — seal vs intent-hash crash window**:

- Crash after rollback DB `COMMIT` + `sealLifecycleRolledBack`, before intent hash / `phase=complete` update.
- Catalog already restored; semantic pre-apply snapshot payload intact; intent hash may disagree; `reconcile-rollback` fails closed; no automatic artifact repair.
- Operator-only recovery procedure is mandatory; blind re-run of apply/rollback forbidden; escalate to attested backup if PRE_APPLY cannot be independently verified.

**Classification:** accepted recoverability/availability limitation — **not** proof of Production execution readiness.

**Deployment gate:** server-team acknowledgment of this limitation is **required** before Production deployment / handoff execution.

## Local checks (no durable apply/rollback)

```bash
npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-handoff-underwear-pet/run-handoff.ts --mode=preflight --approved-database-name=ragashop_local
npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-handoff-underwear-pet/run-handoff.ts --mode=validate-local --approved-database-name=ragashop_local
npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-handoff-underwear-pet/run-handoff.ts --mode=apply --approved-database-name=ragashop_local --i-approve-write=YES
# → fail: missing --execution-id
npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-handoff-underwear-pet/run-handoff.ts --mode=apply --approved-database-name=ragashop_local --i-approve-write=YES --execution-id=test
# → fail: missing backup / attestation
npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-handoff-underwear-pet/run-handoff.ts --mode=rollback --approved-database-name=ragashop_local --snapshot=x --i-approve-write=YES
# → fail: missing --execution-id
```

Confirm Local mapping/curation unchanged after validation.
