# Catalog handoff — underwear + Pet curation (fail-closed runner)

**Only executable path:** `run-handoff.ts` (legacy `*.sql` files `SIGNAL`).

## Modes

| Mode | Durable catalog writes? | Notes |
|------|-------------------------|-------|
| `preflight` | No | Schema/InnoDB/enforcement/identity |
| `validate-local` | No | Always `ROLLBACK` |
| `apply` | Yes | Requires `--execution-id` + backup file + attestation + restore evidence |
| `rollback` | Yes | Requires `--execution-id` + full post-apply identity gate |
| `reconcile-rollback` | No catalog writes* | Seals lifecycle only after full pre-apply identity match |
| `shoe-preflight` | No | Per-sourceId shoe readiness |

\*reconcile may only seal filesystem lifecycle when DB already matches **full** pre-apply identity (including `m.source` / `c.source` / product source identities). It never writes catalog rows. A valid `*.rollback-intent.json` is **required** for every reconcile success path (including idempotent `already_complete`); missing/mismatched intent → fail closed (never inferred or repaired).

## FIX highlights (Final Three P1)

### P1-A — Complete drift identity
- Shared `assertExactCatalogIdentityState` used by apply postconditions, rollback, and reconcile.
- Compares mapping `source`, category `source`/`sourceId`, mapping keys, status, note, and every product’s `source`/`sourceId`/`categoryId`/`categorySourceId`/curated flag.
- Missing, duplicate, changed, or ambiguous identity → fail closed **before** any `UPDATE`.
- Reconcile never classifies `matches_pre_apply` from mutable curated/status flags alone.

### P1-B — Crash recovery
1. Write `*.rollback-intent.json` phase=`pre_commit`
2. `BEGIN` → full post-apply identity gate → restore → `COMMIT`
3. Intent → `committed`
4. Seal lifecycle `rolled_back` (+ snapshot hash rewrite)
5. Intent → `complete`
6. Success only if lifecycle durable `rolled_back`

If crash between 2–5: `--mode=reconcile-rollback --execution-id=… --snapshot=…`
- **a** intent `pre_commit` + DB full post-apply → rollback not committed (retry with approval)
- **b** DB full pre-apply + intent committed/incomplete → seal lifecycle only (no catalog writes)
- **c** neither / ambiguous → manual recovery; never blind re-run

#### Crash between snapshot / SHA256 / lifecycle / intent writes
`assertSnapshotArtifactsConsistent` detects missing or inconsistent sidecars and **fails closed**. It never fabricates lifecycle success.

**Manual recovery (operator):**
1. Do **not** re-run `apply` or blind `rollback`.
2. Inventory files next to the snapshot basename: `.snapshot.json`, `.sha256`, `.lifecycle.json`, `.rollback-intent.json`.
3. If JSON exists without matching SHA256 (or hash mismatch): treat snapshot as untrusted; restore target DB from the **attested backup** on the authorized server if catalog state is unknown; do not invent a lifecycle seal.
4. If JSON+SHA256+lifecycle exist but **intent is missing**: fail closed. Do **not** treat lifecycle=`rolled_back` + PRE_APPLY DB as success. Do **not** run reconcile to invent intent. Operator must recover from the attested backup or restore a known-good intent artifact from audit backups — never fabricate intent.
5. Orphan lifecycle/intent without snapshot JSON: quarantine files; recover from backup; never mark rolled_back from orphans alone.

#### Accepted limitation — seal vs intent-hash crash window
A crash may occur **after** rollback DB `COMMIT` and `sealLifecycleRolledBack`, but **before** the intent file is rewritten with the sealed snapshot hash / `phase=complete`.

