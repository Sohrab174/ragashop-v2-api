/**
 * Structural validators for C2A private receipt uploads.
 * Images: cheap container checks + sharp pixel decode (rejects header-only shells).
 * PDF: classic-xref subset with resolved Root→Catalog→Pages object graph.
 */

import * as sharp from 'sharp';

export type ReceiptDetectedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

const PNG_SIG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Valid PNG color types (IHDR byte 9). */
const PNG_COLOR_TYPES = new Set([0, 2, 3, 4, 6]);

/** Cap decoded pixels (~50MP) — upload itself is already ≤5MB. */
const SHARP_LIMIT_INPUT_PIXELS = 50_000_000;
const MAX_IMAGE_DIM = 50_000;

/** VP8 lossy frame header size (tag + start code + dims). */
const VP8_FRAME_HEADER_BYTES = 10;
/** VP8L fixed header: signature + 32-bit dimension/version word. */
const VP8L_FIXED_HEADER_BYTES = 5;
/** Require non-empty bitstream after VP8/VP8L fixed headers. */
const MIN_VP8_BITSTREAM_AFTER_HEADER = 1;
const MIN_VP8L_BITSTREAM_AFTER_HEADER = 1;

function readUInt32BE(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 4 > buf.length) {
    return null;
  }
  return buf.readUInt32BE(offset);
}

function readUInt32LE(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 4 > buf.length) {
    return null;
  }
  return buf.readUInt32LE(offset);
}

function readUInt16BE(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 2 > buf.length) {
    return null;
  }
  return buf.readUInt16BE(offset);
}

function readUInt24LE(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 3 > buf.length) {
    return null;
  }
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

/**
 * PNG container: signature, IHDR first (13 bytes, non-zero dims), ≥1 non-empty IDAT, IEND.
 */
export function isPngContainerValid(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 8 + 25 + 13 + 12) {
    return false;
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIG)) {
    return false;
  }

  let offset = 8;
  let sawIhdr = false;
  let sawIdat = false;
  let idatBytes = 0;
  let chunkCount = 0;
  const maxChunks = Math.min(buffer.length, 100_000);

  while (offset + 12 <= buffer.length && chunkCount < maxChunks) {
    chunkCount += 1;
    const length = readUInt32BE(buffer, offset);
    if (length == null || length < 0 || length > 0x7fffffff) {
      return false;
    }
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > buffer.length) {
      return false;
    }

    const type = buffer.toString('ascii', typeStart, typeStart + 4);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      return false;
    }

    if (chunkCount === 1) {
      if (type !== 'IHDR' || length !== 13) {
        return false;
      }
      const width = readUInt32BE(buffer, dataStart);
      const height = readUInt32BE(buffer, dataStart + 4);
      if (width == null || height == null || width < 1 || height < 1) {
        return false;
      }
      if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
        return false;
      }
      const bitDepth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9];
      const compression = buffer[dataStart + 10];
      const filter = buffer[dataStart + 11];
      const interlace = buffer[dataStart + 12];
      if (![1, 2, 4, 8, 16].includes(bitDepth)) {
        return false;
      }
      if (!PNG_COLOR_TYPES.has(colorType)) {
        return false;
      }
      if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
        return false;
      }
      sawIhdr = true;
    } else if (type === 'IHDR') {
      return false;
    }

    if (type === 'IDAT') {
      if (length < 1) {
        return false;
      }
      sawIdat = true;
      idatBytes += length;
    }

    if (type === 'IEND') {
      if (length !== 0) {
        return false;
      }
      if (crcEnd !== buffer.length) {
        return false;
      }
      return sawIhdr && sawIdat && idatBytes > 0;
    }

    offset = crcEnd;
  }

  return false;
}

/**
 * JPEG container: SOI, SOF with non-zero dims, SOS with entropy bytes, EOI.
 */
