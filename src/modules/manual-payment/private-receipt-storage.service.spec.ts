import * as zlib from 'zlib';
import * as sharp from 'sharp';
import {
  detectReceiptMimeFromBuffer,
  isJpegContainerValid,
  isPngContainerValid,
  isStructurallyValidJpeg,
  isStructurallyValidPdf,
  isStructurallyValidPng,
  isStructurallyValidWebp,
  isWebpContainerValid,
  validateVp8LPayload,
  validateVp8Payload,
} from './utils/receipt-content-validation';
import { PrivateReceiptStorageService } from './private-receipt-storage.service';

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

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function buildPng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0x00, 0xff, 0x00, 0x00]);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function buildJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 4, g: 5, b: 6 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Known tiny lossy VP8 WebP */
function buildVp8Webp(): Buffer {
  return Buffer.from(
    'UklGRi4AAABXRUJQVlA4ICIAAABwAQCdASoCAAIAAUAmJZQCdAFAAAD+/DeBV/fU6D4r4AAA',
    'base64',
  );
}

function buildVp8LWebp(): Buffer {
  return Buffer.from(
    'UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQmaKUp/+BiOh/AAA=',
    'base64',
  );
}

function buildVp8XWebp(): Buffer {
  return Buffer.from(
    'UklGRk4AAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgICAgABWUDggIgAAAHABAJ0BKgIAAgABQCYllAJ0AUAAAP7yqULUSVLyfojAAAA=',
    'base64',
  );
}

function wrapWebpChunk(fourcc: string, data: Buffer): Buffer {
  const chunkHdr = Buffer.alloc(8);
  chunkHdr.write(fourcc, 0);
  chunkHdr.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
  const body = Buffer.concat([Buffer.from('WEBP'), chunkHdr, data, pad]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0);
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function wrapWebpChunks(
  chunks: Array<{ fourcc: string; data: Buffer }>,
): Buffer {
  const parts: Buffer[] = [Buffer.from('WEBP')];
  for (const c of chunks) {
    const chunkHdr = Buffer.alloc(8);
    chunkHdr.write(c.fourcc, 0);
    chunkHdr.writeUInt32LE(c.data.length, 4);
    const pad = c.data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
    parts.push(chunkHdr, c.data, pad);
  }
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0);
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function buildPdf(opts?: {
  rootBody?: string;
  pagesBody?: string;
  extraObjects?: string[];
  rootGen?: number;
  pagesGen?: number;
  rootRef?: string;
}): Buffer {
  const rootGen = opts?.rootGen ?? 0;
  const pagesGen = opts?.pagesGen ?? 0;
  const rootBody =
    opts?.rootBody ?? `<< /Type /Catalog /Pages 2 ${pagesGen} R >>`;
  const pagesBody =
    opts?.pagesBody ?? '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const lines = [
    '%PDF-1.4',
    `1 ${rootGen} obj`,
    rootBody,
    'endobj',
    `2 ${pagesGen} obj`,
    pagesBody,
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3 3] >>',
    'endobj',
    ...(opts?.extraObjects ?? []),
  ];
  let body = `${lines.join('\n')}\n`;
  const xrefPos = Buffer.byteLength(body, 'utf8');
  const rootRef = opts?.rootRef ?? `1 ${rootGen} R`;
  body +=
    'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root ' +
    rootRef +
    ' >>\nstartxref\n' +
    String(xrefPos) +
    '\n%%EOF\n';
  return Buffer.from(body, 'utf8');
}

