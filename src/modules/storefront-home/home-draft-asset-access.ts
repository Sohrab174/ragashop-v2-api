import { createHmac, timingSafeEqual } from 'crypto';

export const HOME_DRAFT_ASSET_PURPOSE = 'home_draft_asset';
/** Query param on `/static/home/:file` for unpublished draft access. */
export const HOME_DRAFT_ASSET_QUERY = 'hda';
/** Default TTL for Admin / preview draft asset tokens (2 hours). */
export const HOME_DRAFT_ASSET_TTL_SEC = 2 * 60 * 60;

export type HomeDraftAssetClaims = {
  purpose: typeof HOME_DRAFT_ASSET_PURPOSE;
  /** Logical path e.g. `/home/uuid.webp` */
  path: string;
  exp: number;
};

function normalizeLogicalHomePath(raw: string): string | null {
  const trimmed = String(raw || '')
    .trim()
    .replace(/\\/g, '/');
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!/^\/home\/[a-zA-Z0-9._-]+$/.test(normalized)) return null;
  if (normalized.includes('..')) return null;
  return normalized;
}

export function signHomeDraftAssetToken(
  logicalPath: string,
  secret: string,
  ttlSec = HOME_DRAFT_ASSET_TTL_SEC,
  nowMs = Date.now(),
): string {
  const path = normalizeLogicalHomePath(logicalPath);
  if (!path) {
    throw new Error('INVALID_HOME_DRAFT_PATH');
  }
  const key = String(secret || '').trim();
  if (!key) {
    throw new Error('HOME_DRAFT_ASSET_SECRET_MISSING');
  }
  const claims: HomeDraftAssetClaims = {
    purpose: HOME_DRAFT_ASSET_PURPOSE,
    path,
    exp: Math.floor(nowMs / 1000) + Math.max(60, Math.floor(ttlSec)),
  };
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyHomeDraftAssetToken(
  token: string,
  secret: string,
  expectedLogicalPath: string,
  nowMs = Date.now(),
): HomeDraftAssetClaims | null {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const key = String(secret || '').trim();
  if (!key) return null;

  const expected = createHmac('sha256', key).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  let parsed: HomeDraftAssetClaims;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed?.purpose !== HOME_DRAFT_ASSET_PURPOSE) return null;
  const path = normalizeLogicalHomePath(String(parsed.path || ''));
  const expectedPath = normalizeLogicalHomePath(expectedLogicalPath);
  if (!path || !expectedPath || path !== expectedPath) return null;
  const exp = Number(parsed.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= nowMs) return null;
  return { purpose: HOME_DRAFT_ASSET_PURPOSE, path, exp };
}

export function appendHomeDraftAssetQuery(
  absoluteUrl: string,
  token: string,
): string {
  const base = String(absoluteUrl || '').trim();
  if (!base) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${HOME_DRAFT_ASSET_QUERY}=${encodeURIComponent(token)}`;
}
