import { createHmac, timingSafeEqual } from 'crypto';

export const HOME_PREVIEW_SCOPE = 'preview_read';
export const HOME_PREVIEW_PURPOSE = 'storefront_home_preview';

export type HomePreviewCredentialClaims = {
  purpose: typeof HOME_PREVIEW_PURPOSE;
  scope: typeof HOME_PREVIEW_SCOPE;
  sid: string;
  sub: number;
  exp: number;
  nonce: string;
};

export function signHomePreviewCredential(
  claims: Omit<HomePreviewCredentialClaims, 'purpose' | 'scope'>,
  secret: string,
): string {
  const payload: HomePreviewCredentialClaims = {
    purpose: HOME_PREVIEW_PURPOSE,
    scope: HOME_PREVIEW_SCOPE,
    sid: claims.sid,
    sub: claims.sub,
    exp: claims.exp,
    nonce: claims.nonce,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyHomePreviewCredential(
  credential: string,
  secret: string,
  nowMs = Date.now(),
): HomePreviewCredentialClaims | null {
  const raw = String(credential || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  let parsed: HomePreviewCredentialClaims;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed?.purpose !== HOME_PREVIEW_PURPOSE) return null;
  if (parsed?.scope !== HOME_PREVIEW_SCOPE) return null;
  if (!/^[a-f0-9]{64}$/i.test(String(parsed.sid || ''))) return null;
  const sub = Number(parsed.sub);
  if (!Number.isFinite(sub) || sub <= 0) return null;
  const exp = Number(parsed.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= nowMs) return null;
  if (!/^[a-f0-9]{32}$/i.test(String(parsed.nonce || ''))) return null;
  return {
    purpose: HOME_PREVIEW_PURPOSE,
    scope: HOME_PREVIEW_SCOPE,
    sid: String(parsed.sid),
    sub,
    exp,
    nonce: String(parsed.nonce),
  };
}