**In that state:**
- Catalog rows have already been restored to pre-apply (no further catalog write is required from the runner).
- Snapshot semantic pre-apply payload (`mappingPre`, product pre lists, `postApply` expectation) remains intact inside the sealed JSON; only lifecycle metadata / file bytes changed on seal.
- Intent `snapshotSha256` may disagree with the sealed snapshot file (intent often still `phase=committed` with the pre-seal hash).
- `reconcile-rollback` **must fail closed** on that hash/identity disagreement.
- **No automatic artifact repair** is permitted (runner must not infer, rewrite, or silently heal intent).

This is an accepted **recoverability / availability** limitation for filesystem lifecycle closure. It is **not** proof of Production execution readiness and does **not** by itself authorize deployment.

**Server-team acknowledgment (mandatory before deployment):** the deploying server team must explicitly acknowledge this accepted limitation and the operator-only procedure below before any Production handoff run.

**Operator-only recovery procedure (authorized server operator):**
1. Stop all further handoff operations (`apply` / `rollback` / `reconcile-rollback`) on this execution.
2. Preserve unchanged copies of snapshot JSON, `.sha256`, `.rollback-intent.json`, `.lifecycle.json`, and related logs.
3. Verify the exact target database name and `--execution-id` against the snapshot / intent / lifecycle bindings.
4. Independently verify complete PRE_APPLY database identity (same bar as the runner’s full pre-apply gate: mapping + category source identity + every product identity — not curated/status flags alone).
5. Confirm the discrepancy is limited to this documented seal/hash crash window (sealed lifecycle + intact semantic snapshot + intent hash/phase lag only; no other corruption or identity drift).
6. Require explicit authorized-operator approval before any artifact repair.
7. If approved: repair only the minimal intent binding needed for audit closure, preserve originals of all pre-repair artifacts, and record repair evidence (who/when/why/before-after hashes). Never invent missing snapshot/lifecycle content.
8. Never blindly re-run `apply` or `rollback`.
9. If PRE_APPLY (or artifact integrity) cannot be independently verified, escalate to attested-backup recovery on the authorized server — do not guess.

### P1-C — Backup restore evidence
File hash alone is **not** recoverability proof. Apply requires:

1. `--execution-id=<id>` prepared **before** apply (same id in attestation + evidence).
2. `--backup-path=` existing dump file.
3. `--backup-attestation=` JSON (`backup-attestation.example.json`) binding:
   - `executionId`, `approvedDatabaseName`, `serverFingerprint`
   - `backupPath` + `backupSha256` (exact file hash)
   - `restoreEvidencePath` + `restoreEvidenceSha256` (hash of evidence file)
4. Restore evidence JSON (`restore-evidence.example.json`) produced by the **authorized server operator after a real scratch restore**, including scratch DB name (≠ target), `tableRowCounts`, and `evidencePayloadSha256` over the canonical payload.

A self-declared `iAttestRestoreVerified=YES` field is **rejected**.

#### Server-side restore verification gate (mandatory)
Local structural/crypto validation of attestation + evidence files does **not** prove a Production backup is recoverable. Before Production apply, the authorized server operator must:

1. Restore the exact hashed dump to an isolated scratch database on the **same server fingerprint** family as the target.
2. Record real `tableRowCounts` from that scratch restore into `RestoreEvidence`.
3. Compute `evidencePayloadSha256` and the evidence file SHA256; bind both into the attestation.
4. Keep scratch artifacts for audit.

**Never claim that Local tests prove a Production backup is recoverable.**

## Commands (Local validation)

```bash
npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-handoff-underwear-pet/run-handoff.ts --mode=preflight --approved-database-name=ragashop_local
npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-handoff-underwear-pet/run-handoff.ts --mode=validate-local --approved-database-name=ragashop_local
npx ts-node -r tsconfig-paths/register src/database/scripts/catalog-handoff-underwear-pet/run-handoff.ts --mode=shoe-preflight --approved-database-name=ragashop_local
```

Do **not** run apply/rollback against live Local for review. Keep `ASSORTMENT_DISCOVERY_ENFORCEMENT` unset.