export function isJpegContainerValid(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 6) {
    return false;
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return false;
  }

  let i = 2;
  let sawSof = false;
  let sawSos = false;
  let entropyBytes = 0;
  let iterations = 0;
  const maxIter = buffer.length + 8;

  while (i < buffer.length && iterations < maxIter) {
    iterations += 1;

    while (i < buffer.length && buffer[i] === 0xff) {
      i += 1;
    }
    if (i >= buffer.length) {
      return false;
    }

    const marker = buffer[i];
    i += 1;

    if (marker === 0xd9) {
      return sawSof && sawSos && entropyBytes > 0 && i === buffer.length;
    }

    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }

    if (marker === 0xd8 || marker === 0x00) {
      return false;
    }

    const len = readUInt16BE(buffer, i);
    if (len == null || len < 2) {
      return false;
    }
    const segmentEnd = i + len;
    if (segmentEnd > buffer.length) {
      return false;
    }

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (len < 8) {
        return false;
      }
      const height = readUInt16BE(buffer, i + 3);
      const width = readUInt16BE(buffer, i + 5);
      if (width == null || height == null || width < 1 || height < 1) {
        return false;
      }
      if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
        return false;
      }
      sawSof = true;
    }

    if (marker === 0xda) {
      if (!sawSof) {
        return false;
      }
      sawSos = true;
      i = segmentEnd;
      let scanIter = 0;
      const maxScan = buffer.length + 8;
      const scanStart = i;
      while (i < buffer.length && scanIter < maxScan) {
        scanIter += 1;
        if (buffer[i] !== 0xff) {
          i += 1;
          continue;
        }
        let j = i;
        while (j < buffer.length && buffer[j] === 0xff) {
          j += 1;
        }
        if (j >= buffer.length) {
          return false;
        }
        const m = buffer[j];
        if (m === 0x00) {
          i = j + 1;
          continue;
        }
        if (m >= 0xd0 && m <= 0xd7) {
          i = j + 1;
          continue;
        }
        if (m === 0xd9) {
          entropyBytes = i - scanStart;
          i = j + 1;
          return (
            sawSof && sawSos && entropyBytes > 0 && i === buffer.length
          );
        }
        return false;
      }
      return false;
    }

    i = segmentEnd;
  }

  return false;
}

/**
 * Shared VP8 lossy payload validator (standalone chunk or under VP8X).
 * Header alone is insufficient — requires bitstream bytes after the frame header.
 */
export function validateVp8Payload(data: Buffer): boolean {
  if (
    data.length <
    VP8_FRAME_HEADER_BYTES + MIN_VP8_BITSTREAM_AFTER_HEADER
  ) {
    return false;
  }
  const isKeyFrame = (data[0] & 0x1) === 0;
  if (!isKeyFrame) {
    return false;
  }
  if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
    return false;
  }
  const width = data.readUInt16LE(6) & 0x3fff;
  const height = data.readUInt16LE(8) & 0x3fff;
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
    return false;
  }
  return true;
}

/**
 * Shared VP8L lossless payload validator (standalone chunk or under VP8X).
 * Fixed header alone is insufficient — requires bitstream after the 5-byte header
 * and version bits must be 0.
 */
export function validateVp8LPayload(data: Buffer): boolean {
  if (
    data.length <
    VP8L_FIXED_HEADER_BYTES + MIN_VP8L_BITSTREAM_AFTER_HEADER
  ) {
    return false;
  }
  if (data[0] !== 0x2f) {
    return false;
  }
  const bits =
    data[1] |
    (data[2] << 8) |
    (data[3] << 16) |
    (data[4] << 24);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >> 14) & 0x3fff) + 1;
  const version = (bits >>> 29) & 0x7;
  if (version !== 0) {
    return false;
  }
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
    return false;
  }
  return true;
}

function validateVp8XHeader(data: Buffer): {
  width: number;
  height: number;
} | null {
  if (data.length !== 10) {
    return null;
  }
  const width = readUInt24LE(data, 4);
  const height = readUInt24LE(data, 7);
  if (width == null || height == null) {
    return null;
  }
  const w = width + 1;
  const h = height + 1;
  if (w < 1 || h < 1 || w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
    return null;
  }
  return { width: w, height: h };
}

/**
 * WebP container: RIFF size match + WEBP + VP8 / VP8L / VP8X(+validated child payload).
 * Does not prove decodability — pair with sharp for that.
 */