describe('receipt structural validation', () => {
  let validPng: Buffer;
  let validJpeg: Buffer;
  let validWebp: Buffer;
  let validVp8L: Buffer;
  let validVp8X: Buffer;
  let validPdf: Buffer;

  beforeAll(async () => {
    validPng = buildPng();
    validJpeg = await buildJpeg();
    validWebp = buildVp8Webp();
    validVp8L = buildVp8LWebp();
    validVp8X = buildVp8XWebp();
    validPdf = buildPdf();
  });

  describe('PNG', () => {
    it('accepts valid minimal PNG', async () => {
      expect(await isStructurallyValidPng(validPng)).toBe(true);
      expect(await detectReceiptMimeFromBuffer(validPng)).toBe('image/png');
    });

    it('rejects 4-byte PNG prefix', async () => {
      expect(
        await detectReceiptMimeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      ).toBeNull();
    });

    it('rejects full signature only', async () => {
      expect(
        await detectReceiptMimeFromBuffer(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
      ).toBeNull();
    });

    it('rejects truncated chunk', async () => {
      expect(await detectReceiptMimeFromBuffer(validPng.subarray(0, 20))).toBeNull();
      expect(isPngContainerValid(validPng.subarray(0, 20))).toBe(false);
    });

    it('rejects missing IEND', async () => {
      const noIend = validPng.subarray(0, validPng.length - 12);
      expect(isPngContainerValid(noIend)).toBe(false);
      expect(await detectReceiptMimeFromBuffer(noIend)).toBeNull();
    });

    it('rejects IHDR+IEND without IDAT', async () => {
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(1, 0);
      ihdr.writeUInt32BE(1, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const noIdat = Buffer.concat([
        sig,
        pngChunk('IHDR', ihdr),
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
      expect(isPngContainerValid(noIdat)).toBe(false);
      expect(await detectReceiptMimeFromBuffer(noIdat)).toBeNull();
    });

    it('rejects empty IDAT', async () => {
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(1, 0);
      ihdr.writeUInt32BE(1, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const emptyIdat = Buffer.concat([
        sig,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', Buffer.alloc(0)),
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
      expect(isPngContainerValid(emptyIdat)).toBe(false);
      expect(await isStructurallyValidPng(emptyIdat)).toBe(false);
    });

    it('rejects zero dimensions', async () => {
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(0, 0);
      ihdr.writeUInt32BE(1, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const zero = Buffer.concat([
        sig,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', Buffer.from([1])),
        pngChunk('IEND', Buffer.alloc(0)),
      ]);
      expect(isPngContainerValid(zero)).toBe(false);
      expect(await isStructurallyValidPng(zero)).toBe(false);
    });
  });

  describe('JPEG', () => {
    it('accepts valid JPEG fixture', async () => {
      expect(await isStructurallyValidJpeg(validJpeg)).toBe(true);
      expect(await detectReceiptMimeFromBuffer(validJpeg)).toBe('image/jpeg');
    });

    it('rejects SOI only', async () => {
      expect(await detectReceiptMimeFromBuffer(Buffer.from([0xff, 0xd8]))).toBeNull();
      expect(
        await detectReceiptMimeFromBuffer(Buffer.from([0xff, 0xd8, 0xff])),
      ).toBeNull();
    });

    it('rejects truncated segment', async () => {
      const truncated = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
        Buffer.alloc(4),
      ]);
      expect(isJpegContainerValid(truncated)).toBe(false);
      expect(await detectReceiptMimeFromBuffer(truncated)).toBeNull();
    });

    it('rejects missing EOI', async () => {
      const noEoi = validJpeg.subarray(0, validJpeg.length - 2);
      expect(await detectReceiptMimeFromBuffer(noEoi)).toBeNull();
    });

    it('rejects SOI/SOS/EOI shell without SOF', async () => {
      const shell = Buffer.from([
        0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
        0x7f, 0xff, 0xd9,
      ]);
      expect(isJpegContainerValid(shell)).toBe(false);
      expect(await isStructurallyValidJpeg(shell)).toBe(false);
    });

    it('rejects SOF with zero dimensions', async () => {
      const sof = Buffer.from([
        0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x01,
        0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
        0x00, 0x7f, 0xff, 0xd9,
      ]);
      expect(isJpegContainerValid(sof)).toBe(false);
      expect(await isStructurallyValidJpeg(sof)).toBe(false);
    });
  });

  describe('WebP', () => {
    it('accepts valid ordinary VP8', async () => {
      expect(await isStructurallyValidWebp(validWebp)).toBe(true);
      expect(await detectReceiptMimeFromBuffer(validWebp)).toBe('image/webp');
    });

    it('accepts valid ordinary VP8L', async () => {
      expect(await isStructurallyValidWebp(validVp8L)).toBe(true);
      expect(await detectReceiptMimeFromBuffer(validVp8L)).toBe('image/webp');
    });

    it('accepts valid ordinary VP8X-backed image', async () => {
      expect(await isStructurallyValidWebp(validVp8X)).toBe(true);
      expect(await detectReceiptMimeFromBuffer(validVp8X)).toBe('image/webp');
    });

    it('rejects RIFF/WEBP prefix only', async () => {
      const prefix = Buffer.alloc(12);
      prefix.write('RIFF', 0);
      prefix.writeUInt32LE(4, 4);
      prefix.write('WEBP', 8);
      expect(await detectReceiptMimeFromBuffer(prefix)).toBeNull();
      expect(isWebpContainerValid(prefix)).toBe(false);
    });

    it('rejects invalid RIFF declared size', async () => {
      const bad = Buffer.from(validWebp);
      bad.writeUInt32LE(0xffffff, 4);
      expect(isWebpContainerValid(bad)).toBe(false);
      expect(await detectReceiptMimeFromBuffer(bad)).toBeNull();
    });

    it('rejects truncated image chunk', async () => {
      expect(await detectReceiptMimeFromBuffer(validWebp.subarray(0, 16))).toBeNull();
    });

    it('rejects one-byte VP8', async () => {
      const tiny = wrapWebpChunk('VP8 ', Buffer.from([0x00]));
      expect(validateVp8Payload(Buffer.from([0x00]))).toBe(false);
      expect(isWebpContainerValid(tiny)).toBe(false);
      expect(await detectReceiptMimeFromBuffer(tiny)).toBeNull();
    });

    it('rejects VP8 frame header only', async () => {
      const vp8 = Buffer.alloc(10);
      vp8[0] = 0x00;
      vp8[3] = 0x9d;
      vp8[4] = 0x01;
      vp8[5] = 0x2a;
      vp8.writeUInt16LE(1, 6);
      vp8.writeUInt16LE(1, 8);
      expect(validateVp8Payload(vp8)).toBe(false);
      expect(await isStructurallyValidWebp(wrapWebpChunk('VP8 ', vp8))).toBe(
        false,
      );
    });

    it('rejects VP8L fixed header only', async () => {
      const hdr = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]);
      expect(validateVp8LPayload(hdr)).toBe(false);
      expect(
        await detectReceiptMimeFromBuffer(wrapWebpChunk('VP8L', hdr)),
      ).toBeNull();
    });

    it('rejects VP8L header + insufficient garbage', async () => {
      const data = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00, 0xff]);
      // container may pass min-length, sharp pixel decode must reject
      expect(
        await detectReceiptMimeFromBuffer(wrapWebpChunk('VP8L', data)),
      ).toBeNull();
      expect(await isStructurallyValidWebp(wrapWebpChunk('VP8L', data))).toBe(
        false,
      );
    });

    it('rejects VP8X only', async () => {
      const vp8x = Buffer.alloc(10);
      const onlyX = wrapWebpChunk('VP8X', vp8x);
      expect(isWebpContainerValid(onlyX)).toBe(false);
      expect(await isStructurallyValidWebp(onlyX)).toBe(false);
    });

    it('rejects VP8X + malformed child VP8', async () => {
      const vp8x = Buffer.alloc(10);
      const badChild = Buffer.from([0x00]);
      const buf = wrapWebpChunks([
        { fourcc: 'VP8X', data: vp8x },
        { fourcc: 'VP8 ', data: badChild },
      ]);
      expect(isWebpContainerValid(buf)).toBe(false);
      expect(await isStructurallyValidWebp(buf)).toBe(false);
    });

    it('rejects VP8X + malformed child VP8L', async () => {
      const vp8x = Buffer.alloc(10);
      const badChild = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]);
      const buf = wrapWebpChunks([
        { fourcc: 'VP8X', data: vp8x },
        { fourcc: 'VP8L', data: badChild },
      ]);
      expect(isWebpContainerValid(buf)).toBe(false);
      expect(await isStructurallyValidWebp(buf)).toBe(false);
    });

    it('rejects invalid VP8 frame start code', async () => {
      const vp8 = Buffer.alloc(11);
      vp8[0] = 0x00;
      vp8[3] = 0x00;
      vp8[4] = 0x00;
      vp8[5] = 0x00;
      vp8.writeUInt16LE(1, 6);
      vp8.writeUInt16LE(1, 8);
      vp8[10] = 0xff;
      expect(validateVp8Payload(vp8)).toBe(false);
      expect(await isStructurallyValidWebp(wrapWebpChunk('VP8 ', vp8))).toBe(
        false,
      );
    });

    it('rejects VP8 with zero dimensions', async () => {
      const vp8 = Buffer.alloc(11);
      vp8[0] = 0x00;
      vp8[3] = 0x9d;
      vp8[4] = 0x01;
      vp8[5] = 0x2a;
      vp8.writeUInt16LE(0, 6);
      vp8.writeUInt16LE(0, 8);
      vp8[10] = 0xff;
      expect(validateVp8Payload(vp8)).toBe(false);
      expect(await isStructurallyValidWebp(wrapWebpChunk('VP8 ', vp8))).toBe(
        false,
      );
    });
  });

  describe('PDF', () => {
    it('accepts coherent minimal supported PDF', async () => {
      expect(isStructurallyValidPdf(validPdf)).toBe(true);
      expect(await detectReceiptMimeFromBuffer(validPdf)).toBe('application/pdf');
    });

    it('rejects "%PDF" only', async () => {
      expect(await detectReceiptMimeFromBuffer(Buffer.from('%PDF'))).toBeNull();
      expect(await detectReceiptMimeFromBuffer(Buffer.from('%PDF-1.4'))).toBeNull();
    });

    it('rejects header without EOF', () => {
      const noEof = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      );
      expect(isStructurallyValidPdf(noEof)).toBe(false);
    });

    it('rejects arbitrary prefix+EOF garbage', () => {
      const garbage = Buffer.from(
        '%PDF-1.4\nthis is not a real pdf body at all just filler text repeated enough to pass min length checks without objects\n%%EOF\n',
      );
      expect(isStructurallyValidPdf(garbage)).toBe(false);
    });

    it('rejects truncated PDF', async () => {
      expect(await detectReceiptMimeFromBuffer(validPdf.subarray(0, 40))).toBeNull();
    });

    it('rejects token-only thin PDF', () => {
      const thin = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
      );
      expect(isStructurallyValidPdf(thin)).toBe(false);
    });

    it('rejects /Root nonexistent', () => {
      expect(
        isStructurallyValidPdf(buildPdf({ rootRef: '99 0 R' })),
      ).toBe(false);
    });

    it('rejects /Root exists but lacks /Type /Catalog', () => {
      expect(
        isStructurallyValidPdf(
          buildPdf({ rootBody: '<< /Pages 2 0 R >>' }),
        ),
      ).toBe(false);
    });

    it('rejects /Root wrong object type', () => {
      expect(
        isStructurallyValidPdf(
          buildPdf({ rootBody: '<< /Type /Page /Pages 2 0 R >>' }),
        ),
      ).toBe(false);
    });

    it('rejects Catalog without /Pages', () => {
      expect(
        isStructurallyValidPdf(
          buildPdf({ rootBody: '<< /Type /Catalog >>' }),
        ),
      ).toBe(false);
    });

    it('rejects /Pages reference nonexistent', () => {
      expect(
        isStructurallyValidPdf(
          buildPdf({ rootBody: '<< /Type /Catalog /Pages 99 0 R >>' }),
        ),
      ).toBe(false);
    });

    it('rejects /Pages generation mismatch', () => {
      // Object 2 exists as gen 0, but Catalog references gen 7
      expect(
        isStructurallyValidPdf(
          buildPdf({ rootBody: '<< /Type /Catalog /Pages 2 7 R >>' }),
        ),
      ).toBe(false);
    });

    it('rejects Pages object lacking /Type /Pages', () => {
      expect(
        isStructurallyValidPdf(
          buildPdf({ pagesBody: '<< /Kids [] /Count 0 >>' }),
        ),
      ).toBe(false);
    });

    it('rejects bad startxref offset', () => {
      const lines = [
        '%PDF-1.4',
        '1 0 obj',
        '<< /Type /Catalog /Pages 2 0 R >>',
        'endobj',
        '2 0 obj',
        '<< /Type /Pages /Kids [] /Count 0 >>',
        'endobj',
      ];
      let body = `${lines.join('\n')}\n`;
      body +=
        'xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n99999\n%%EOF\n';
      expect(isStructurallyValidPdf(Buffer.from(body, 'utf8'))).toBe(false);
    });
  });

  describe('Fix Pass #4 self-attack shells', () => {
    it('rejects RIFF with VP8X + ALPH but no image bitstream', async () => {
      const buf = wrapWebpChunks([
        { fourcc: 'VP8X', data: Buffer.alloc(10) },
        { fourcc: 'ALPH', data: Buffer.from([0x00, 0x01, 0x02]) },
      ]);
      expect(await detectReceiptMimeFromBuffer(buf)).toBeNull();
    });

    it('rejects truncated real VP8 after container header lookalike', async () => {
      expect(
        await detectReceiptMimeFromBuffer(validWebp.subarray(0, validWebp.length - 8)),
      ).toBeNull();
    });

    it('rejects PDF Catalog text in unreferenced object only', () => {
      const lines = [
        '%PDF-1.4',
        '1 0 obj',
        '<< /Pages 2 0 R >>',
        'endobj',
        '2 0 obj',
        '<< /Type /Pages /Kids [] /Count 0 >>',
        'endobj',
        '9 0 obj',
        '<< /Type /Catalog /Pages 2 0 R >>',
        'endobj',
      ];
      let body = `${lines.join('\n')}\n`;
      const xrefPos = Buffer.byteLength(body, 'utf8');
      body +=
        'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000050 00000 n \n0000000100 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n' +
        String(xrefPos) +
        '\n%%EOF\n';
      expect(isStructurallyValidPdf(Buffer.from(body, 'utf8'))).toBe(false);
    });

    it('rejects PDF Pages /Type in wrong generation object', () => {
      const lines = [
        '%PDF-1.4',
        '1 0 obj',
        '<< /Type /Catalog /Pages 2 1 R >>',
        'endobj',
        '2 0 obj',
        '<< /Type /Pages /Kids [] /Count 0 >>',
        'endobj',
      ];
      let body = `${lines.join('\n')}\n`;
      const xrefPos = Buffer.byteLength(body, 'utf8');
      body +=
        'xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000060 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n' +
        String(xrefPos) +
        '\n%%EOF\n';
      expect(isStructurallyValidPdf(Buffer.from(body, 'utf8'))).toBe(false);
    });

    it('rejects PDF with valid Pages dict but Root gen mismatch', () => {
      expect(
        isStructurallyValidPdf(
          buildPdf({ rootGen: 0, rootRef: '1 5 R' }),
        ),
      ).toBe(false);
    });
  });

  describe('declared MIME / executables', () => {
    it('rejects executable/text labeled as image', async () => {
      expect(
        await detectReceiptMimeFromBuffer(Buffer.from('MZ\x90\x00exe')),
      ).toBeNull();
      expect(
        await detectReceiptMimeFromBuffer(Buffer.from('hello world')),
      ).toBeNull();
    });

    it('storeBuffer persists structural MIME and ignores declared', async () => {
      const error = {
        unprocessableEntity: jest.fn((msgs) => {
          throw new Error(msgs[0]);
        }),
      };
      const insertValues: any[] = [];
      const receiptRepository = {
        createQueryBuilder: jest.fn(() => ({
          insert: jest.fn().mockReturnThis(),
          values: jest.fn((v) => {
            insertValues.push(v);
            return {
              execute: jest
                .fn()
                .mockResolvedValue({ identifiers: [{ id: 1 }] }),
            };
          }),
        })),
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          mimeType: 'image/png',
          storageKey: 'x.png',
        }),
        delete: jest.fn(),
      };

      const svc = new PrivateReceiptStorageService(
        receiptRepository as any,
        error as any,
      );
      jest
        .spyOn(svc as any, 'resolveSafePath')
        .mockImplementation((k: string) => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const path = require('path');
          return path.join(svc.getRootDir(), k);
        });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

      await svc.storeBuffer({
        buffer: validPng,
        originalFilename: 'x.exe',
        mimeType: 'application/octet-stream',
        customerId: 1,
      });
      expect(insertValues[0].mimeType).toBe('image/png');
    });

    it('storeBuffer rejects prefix-only PNG even if declared image/png', async () => {
      const error = {
        unprocessableEntity: jest.fn((msgs) => {
          throw new Error(msgs[0]);
        }),
      };
      const svc = new PrivateReceiptStorageService({} as any, error as any);
      await expect(
        svc.storeBuffer({
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          originalFilename: 'a.png',
          mimeType: 'image/png',
          customerId: 1,
        }),
      ).rejects.toThrow();
    });
  });
});
