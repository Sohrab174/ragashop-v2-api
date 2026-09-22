import {
  detectReceiptMimeFromBuffer,
  isStructurallyValidPdf,
  isStructurallyValidPng,
  isStructurallyValidWebp,
} from './receipt-content-validation';

describe('Codex Fix Pass #4 probes', () => {
  function crc32(buf: Buffer): number {
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    let c = 0xffffffff;
    for (const b of buf) {
      c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  }

  function wrapWebp(fourcc: string, data: Buffer): Buffer {
    const chunkHdr = Buffer.alloc(8);
    chunkHdr.write(fourcc, 0);
    chunkHdr.writeUInt32LE(data.length, 4);
    const pad = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
    const body = Buffer.concat([Buffer.from('WEBP'), chunkHdr, data, pad]);
    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0);
    riff.writeUInt32LE(body.length, 4);
    return Buffer.concat([riff, body]);
  }

  function buildPdf(opts?: { rootBody?: string; rootRef?: string }): Buffer {
    const rootBody =
      opts?.rootBody ?? '<< /Type /Catalog /Pages 2 0 R >>';
    const lines = [
      '%PDF-1.4',
      '1 0 obj',
      rootBody,
      'endobj',
      '2 0 obj',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      'endobj',
      '3 0 obj',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3 3] >>',
      'endobj',
    ];
    let body = `${lines.join('\n')}\n`;
    const xrefPos = Buffer.byteLength(body, 'utf8');
    const rootRef = opts?.rootRef ?? '1 0 R';
    body +=
      'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root ' +
      rootRef +
      ' >>\nstartxref\n' +
      String(xrefPos) +
      '\n%%EOF\n';
    return Buffer.from(body, 'utf8');
  }

  it('rejects six-case adversarial probe', async () => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const pngNoIdat = Buffer.concat([
      sig,
      chunk('IHDR', ihdr),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const tinyWebp = wrapWebp('VP8 ', Buffer.from([0x00]));
    const vp8lHeaderOnly = wrapWebp(
      'VP8L',
      Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]),
    );
    const thinPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
    );
    const pdfRootNotCatalog = buildPdf({
      rootBody: '<< /Pages 2 0 R >>',
    });
    const pdfMissingPagesObject = buildPdf({
      rootBody: '<< /Type /Catalog /Pages 99 0 R >>',
    });

    expect(await detectReceiptMimeFromBuffer(pngNoIdat)).toBeNull();
    expect(await isStructurallyValidPng(pngNoIdat)).toBe(false);
    expect(await detectReceiptMimeFromBuffer(tinyWebp)).toBeNull();
    expect(await isStructurallyValidWebp(tinyWebp)).toBe(false);
    expect(await detectReceiptMimeFromBuffer(vp8lHeaderOnly)).toBeNull();
    expect(await isStructurallyValidWebp(vp8lHeaderOnly)).toBe(false);
    expect(await detectReceiptMimeFromBuffer(thinPdf)).toBeNull();
    expect(isStructurallyValidPdf(thinPdf)).toBe(false);
    expect(await detectReceiptMimeFromBuffer(pdfRootNotCatalog)).toBeNull();
    expect(isStructurallyValidPdf(pdfRootNotCatalog)).toBe(false);
    expect(await detectReceiptMimeFromBuffer(pdfMissingPagesObject)).toBeNull();
    expect(isStructurallyValidPdf(pdfMissingPagesObject)).toBe(false);
  });
});