export function isWebpContainerValid(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 20) {
    return false;
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') {
    return false;
  }
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return false;
  }

  const riffSize = readUInt32LE(buffer, 4);
  if (riffSize == null || riffSize + 8 !== buffer.length) {
    return false;
  }

  let offset = 12;
  let chunkCount = 0;
  const maxChunks = Math.min(buffer.length, 100_000);

  let sawVp8 = false;
  let sawVp8L = false;
  let sawVp8X = false;
  let imagePayloadOk = false;

  while (offset + 8 <= buffer.length && chunkCount < maxChunks) {
    chunkCount += 1;
    const fourcc = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = readUInt32LE(buffer, offset + 4);
    if (chunkSize == null || chunkSize < 0 || chunkSize > 0x7fffffff) {
      return false;
    }
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    const paddedEnd = dataEnd + (chunkSize % 2);
    if (paddedEnd > buffer.length) {
      return false;
    }
    const data = buffer.subarray(dataStart, dataEnd);

    if (fourcc === 'VP8 ') {
      if (!validateVp8Payload(data)) {
        return false;
      }
      sawVp8 = true;
      imagePayloadOk = true;
    } else if (fourcc === 'VP8L') {
      if (!validateVp8LPayload(data)) {
        return false;
      }
      sawVp8L = true;
      imagePayloadOk = true;
    } else if (fourcc === 'VP8X') {
      if (!validateVp8XHeader(data)) {
        return false;
      }
      sawVp8X = true;
    } else if (fourcc === 'ALPH') {
      if (chunkSize < 1) {
        return false;
      }
    } else if (fourcc === 'ANIM' || fourcc === 'ANMF') {
      return false;
    }

    offset = paddedEnd;
  }

  if (offset !== buffer.length) {
    return false;
  }

  if ((sawVp8 || sawVp8L) && !sawVp8X) {
    return imagePayloadOk;
  }

  if (sawVp8X) {
    return imagePayloadOk && (sawVp8 || sawVp8L);
  }

  return false;
}

/**
 * Prove image pixels are decodable via already-installed sharp (bounded).
 * Metadata-only is insufficient — VP8L header shells can report dimensions.
 */
async function sharpPixelsDecodable(
  buffer: Buffer,
  expectedFormat: 'jpeg' | 'png' | 'webp',
): Promise<boolean> {
  try {
    const pipeline = sharp(buffer, {
      failOn: 'error',
      limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
      sequentialRead: true,
    });
    const meta = await pipeline.metadata();
    if (meta.format !== expectedFormat) {
      return false;
    }
    if (
      !meta.width ||
      !meta.height ||
      meta.width < 1 ||
      meta.height < 1 ||
      meta.width > MAX_IMAGE_DIM ||
      meta.height > MAX_IMAGE_DIM
    ) {
      return false;
    }
    // Force pixel decode — rejects header-only / truncated bitstreams that
    // still expose dimensions via metadata.
    await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
      sequentialRead: true,
    })
      .raw()
      .toBuffer();
    return true;
  } catch {
    return false;
  }
}

export async function isStructurallyValidPng(buffer: Buffer): Promise<boolean> {
  if (!isPngContainerValid(buffer)) {
    return false;
  }
  return sharpPixelsDecodable(buffer, 'png');
}

export async function isStructurallyValidJpeg(
  buffer: Buffer,
): Promise<boolean> {
  if (!isJpegContainerValid(buffer)) {
    return false;
  }
  return sharpPixelsDecodable(buffer, 'jpeg');
}

export async function isStructurallyValidWebp(
  buffer: Buffer,
): Promise<boolean> {
  if (!isWebpContainerValid(buffer)) {
    return false;
  }
  return sharpPixelsDecodable(buffer, 'webp');
}

type PdfObject = { num: number; gen: number; body: string };

/**
 * Parse indirect objects with a bounded linear scan (no catastrophic backtracking).
 */
function parsePdfObjects(full: string): PdfObject[] {
  const objects: PdfObject[] = [];
  const n = full.length;
  let i = 0;
  let steps = 0;
  const maxSteps = n + 8;

  while (i < n && steps < maxSteps && objects.length < 10_000) {
    steps += 1;
    const slice = full.slice(i);
    const m = /^(\d{1,10})\s+(\d{1,5})\s+obj\b/.exec(slice);
    if (!m) {
      i += 1;
      continue;
    }
    const num = Number(m[1]);
    const gen = Number(m[2]);
    const bodyStart = i + m[0].length;
    const endIdx = full.indexOf('endobj', bodyStart);
    if (endIdx < 0 || endIdx - bodyStart > 2_000_000) {
      return [];
    }
    const body = full.slice(bodyStart, endIdx);
    objects.push({ num, gen, body });
    i = endIdx + 'endobj'.length;
  }

  return objects;
}

function objectKey(num: number, gen: number): string {
  return `${num}:${gen}`;
}

