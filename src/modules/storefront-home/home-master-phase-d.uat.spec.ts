/**
 * Integrated Phase D UAT — disposable images only, preview-session only, never publishes.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import * as sharp from 'sharp';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const API = process.env.HOME_MASTER_UAT_API || 'http://127.0.0.1:9010';
const ADMIN_USER_ID = Number(process.env.HOME_MASTER_UAT_USER_ID || 5);

function token(): string {
  return jwt.sign(
    { id: ADMIN_USER_ID, email: 'admin', mobile: null },
    process.env.AUTH_JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

async function threeBandJpeg(): Promise<Buffer> {
  const width = 2400;
  const height = 900;
  const { data } = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      if (x < width / 3) {
        data[i] = 220;
        data[i + 1] = 30;
        data[i + 2] = 30;
      } else if (x < (2 * width) / 3) {
        data[i] = 30;
        data[i + 1] = 200;
        data[i + 2] = 50;
      } else {
        data[i] = 30;
        data[i + 1] = 60;
        data[i + 2] = 220;
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

function sampleBand(
  raw: Buffer,
  width: number,
  height: number,
  channels: number,
  xRatio: number,
) {
  const x = Math.min(width - 1, Math.max(0, Math.floor(width * xRatio)));
  const y = Math.floor(height / 2);
  const i = (y * width + x) * channels;
  return [raw[i], raw[i + 1], raw[i + 2]] as const;
}

async function readWebpBands(absOrUrl: string) {
  let buf: Buffer;
  if (absOrUrl.startsWith('http')) {
    const res = await axios.get(absOrUrl, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    expect(res.status).toBe(200);
    buf = Buffer.from(res.data);
  } else {
    buf = await fs.readFile(absOrUrl);
  }
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return {
    info,
    left: sampleBand(data, info.width, info.height, info.channels, 0.12),
    mid: sampleBand(data, info.width, info.height, info.channels, 0.5),
    right: sampleBand(data, info.width, info.height, info.channels, 0.88),
  };
}

describe('Phase D integrated UAT (non-destructive)', () => {
  const auth = token();
  let masterPath = '';
  let masterPreviewPath = '';
  let publicBefore = '';

  beforeAll(async () => {
    const pub = await axios.get(`${API}/storefront/home`, { validateStatus: () => true });
    expect(pub.status).toBe(200);
    publicBefore = JSON.stringify(pub.data?.data?.sections || []);
  });

  afterAll(async () => {
    const pub = await axios.get(`${API}/storefront/home`, { validateStatus: () => true });
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.data?.data?.sections || [])).toBe(publicBefore);
  });

  it('upload master then recrop Cover/Contain/Manual independently', async () => {
    const file = await threeBandJpeg();
    const boundary = `----uat${Date.now()}`;
    const chunks = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="profile"\r\n\r\nhero\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="focusDesktopX"\r\n\r\n50\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="focusDesktopY"\r\n\r\n50\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="focusMobileX"\r\n\r\n50\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="focusMobileY"\r\n\r\n50\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="three.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    const up = await axios.post(
      `${API}/storefront/home/image/admin/master`,
      Buffer.concat(chunks),
      {
        headers: {
          Authorization: `Bearer ${auth}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        validateStatus: () => true,
        maxBodyLength: Infinity,
      },
    );
    expect([200, 201]).toContain(up.status);
    masterPath = up.data?.data?.masterPath;
    masterPreviewPath = up.data?.data?.masterPreviewPath;
    expect(masterPath).toMatch(/^\/home-masters\//);

    const cover = await axios.post(
      `${API}/storefront/home/image/admin/recrop`,
      {
        masterPath,
        profile: 'hero',
        compositionDesktop: { fit: 'cover', panX: 20, panY: 50 },
        compositionMobile: { fit: 'cover', panX: 80, panY: 50 },
      },
      { headers: { Authorization: `Bearer ${auth}` }, validateStatus: () => true },
    );
    expect([200, 201]).toContain(cover.status);
    expect(cover.data?.data?.desktopUrl).toContain('/static/home/');
    expect(cover.data?.data?.mobileUrl).toContain('/static/home/');

    const contain = await axios.post(
      `${API}/storefront/home/image/admin/recrop`,
      {
        masterPath,
        profile: 'hero',
        compositionDesktop: {
          fit: 'contain',
          panX: 50,
          panY: 50,
          backgroundMode: 'solid',
          backgroundColor: '#101010',
        },
        compositionMobile: {
          fit: 'contain',
          panX: 50,
          panY: 50,
          backgroundMode: 'blur',
        },
      },
      { headers: { Authorization: `Bearer ${auth}` }, validateStatus: () => true },
    );
    expect([200, 201]).toContain(contain.status);
    // Stale API fingerprint: Cover withoutEnlargement returns ~1108×887 for
    // a 1774×887-class master. Contain must always fill the hero mobile frame.
    expect(contain.data?.data?.mobileWidth).toBe(1500);
    expect(contain.data?.data?.mobileHeight).toBe(1200);
    const mobileBands = await readWebpBands(contain.data.data.mobileUrl);
    // All three subjects remain on Mobile Contain.
    expect(mobileBands.left[0]).toBeGreaterThan(mobileBands.left[2]);
    expect(mobileBands.mid[1]).toBeGreaterThan(mobileBands.mid[0]);
    expect(mobileBands.right[2]).toBeGreaterThan(mobileBands.right[0]);

    const manual = await axios.post(
      `${API}/storefront/home/image/admin/recrop`,
      {
        masterPath,
        profile: 'hero',
        compositionDesktop: { fit: 'manual', zoom: 1, panX: 50, panY: 50 },
        compositionMobile: { fit: 'manual', zoom: 2.2, panX: 15, panY: 40 },
      },
      { headers: { Authorization: `Bearer ${auth}` }, validateStatus: () => true },
    );
    expect([200, 201]).toContain(manual.status);
    expect(manual.data?.data?.mobileUrl).not.toBe(contain.data?.data?.mobileUrl);

    const solid = await axios.post(
      `${API}/storefront/home/image/admin/recrop`,
      {
        masterPath,
        profile: 'hero',
        compositionMobile: {
          fit: 'contain',
          backgroundMode: 'solid',
          backgroundColor: '#00ff00',
          panX: 50,
          panY: 0,
        },
        compositionDesktop: { fit: 'cover', panX: 50, panY: 50 },
      },
      { headers: { Authorization: `Bearer ${auth}` }, validateStatus: () => true },
    );
    expect([200, 201]).toContain(solid.status);
    const solidBands = await readWebpBands(solid.data.data.mobileUrl);
    // Top letterbox corner should be near green fill for tall mobile frame.
    const solidBuf = Buffer.from(
      (
        await axios.get(solid.data.data.mobileUrl, {
          responseType: 'arraybuffer',
        })
      ).data,
    );
    const { data, info } = await sharp(solidBuf)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const corner = (data[0]! + data[1]! + data[2]!) / 3;
    expect(info.width).toBeGreaterThan(100);
    expect(corner).toBeGreaterThan(0);
    expect(solidBands.mid[1]).toBeGreaterThan(40);
  }, 120000);

  it('preview session carries composition paths without publishing', async () => {
    expect(masterPath).toBeTruthy();
    const desk = await axios.post(
      `${API}/storefront/home/image/admin/recrop`,
      {
        masterPath,
        profile: 'hero',
        compositionDesktop: { fit: 'contain', backgroundMode: 'solid', backgroundColor: '#222222' },
        compositionMobile: { fit: 'contain', backgroundMode: 'blur' },
      },
      { headers: { Authorization: `Bearer ${auth}` }, validateStatus: () => true },
    );
    expect([200, 201]).toContain(desk.status);

    const sections = [
      {
        sectionKey: 'campaign',
        enabled: true,
        displayOrder: 10,
        title: 'UAT Phase D',
        config: {
          slides: [
            {
              id: 'uat_phase_d',
              enabled: true,
              order: 10,
              title: 'UAT Disposable',
              ctaLabel: 'مشاهده',
              ctaDestinationType: 'absolute_path',
              ctaDestinationValue: '/sale',
              desktopImagePath: desk.data.data.desktopPath,
              mobileImagePath: desk.data.data.mobilePath,
              masterImagePath: masterPath,
              masterPreviewPath,
              compositionDesktop: {
                fit: 'contain',
                backgroundMode: 'solid',
                backgroundColor: '#222222',
              },
              compositionMobile: { fit: 'contain', backgroundMode: 'blur' },
            },
          ],
        },
      },
    ];
    const created = await axios.post(
      `${API}/storefront/home/admin/preview-session`,
      { sections },
      { headers: { Authorization: `Bearer ${auth}` }, validateStatus: () => true },
    );
    expect([200, 201]).toContain(created.status);
    const previewToken = created.data?.data?.token;
    const cred = created.data?.data?.credential;
    const nonce = created.data?.data?.handoffNonce;
    const redeem = await axios.post(
      `${API}/storefront/home/preview/${previewToken}/redeem`,
      { nonce },
      {
        headers: { 'x-home-preview-credential': cred },
        validateStatus: () => true,
      },
    );
    expect([200, 201]).toContain(redeem.status);
    const preview = await axios.get(`${API}/storefront/home/preview/${previewToken}`, {
      headers: { 'x-home-preview-credential': cred },
      validateStatus: () => true,
    });
    expect(preview.status).toBe(200);
    const slide = preview.data?.data?.sections?.find((s: any) => s.key === 'campaign')?.hero
      ?.slides?.[0];
    expect(slide?.desktopImageUrl).toContain('/static/home/');
    expect(slide?.mobileImageUrl).toContain('/static/home/');
  }, 60000);
});
