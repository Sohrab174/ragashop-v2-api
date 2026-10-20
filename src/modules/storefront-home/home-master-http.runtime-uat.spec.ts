/**
 * Authenticated HTTP UAT against the live local API (:9010).
 * Mints a short-lived JWT for an existing local admin user (role=admin bypasses capability rows).
 * Disposable outputs land under uploads/home and are deleted afterward.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as sharp from 'sharp';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const API = process.env.HOME_MASTER_UAT_API || 'http://127.0.0.1:9010';
const ADMIN_USER_ID = Number(process.env.HOME_MASTER_UAT_USER_ID || 5);

async function raster(
  format: 'jpeg' | 'png' | 'webp',
  w = 1600,
  h = 1200,
): Promise<Buffer> {
  const img = sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 30, g: 90, b: 140 },
    },
  });
  if (format === 'jpeg') return img.jpeg({ quality: 85 }).toBuffer();
  if (format === 'png') return img.png().toBuffer();
  return img.webp({ quality: 85 }).toBuffer();
}

function adminToken(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    throw new Error('AUTH_JWT_SECRET missing — cannot mint local UAT token');
  }
  return jwt.sign(
    { id: ADMIN_USER_ID, email: 'admin', mobile: null },
    secret,
    { expiresIn: '15m' },
  );
}

async function postMaster(
  token: string,
  file: { buffer: Buffer; filename: string; contentType: string },
  fields: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const boundary = `----uat${Date.now()}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
  );
  chunks.push(file.buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);

  try {
    const res = await axios.post(
      `${API}/storefront/home/image/admin/master`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );
    return { status: res.status, body: res.data };
  } catch (error: any) {
    return {
      status: error?.response?.status || 0,
      body: error?.response?.data || { message: String(error) },
    };
  }
}

async function postLegacy(
  token: string,
  file: { buffer: Buffer; filename: string; contentType: string },
): Promise<{ status: number; body: any }> {
  const boundary = `----uatleg${Date.now()}`;
  const chunks: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  const res = await axios.post(
    `${API}/storefront/home/image/admin`,
    Buffer.concat(chunks),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  );
  return { status: res.status, body: res.data };
}

async function unlinkHomePaths(paths: string[]) {
  for (const rel of paths) {
    if (!rel || typeof rel !== 'string') continue;
    if (rel.startsWith('/home/') || rel.startsWith('/home-masters/')) {
      const abs = path.join(process.cwd(), 'uploads', rel.replace(/^\//, ''));
      await fs.unlink(abs).catch(() => undefined);
    }
  }
}

async function postMultipartRaw(
  token: string | null,
  parts: Array<
    | { kind: 'field'; name: string; value: string }
    | { kind: 'file'; name: string; filename: string; contentType: string; buffer: Buffer }
  >,
): Promise<{ status: number; body: any }> {
  const boundary = `----uatlim${Date.now()}${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if (part.kind === 'field') {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        ),
      );
    } else {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType}\r\n\r\n`,
        ),
      );
      chunks.push(part.buffer);
      chunks.push(Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const headers: Record<string, string> = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await axios.post(
      `${API}/storefront/home/image/admin/master`,
      Buffer.concat(chunks),
      {
        headers,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );
    return { status: res.status, body: res.data };
  } catch (error: any) {
    return {
      status: error?.response?.status || 0,
      body: error?.response?.data || { message: String(error) },
    };
  }
}

async function postRecrop(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await axios.post(`${API}/storefront/home/image/admin/recrop`, body, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
  return { status: res.status, body: res.data };
}

describe('home-master HTTP runtime UAT (live :9010)', () => {
  let token: string;
  const created: string[] = [];

  beforeAll(() => {
    token = adminToken();
  });

  afterAll(async () => {
    await unlinkHomePaths(created);
  });

  it('rejects unauthenticated master upload', async () => {
    const res = await axios.post(
      `${API}/storefront/home/image/admin/master`,
      {},
      { validateStatus: () => true },
    );
    expect(res.status).toBe(401);
  });

  it.each([
    ['jpeg', 'image/jpeg', 'uat.jpg'],
    ['png', 'image/png', 'uat.png'],
    ['webp', 'image/webp', 'uat.webp'],
  ] as const)('master %s → desktop/mobile webp (hero)', async (format, mime, name) => {
    const res = await postMaster(
      token,
      { buffer: await raster(format), filename: name, contentType: mime },
      {
        profile: 'hero',
        focusDesktopX: '35',
        focusDesktopY: '25',
        focusMobileX: '65',
        focusMobileY: '40',
      },
    );
    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.desktopPath).toMatch(/^\/home\/.+\.webp$/);
    expect(data.mobilePath).toMatch(/^\/home\/.+\.webp$/);
    expect(data.desktopUrl).toContain('/static/home/');
    expect(data.mobileUrl).toContain('/static/home/');
    created.push(data.desktopPath, data.mobilePath);

    const deskAbs = path.join(
      process.cwd(),
      'uploads',
      data.desktopPath.replace(/^\//, ''),
    );
    const meta = await sharp(deskAbs).metadata();
    expect(meta.format).toBe('webp');
  });

  it('master category profile includes mobileWide ≈2.15:1', async () => {
    const res = await postMaster(
      token,
      {
        buffer: await raster('jpeg', 1400, 1400),
        filename: 'cat.jpg',
        contentType: 'image/jpeg',
      },
      { profile: 'category' },
    );
    expect([200, 201]).toContain(res.status);
    const data = res.body.data;
    expect(data.profile).toBe('category');
    expect(data.masterPath).toMatch(/^\/home-masters\//);
    expect(data.mobileWidePath).toMatch(/^\/home\/.+\.webp$/);
    created.push(
      data.desktopPath,
      data.mobilePath,
      data.mobileWidePath,
      data.masterPreviewPath,
      data.masterPath,
    );
    const desk = await sharp(
      path.join(process.cwd(), 'uploads', data.desktopPath.replace(/^\//, '')),
    ).metadata();
    const mob = await sharp(
      path.join(process.cwd(), 'uploads', data.mobilePath.replace(/^\//, '')),
    ).metadata();
    const wide = await sharp(
      path.join(process.cwd(), 'uploads', data.mobileWidePath.replace(/^\//, '')),
    ).metadata();
    expect(desk.width! / desk.height!).toBeCloseTo(1.2, 1);
    expect(mob.width! / mob.height!).toBeCloseTo(1.05, 1);
    expect(wide.width! / wide.height!).toBeCloseTo(2.15, 1);
  });

  it('rejects too many fields with 422', async () => {
    const fileBuf = await raster('jpeg', 400, 300);
    const fields = [
      'profile',
      'focusDesktopX',
      'focusDesktopY',
      'focusMobileX',
      'focusMobileY',
      'extraField',
    ];
    const res = await postMultipartRaw(token, [
      ...fields.map((name) => ({ kind: 'field' as const, name, value: '1' })),
      {
        kind: 'file',
        name: 'file',
        filename: 't.jpg',
        contentType: 'image/jpeg',
        buffer: fileBuf,
      },
    ]);
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('rejects too many parts with 422', async () => {
    const fileBuf = await raster('jpeg', 400, 300);
    const res = await postMultipartRaw(token, [
      { kind: 'field', name: 'profile', value: 'hero' },
      { kind: 'field', name: 'focusDesktopX', value: '50' },
      { kind: 'field', name: 'focusDesktopY', value: '50' },
      { kind: 'field', name: 'focusMobileX', value: '50' },
      { kind: 'field', name: 'focusMobileY', value: '50' },
      { kind: 'field', name: 'bonus', value: 'x' },
      {
        kind: 'file',
        name: 'file',
        filename: 't.jpg',
        contentType: 'image/jpeg',
        buffer: fileBuf,
      },
    ]);
    expect(res.status).toBe(422);
  });

  it('rejects oversized field values with 422', async () => {
    const fileBuf = await raster('jpeg', 400, 300);
    const res = await postMultipartRaw(token, [
      { kind: 'field', name: 'profile', value: 'h'.repeat(200) },
      {
        kind: 'file',
        name: 'file',
        filename: 't.jpg',
        contentType: 'image/jpeg',
        buffer: fileBuf,
      },
    ]);
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('recrop regenerates crops from retained master', async () => {
    const upload = await postMaster(
      token,
      {
        buffer: await raster('jpeg', 1600, 1200),
        filename: 'recrop-src.jpg',
        contentType: 'image/jpeg',
      },
      {
        profile: 'hero',
        focusDesktopX: '20',
        focusDesktopY: '20',
        focusMobileX: '20',
        focusMobileY: '20',
      },
    );
    expect([200, 201]).toContain(upload.status);
    const first = upload.body.data;
    created.push(
      first.desktopPath,
      first.mobilePath,
      first.masterPreviewPath,
      first.masterPath,
    );

    const recrop = await postRecrop(token, {
      masterPath: first.masterPath,
      profile: 'hero',
      focusDesktopX: 80,
      focusDesktopY: 80,
      focusMobileX: 80,
      focusMobileY: 80,
    });
    expect([200, 201]).toContain(recrop.status);
    expect(recrop.body.success).toBe(true);
    const second = recrop.body.data;
    expect(second.masterPath).toBe(first.masterPath);
    created.push(second.desktopPath, second.mobilePath, second.masterPreviewPath);

    const a = await fs.readFile(
      path.join(process.cwd(), 'uploads', first.desktopPath.replace(/^\//, '')),
    );
    const b = await fs.readFile(
      path.join(process.cwd(), 'uploads', second.desktopPath.replace(/^\//, '')),
    );
    // Solid color may collide; still expect new files written.
    expect(second.desktopPath).not.toBe(first.desktopPath);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('rejects path traversal on recrop', async () => {
    const res = await postRecrop(token, {
      masterPath: '/home-masters/../home/secret.webp',
      profile: 'hero',
    });
    expect(res.status).toBe(422);
  });

  it('does not publicly serve retained masters', async () => {
    const upload = await postMaster(
      token,
      {
        buffer: await raster('jpeg', 800, 600),
        filename: 'private-master.jpg',
        contentType: 'image/jpeg',
      },
      { profile: 'hero' },
    );
    expect([200, 201]).toContain(upload.status);
    const data = upload.body.data;
    created.push(
      data.desktopPath,
      data.mobilePath,
      data.masterPreviewPath,
      data.masterPath,
    );
    const forbidden = await axios.get(
      `${API}/static/home-masters/${path.basename(data.masterPath)}`,
      { validateStatus: () => true },
    );
    expect([404, 403, 401]).toContain(forbidden.status);
  });

  it('master pets profile via API', async () => {
    const res = await postMaster(
      token,
      {
        buffer: await raster('png', 2000, 1000),
        filename: 'pets.png',
        contentType: 'image/png',
      },
      { profile: 'pets' },
    );
    expect([200, 201]).toContain(res.status);
    const data = res.body.data;
    expect(data.profile).toBe('pets');
    created.push(data.desktopPath, data.mobilePath);
    const mob = await sharp(
      path.join(process.cwd(), 'uploads', data.mobilePath.replace(/^\//, '')),
    ).metadata();
    expect(mob.width! / mob.height!).toBeCloseTo(2.15, 1);
  });

  it('rejects svg and corrupt masters', async () => {
    const svg = await postMaster(
      token,
      {
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      },
      { profile: 'hero' },
    );
    expect([400, 422]).toContain(svg.status);

    const corrupt = await postMaster(
      token,
      {
        buffer: Buffer.from('not-an-image'),
        filename: 'bad.jpg',
        contentType: 'image/jpeg',
      },
      { profile: 'hero' },
    );
    expect([400, 422]).toContain(corrupt.status);
  });

  it('legacy single upload remains compatible', async () => {
    const res = await postLegacy(token, {
      buffer: await raster('jpeg', 800, 600),
      filename: 'legacy.jpg',
      contentType: 'image/jpeg',
    });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.path).toMatch(/^\/home\//);
    created.push(res.body.data.path);
  });

  it('serves generated static home assets', async () => {
    const res = await postMaster(
      token,
      {
        buffer: await raster('webp', 1200, 900),
        filename: 'serve.webp',
        contentType: 'image/webp',
      },
      { profile: 'hero' },
    );
    expect([200, 201]).toContain(res.status);
    const data = res.body.data;
    created.push(data.desktopPath, data.mobilePath);
    const staticRes = await axios.get(
      `${API}/static/home/${path.basename(data.desktopPath)}`,
      {
        responseType: 'arraybuffer',
        validateStatus: () => true,
      },
    );
    expect(staticRes.status).toBe(200);
    expect(String(staticRes.headers['content-type'] || '')).toMatch(
      /image\/webp/i,
    );
  });
});