function buildObjectMap(
  objects: PdfObject[],
): Map<string, PdfObject> | null {
  const map = new Map<string, PdfObject>();
  for (const o of objects) {
    if (!Number.isFinite(o.num) || !Number.isFinite(o.gen) || o.num < 1) {
      return null;
    }
    const key = objectKey(o.num, o.gen);
    // Ambiguous duplicate definitions — reject rather than guess.
    if (map.has(key)) {
      return null;
    }
    map.set(key, o);
  }
  return map;
}

function extractNamedRef(
  dict: string,
  name: string,
): { num: number; gen: number } | null {
  const m = new RegExp(
    `/${name}\\s+(\\d{1,10})\\s+(\\d{1,5})\\s+R\\b`,
  ).exec(dict);
  if (!m) {
    return null;
  }
  return { num: Number(m[1]), gen: Number(m[2]) };
}

function hasExplicitType(body: string, typeName: string): boolean {
  return new RegExp(`/Type\\s*/${typeName}\\b`).test(body);
}

/**
 * PDF: classic xref subset + resolved Root → Catalog → Pages graph.
 * Unreferenced Catalog/Pages tokens elsewhere do not count.
 */
export function isStructurallyValidPdf(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 64) {
    return false;
  }

  const full = buffer.toString('latin1');
  const headWindow = full.slice(0, Math.min(1024, full.length));
  const headerMatch = /%PDF-(\d+\.\d+)/.exec(headWindow);
  if (!headerMatch || headerMatch.index == null || headerMatch.index > 1024) {
    return false;
  }

  const eofIdx = full.lastIndexOf('%%EOF');
  if (eofIdx < 0) {
    return false;
  }
  if (full.length - eofIdx > 256) {
    return false;
  }

  const objects = parsePdfObjects(full);
  if (objects.length < 1) {
    return false;
  }
  const objectMap = buildObjectMap(objects);
  if (!objectMap) {
    return false;
  }

  const trailerIdx = full.lastIndexOf('trailer', eofIdx);
  const startxrefIdx = full.lastIndexOf('startxref', eofIdx);
  if (trailerIdx < 0 || startxrefIdx < 0 || trailerIdx >= startxrefIdx) {
    return false;
  }

  const afterStartxref = full.slice(startxrefIdx + 'startxref'.length, eofIdx);
  const xrefOffsetMatch = /(\d{1,10})/.exec(afterStartxref);
  if (!xrefOffsetMatch) {
    return false;
  }
  const xrefOffset = Number(xrefOffsetMatch[1]);
  if (!Number.isFinite(xrefOffset) || xrefOffset < 0 || xrefOffset >= buffer.length) {
    return false;
  }
  // Conservative classic-xref subset only (no xref-stream pretence).
  const atXref = full.slice(xrefOffset, Math.min(full.length, xrefOffset + 8));
  if (!atXref.startsWith('xref')) {
    return false;
  }

  const trailerSection = full.slice(trailerIdx, startxrefIdx);
  const rootRef = extractNamedRef(trailerSection, 'Root');
  if (!rootRef) {
    return false;
  }

  const rootObj = objectMap.get(objectKey(rootRef.num, rootRef.gen));
  if (!rootObj) {
    return false;
  }
  if (!hasExplicitType(rootObj.body, 'Catalog')) {
    return false;
  }

  const pagesRef = extractNamedRef(rootObj.body, 'Pages');
  if (!pagesRef) {
    return false;
  }

  const pagesObj = objectMap.get(objectKey(pagesRef.num, pagesRef.gen));
  if (!pagesObj) {
    return false;
  }
  if (!hasExplicitType(pagesObj.body, 'Pages')) {
    return false;
  }

  return true;
}

/**
 * Detect MIME only after format-specific structural validation succeeds.
 * Declared client mimetype is never consulted.
 */
export async function detectReceiptMimeFromBuffer(
  buffer: Buffer,
): Promise<ReceiptDetectedMime | null> {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return (await isStructurallyValidJpeg(buffer)) ? 'image/jpeg' : null;
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return (await isStructurallyValidPng(buffer)) ? 'image/png' : null;
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return (await isStructurallyValidWebp(buffer)) ? 'image/webp' : null;
  }

  const head = buffer
    .subarray(0, Math.min(16, buffer.length))
    .toString('latin1');
  if (head.includes('%PDF') || (buffer[0] === 0x25 && buffer[1] === 0x50)) {
    return isStructurallyValidPdf(buffer) ? 'application/pdf' : null;
  }

  return null;
}
