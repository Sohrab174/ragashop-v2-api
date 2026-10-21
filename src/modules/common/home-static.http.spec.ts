import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorService } from '../../error/error.service';
import { CommonController } from './common.controller';
import {
  HOME_DRAFT_ASSET_QUERY,
  signHomeDraftAssetToken,
} from '../storefront-home/home-draft-asset-access';
import { HomeImageAccessService } from '../storefront-home/home-image-access.service';

const SECRET = 'unit-home-static-http-secret';
const DRAFT_FILE = 'draft-unpublished.webp';
const PUBLISHED_FILE = 'published-live.webp';

function mockRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    headers,
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    type: jest.fn().mockReturnThis(),
    sendFile: jest.fn().mockReturnValue('sent'),
  };
  return res;
}

function buildAccess(options?: {
  published?: Set<string>;
}): HomeImageAccessService {
  const published = options?.published ?? new Set<string>();
  const sectionRepo = {
    find: jest.fn(async () =>
      [...published].map((logicalPath) => ({
        sectionKey: 'campaign',
        configJson: JSON.stringify({ desktopImagePath: logicalPath }),
      })),
    ),
  };
  const instanceRepo = {
    find: jest.fn(async () => []),
  };
  const config = {
    auth: { secret: SECRET },
    app: { apiBaseUrl: 'http://127.0.0.1:9010' },
  };
  const access = new HomeImageAccessService(
    config as any,
    sectionRepo as any,
    instanceRepo as any,
  );
  return access;
}

function buildController(access: HomeImageAccessService) {
  return new CommonController(
    new ErrorService(),
    { app: { apiBaseUrl: 'http://127.0.0.1:9010' } } as any,
    {} as any,
    access,
  );
}

describe('GET /static/home/:filename (controller HTTP contract)', () => {
  it('denies unpublished asset without token', async () => {
    const controller = buildController(buildAccess());
    const res = mockRes();
    await expect(
      controller.seeUploadedFile('home', DRAFT_FILE, undefined, res),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('serves unpublished asset with valid signed draft token (private cache)', async () => {
    const access = buildAccess();
    const controller = buildController(access);
    const token = signHomeDraftAssetToken(`/home/${DRAFT_FILE}`, SECRET, 600);
    const res = mockRes();

    const result = await controller.seeUploadedFile(
      'home',
      DRAFT_FILE,
      token,
      res,
    );

    expect(result).toBe('sent');
    expect(res.sendFile).toHaveBeenCalledWith(`home/${DRAFT_FILE}`, {
      root: './uploads',
    });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.type).toHaveBeenCalledWith('image/webp');
  });

  it('denies expired draft token', async () => {
    const controller = buildController(buildAccess());
    const now = 1_700_000_000_000;
    const token = signHomeDraftAssetToken(
      `/home/${DRAFT_FILE}`,
      SECRET,
      60,
      now,
    );
    jest.spyOn(Date, 'now').mockReturnValue(now + 120_000);
    const res = mockRes();
    await expect(
      controller.seeUploadedFile('home', DRAFT_FILE, token, res),
    ).rejects.toBeInstanceOf(HttpException);
    expect(res.sendFile).not.toHaveBeenCalled();
    (Date.now as jest.Mock).mockRestore();
  });

  it('denies tampered draft token', async () => {
    const controller = buildController(buildAccess());
    const token = signHomeDraftAssetToken(`/home/${DRAFT_FILE}`, SECRET, 600);
    const [body] = token.split('.');
    const res = mockRes();
    await expect(
      controller.seeUploadedFile(
        'home',
        DRAFT_FILE,
        `${body}.tamperedsignature`,
        res,
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('denies draft token bound to a different path', async () => {
    const controller = buildController(buildAccess());
    const token = signHomeDraftAssetToken('/home/other-file.webp', SECRET, 600);
    const res = mockRes();
    await expect(
      controller.seeUploadedFile('home', DRAFT_FILE, token, res),
    ).rejects.toBeInstanceOf(HttpException);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('serves published live image publicly without token', async () => {
    const access = buildAccess({
      published: new Set([`/home/${PUBLISHED_FILE}`]),
    });
    const controller = buildController(access);
    const res = mockRes();

    const result = await controller.seeUploadedFile(
      'home',
      PUBLISHED_FILE,
      undefined,
      res,
    );

    expect(result).toBe('sent');
    expect(res.sendFile).toHaveBeenCalledWith(`home/${PUBLISHED_FILE}`, {
      root: './uploads',
    });
    expect(res.headers['Cache-Control']).toBe('public, max-age=86400');
  });

  it('rejects path traversal in filename', async () => {
    const controller = buildController(buildAccess());
    const res = mockRes();
    await expect(
      controller.seeUploadedFile('home', '../secret.webp', undefined, res),
    ).rejects.toBeInstanceOf(HttpException);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('rejects path traversal in folder param and home-masters', async () => {
    const controller = buildController(buildAccess());
    const res = mockRes();
    await expect(
      controller.seeUploadedFile('home/..', 'x.webp', undefined, res),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      controller.seeUploadedFile('home-masters', 'master.webp', undefined, res),
    ).rejects.toBeInstanceOf(HttpException);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('exposes the draft query param name as hda', () => {
    expect(HOME_DRAFT_ASSET_QUERY).toBe('hda');
  });
});
