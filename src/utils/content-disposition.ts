/**
 * Build a safe Content-Disposition header value.
 * ASCII fallback filename= + RFC 5987 filename*=UTF-8''…
 * Strips CR/LF/quotes/control chars to prevent header injection.
 */
export function buildSafeContentDisposition(
  originalFilename: string,
  disposition: 'inline' | 'attachment' = 'inline',
): string {
  const raw = String(originalFilename || 'receipt').trim() || 'receipt';
  const stripped = raw
    .replace(/[\r\n\0]/g, '')
    .replace(/["\\]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, 200);

  const asciiFallback =
    stripped
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/[<>:|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'receipt';

  const encoded = encodeURIComponent(stripped || asciiFallback).replace(
    /['()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
