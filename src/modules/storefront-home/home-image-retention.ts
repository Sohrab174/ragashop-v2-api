import { promises as fs } from 'fs';
import * as path from 'path';
import {
  sanitizeHomeMasterConfigPath,
  sanitizeHomeUploadPath,
} from './storefront-home.validate';
import { HOME_MASTERS_DIR, HOME_OUTPUT_DIR } from './home-master-image';

/** Newly written files stay protected even if not yet saved to config. */
export const HOME_IMAGE_RETENTION_GRACE_MS = 48 * 60 * 60 * 1000;

export type HomeImageReferenceSource =
  | 'section_config'
  | 'instance_config'
  | 'preview_session'
  | 'grace_period'
  | 'in_progress_marker';

export type HomeImageReference = {
  logicalPath: string;
  sources: HomeImageReferenceSource[];
  detail?: string;
};

export type HomeImageRetentionCandidate = {
  logicalPath: string;
  absPath: string;
  sizeBytes: number;
  mtimeMs: number;
  referenced: boolean;
  withinGrace: boolean;
  /** Would be deletable only if deletion were enabled AND referenced=false AND withinGrace=false. */
  wouldDeleteIfEnabled: boolean;
  retentionReasons: string[];
};

export type HomeImageRetentionDryRunReport = {
  generatedAt: string;
  dryRun: true;
  deletionEnabled: false;
  graceMs: number;
  scannedDirs: string[];
  referenceCount: number;
  diskFileCount: number;
  referenced: HomeImageRetentionCandidate[];
  graceProtected: HomeImageRetentionCandidate[];
  /** Unreferenced and outside grace — report only; never deleted in this pass. */
  deletionCandidates: HomeImageRetentionCandidate[];
  notes: string[];
};

/**
 * Walk arbitrary Admin/public config JSON and collect sanitized /home and /home-masters paths,
 * including nested previousImage snapshots.
 */
export function collectHomeImagePathsFromValue(
  value: unknown,
  out: Set<string> = new Set(),
): Set<string> {
  if (value == null) return out;
  if (typeof value === 'string') {
    const home = sanitizeHomeUploadPath(value);
    if (home) out.add(home);
    const master = sanitizeHomeMasterConfigPath(value);
    if (master) out.add(master);
    // Preview/public DTOs expose /static/home/... URLs — map back to logical paths.
    const staticMatch = value.match(
      /\/static\/(home(?:-masters)?)\/([a-zA-Z0-9._-]+)/i,
    );
    if (staticMatch) {
      const logical = `/${staticMatch[1]}/${staticMatch[2]}`;
      const asHome = sanitizeHomeUploadPath(logical);
      if (asHome) out.add(asHome);
      const asMaster = sanitizeHomeMasterConfigPath(logical);
      if (asMaster) out.add(asMaster);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHomeImagePathsFromValue(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectHomeImagePathsFromValue(child, out);
    }
  }
  return out;
}

export function buildHomeImageReferenceMap(options: {
  sectionConfigs?: Array<{ key?: string; config: unknown }>;
  instanceConfigs?: Array<{ key?: string; config: unknown }>;
  previewSessionPayloads?: Array<{ tokenHint?: string; payload: unknown }>;
}): Map<string, HomeImageReference> {
  const map = new Map<string, HomeImageReference>();

  const add = (
    paths: Set<string>,
    source: HomeImageReferenceSource,
    detail?: string,
  ) => {
    for (const logicalPath of paths) {
      const existing = map.get(logicalPath);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        if (detail && !existing.detail) existing.detail = detail;
      } else {
        map.set(logicalPath, {
          logicalPath,
          sources: [source],
          detail,
        });
      }
    }
  };

  for (const row of options.sectionConfigs || []) {
    add(
      collectHomeImagePathsFromValue(row.config),
      'section_config',
      row.key ? `section:${row.key}` : undefined,
    );
  }
  for (const row of options.instanceConfigs || []) {
    add(
      collectHomeImagePathsFromValue(row.config),
      'instance_config',
      row.key ? `instance:${row.key}` : undefined,
    );
  }
  for (const row of options.previewSessionPayloads || []) {
    add(
      collectHomeImagePathsFromValue(row.payload),
      'preview_session',
      row.tokenHint ? `preview:${row.tokenHint}` : undefined,
    );
  }

  return map;
}

