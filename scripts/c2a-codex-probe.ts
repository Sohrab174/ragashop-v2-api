/**
 * Direct Codex + Fix Pass #4 adversarial probe.
 * Run: npx ts-node scripts/c2a-codex-probe.ts
 */
import * as sharp from 'sharp';
import * as zlib from 'zlib';
import {
  detectReceiptMimeFromBuffer,
  isStructurallyValidPdf,
} from '../src/modules/manual-payment/utils/receipt-content-validation';

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

function buildPdf(opts?: {
  rootBody?: string;
  pagesBody?: string;
  rootRef?: string;
}): Buffer {
  const rootBody =
    opts?.rootBody ?? '<< /Type /Catalog /Pages 2 0 R >>';
  const pagesBody =
    opts?.pagesBody ?? '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const lines = [
    '%PDF-1.4',
    '1 0 obj',
    rootBody,
    'endobj',
    '2 0 obj',
    pagesBody,
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

async function main() {
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

  const adversarial = {
    pngNoIdat: await detectReceiptMimeFromBuffer(pngNoIdat),
    tinyWebp: await detectReceiptMimeFromBuffer(tinyWebp),
    vp8lHeaderOnly: await detectReceiptMimeFromBuffer(vp8lHeaderOnly),
    thinPdf: await detectReceiptMimeFromBuffer(thinPdf),
    pdfRootNotCatalog: await detectReceiptMimeFromBuffer(pdfRootNotCatalog),
    pdfMissingPagesObject: await detectReceiptMimeFromBuffer(
      pdfMissingPagesObject,
    ),
  };
  console.log('ADVERSARIAL_PROBE');
  console.log(JSON.stringify(adversarial, null, 2));

  // Valid fixtures must still be accepted
  const idat = zlib.deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]));
  const validPng = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const validJpeg = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 4, g: 5, b: 6 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  const validVp8 = Buffer.from(
    'UklGRi4AAABXRUJQVlA4ICIAAABwAQCdASoCAAIAAUAmJZQCdAFAAAD+/DeBV/fU6D4r4AAA',
    'base64',
  );
  const validVp8L = Buffer.from(
    'UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQmaKUp/+BiOh/AAA=',
    'base64',
  );
  const validVp8X = Buffer.from(
    'UklGRk4AAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgICAgABWUDggIgAAAHABAJ0BKgIAAgABQCYllAJ0AUAAAP7yqULUSVLyfojAAAA=',
    'base64',
  );
  const validPdf = buildPdf();

  const valid = {
    png: await detectReceiptMimeFromBuffer(validPng),
    jpeg: await detectReceiptMimeFromBuffer(validJpeg),
    webpVp8: await detectReceiptMimeFromBuffer(validVp8),
    webpVp8L: await detectReceiptMimeFromBuffer(validVp8L),
    webpVp8X: await detectReceiptMimeFromBuffer(validVp8X),
    pdf: await detectReceiptMimeFromBuffer(validPdf),
  };
  console.log('VALID_FIXTURES');
  console.log(JSON.stringify(valid, null, 2));

  // Extra self-attack (must all be null / false)
  const selfAttack = {
    vp8xAlphOnly: await detectReceiptMimeFromBuffer(
      (() => {
        const parts: Buffer[] = [Buffer.from('WEBP')];
        for (const [fcc, data] of [
          ['VP8X', Buffer.alloc(10)],
          ['ALPH', Buffer.from([1, 2, 3])],
        ] as const) {
          const h = Buffer.alloc(8);
          h.write(fcc);
          h.writeUInt32LE(data.length, 4);
          const pad = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
          parts.push(h, data, pad);
        }
        const body = Buffer.concat(parts);
        const r = Buffer.alloc(8);
        r.write('RIFF');
        r.writeUInt32LE(body.length, 4);
        return Buffer.concat([r, body]);
      })(),
    ),
    truncatedVp8: await detectReceiptMimeFromBuffer(
      validVp8.subarray(0, validVp8.length - 6),
    ),
    catalogInUnreferencedObj: isStructurallyValidPdf(
      (() => {
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
        return Buffer.from(body, 'utf8');
      })(),
    ),
    pagesGenMismatch: isStructurallyValidPdf(
      buildPdf({ rootBody: '<< /Type /Catalog /Pages 2 7 R >>' }),
    ),
    rootGenMismatch: isStructurallyValidPdf(
      buildPdf({ rootRef: '1 5 R' }),
    ),
  };
  console.log('SELF_ATTACK');
  console.log(JSON.stringify(selfAttack, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
