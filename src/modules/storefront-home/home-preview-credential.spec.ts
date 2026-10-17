import {
  signHomePreviewCredential,
  verifyHomePreviewCredential,
} from './home-preview-credential';

describe('home-preview-credential', () => {
  const secret = 'preview-secret';
  const sid = 'a'.repeat(64);
  const nonce = 'b'.repeat(32);

  it('signs a preview-only credential and rejects Admin-shaped JWTs', () => {
    const credential = signHomePreviewCredential(
      { sid, sub: 5, exp: Math.floor(Date.now() / 1000) + 60, nonce },
      secret,
    );
    expect(credential.split('.')).toHaveLength(2);
    const claims = verifyHomePreviewCredential(credential, secret);
    expect(claims?.scope).toBe('preview_read');
    expect(claims?.sid).toBe(sid);
    expect(claims?.sub).toBe(5);
    expect(
      verifyHomePreviewCredential('aaa.bbb.ccc', secret),
    ).toBeNull();
  });

  it('rejects forged, expired, and wrong-secret credentials', () => {
    const credential = signHomePreviewCredential(
      { sid, sub: 5, exp: Math.floor(Date.now() / 1000) + 60, nonce },
      secret,
    );
    expect(verifyHomePreviewCredential(credential + 'x', secret)).toBeNull();
    expect(verifyHomePreviewCredential(credential, 'other')).toBeNull();
    const expired = signHomePreviewCredential(
      { sid, sub: 5, exp: Math.floor(Date.now() / 1000) - 5, nonce },
      secret,
    );
    expect(verifyHomePreviewCredential(expired, secret)).toBeNull();
  });
});
