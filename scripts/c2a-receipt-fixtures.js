/* eslint-disable no-console */
const zlib = require('zlib');
const sharp = require('sharp');

function crc32(buf) {
  const table = [];
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

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function buildPng() {
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

async function buildJpeg() {
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

function buildWebp() {
  return Buffer.from(
    'UklGRi4AAABXRUJQVlA4ICIAAABwAQCdASoCAAIAAUAmJZQCdAFAAAD+/DeBV/fU6D4r4AAA',
    'base64',
  );
}

function buildPdf() {
  const lines = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
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
  body +=
    'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n' +
    String(xrefPos) +
    '\n%%EOF\n';
  return Buffer.from(body, 'utf8');
}

module.exports = { buildPng, buildJpeg, buildWebp, buildPdf };

if (require.main === module) {
  (async () => {
    const {
      detectReceiptMimeFromBuffer,
    } = require('../src/modules/manual-payment/utils/receipt-content-validation');
    for (const [name, buf] of [
      ['png', buildPng()],
      ['jpeg', await buildJpeg()],
      ['webp', buildWebp()],
      ['pdf', buildPdf()],
    ]) {
      console.log(name, buf.length, await detectReceiptMimeFromBuffer(buf));
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