export type DiskHomeImageFile = {
  logicalPath: string;
  absPath: string;
  sizeBytes: number;
  mtimeMs: number;
};

export async function listHomeImageDiskFiles(
  uploadsRoot = path.resolve('./uploads'),
): Promise<DiskHomeImageFile[]> {
  const dirs = [
    { dir: HOME_OUTPUT_DIR, prefix: `/${HOME_OUTPUT_DIR}/` },
    { dir: HOME_MASTERS_DIR, prefix: `/${HOME_MASTERS_DIR}/` },
  ];
  const files: DiskHomeImageFile[] = [];
  for (const { dir, prefix } of dirs) {
    const absDir = path.join(uploadsRoot, dir);
    let names: string[] = [];
    try {
      names = await fs.readdir(absDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes('..')) continue;
      const absPath = path.join(absDir, name);
      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      files.push({
        logicalPath: `${prefix}${name}`,
        absPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  return files;
}

/**
 * Dry-run retention report. Never deletes.
 * A file is a deletion candidate only when unreferenced and outside the grace window.
 */
export function evaluateHomeImageRetention(options: {
  diskFiles: DiskHomeImageFile[];
  references: Map<string, HomeImageReference>;
  nowMs?: number;
  graceMs?: number;
}): HomeImageRetentionDryRunReport {
  const nowMs = options.nowMs ?? Date.now();
  const graceMs = options.graceMs ?? HOME_IMAGE_RETENTION_GRACE_MS;
  const referenced: HomeImageRetentionCandidate[] = [];
  const graceProtected: HomeImageRetentionCandidate[] = [];
  const deletionCandidates: HomeImageRetentionCandidate[] = [];

  for (const file of options.diskFiles) {
    const ref = options.references.get(file.logicalPath);
    const isReferenced = Boolean(ref);
    const ageMs = Math.max(0, nowMs - file.mtimeMs);
    const withinGrace = ageMs < graceMs;
    const retentionReasons: string[] = [];
    if (isReferenced) {
      retentionReasons.push(
        `referenced_by:${(ref?.sources || []).join('+')}`,
      );
      if (ref?.detail) retentionReasons.push(ref.detail);
    }
    if (withinGrace) retentionReasons.push('within_grace_period');

    const candidate: HomeImageRetentionCandidate = {
      logicalPath: file.logicalPath,
      absPath: file.absPath,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
      referenced: isReferenced,
      withinGrace,
      wouldDeleteIfEnabled: !isReferenced && !withinGrace,
      retentionReasons,
    };

    if (isReferenced) referenced.push(candidate);
    else if (withinGrace) graceProtected.push(candidate);
    else deletionCandidates.push(candidate);
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    dryRun: true,
    deletionEnabled: false,
    graceMs,
    scannedDirs: [`/${HOME_OUTPUT_DIR}/`, `/${HOME_MASTERS_DIR}/`],
    referenceCount: options.references.size,
    diskFileCount: options.diskFiles.length,
    referenced,
    graceProtected,
    deletionCandidates,
    notes: [
      'Deletion is disabled for this pass. Report only.',
      'Referenced files include published section configJson, layout instance configJson, nested previousImage snapshots, and active in-memory preview sessions when provided.',
      'Unsaved Admin uploads are protected by the grace period until saved or aged out.',
      'Do not enable deletion until inventory coverage is verified in production-like data.',
      'See HOME-IMAGE-RETENTION-POLICY.md in the workspace root for the approved reference-aware cleanup policy (deletion remains off until independent approval).',
    ],
  };
}

export async function buildHomeImageRetentionDryRunReport(options: {
  sectionConfigs?: Array<{ key?: string; config: unknown }>;
  instanceConfigs?: Array<{ key?: string; config: unknown }>;
  previewSessionPayloads?: Array<{ tokenHint?: string; payload: unknown }>;
  uploadsRoot?: string;
  nowMs?: number;
  graceMs?: number;
}): Promise<HomeImageRetentionDryRunReport> {
  const references = buildHomeImageReferenceMap({
    sectionConfigs: options.sectionConfigs,
    instanceConfigs: options.instanceConfigs,
    previewSessionPayloads: options.previewSessionPayloads,
  });
  const diskFiles = await listHomeImageDiskFiles(options.uploadsRoot);
  return evaluateHomeImageRetention({
    diskFiles,
    references,
    nowMs: options.nowMs,
    graceMs: options.graceMs,
  });
}
