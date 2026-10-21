/** Test double for HomeImageAccessService (unit specs). */
export function createHomeImageAccessMock(
  apiBaseUrl = 'http://127.0.0.1:9010',
) {
  const base = apiBaseUrl.replace(/\/$/, '');
  return {
    invalidatePublishedAllowlist: jest.fn(),
    refreshPublishedAllowlist: jest.fn().mockResolvedValue(undefined),
    isPublishedLiveLogicalPath: jest.fn().mockResolvedValue(false),
    signDraftToken: jest.fn().mockReturnValue('test.token'),
    buildPublicStaticUrl: jest.fn((logicalPath: string | null | undefined) => {
      const safe = String(logicalPath || '');
      if (!/^\/home\/[a-zA-Z0-9._-]+$/.test(safe)) return null;
      return `${base}/static${safe}`;
    }),
    buildSignedStaticUrl: jest.fn((logicalPath: string | null | undefined) => {
      const safe = String(logicalPath || '');
      if (!/^\/home\/[a-zA-Z0-9._-]+$/.test(safe)) return null;
      return `${base}/static${safe}?hda=test-token`;
    }),
    authorizeHomeStaticFilename: jest.fn().mockResolvedValue('deny'),
  };
}
