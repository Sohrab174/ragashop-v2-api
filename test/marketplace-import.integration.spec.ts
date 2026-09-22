import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import * as request from 'supertest';
import { MarketplaceImportController } from '../src/modules/marketplace-import/marketplace-import.controller';
import { MarketplaceImportService } from '../src/modules/marketplace-import/marketplace-import.service';
import { MarketplaceImportJobStatus } from '../src/modules/marketplace-import/marketplace-import-job.types';

describe('Marketplace import endpoint (integration)', () => {
  let app: INestApplication;
  const importFromUrl = jest.fn();
  const getJobStatus = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MarketplaceImportController],
      providers: [
        {
          provide: MarketplaceImportService,
          useValue: { importFromUrl, getJobStatus },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use('/marketplace-imports', bodyParser.json({ limit: '8kb' }));
    app.useGlobalPipes(
      new ValidationPipe({
        errorHttpStatusCode: 422,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    importFromUrl.mockReset();
    getJobStatus.mockReset();
    importFromUrl.mockResolvedValue({
      kind: 'product',
      id: 1,
      name: 'Test Product',
    });
  });

  it('POST /marketplace-imports returns product for fast path', async () => {
    const response = await request(app.getHttpServer())
      .post('/marketplace-imports')
      .send({
        url: 'https://www.trendyol.com/brand/sample-p-1234567',
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ id: 1, name: 'Test Product' });
    expect(importFromUrl).toHaveBeenCalled();
  });

  it('POST /marketplace-imports returns 202 for queued job', async () => {
    importFromUrl.mockResolvedValue({
      kind: 'job',
      job: {
        jobId: 99,
        accessToken: 'secret-token',
        status: MarketplaceImportJobStatus.queued,
      },
    });

    const response = await request(app.getHttpServer())
      .post('/marketplace-imports')
      .send({
        url: 'https://www.trendyol.com/brand/sample-p-1234567',
      })
      .expect(202);

    expect(response.body.data).toEqual({
      jobId: 99,
      accessToken: 'secret-token',
      status: MarketplaceImportJobStatus.queued,
    });
  });

  it('GET /marketplace-imports/:jobId returns safe status', async () => {
    getJobStatus.mockResolvedValue({
      jobId: 99,
      status: MarketplaceImportJobStatus.succeeded,
      productId: 1,
      productName: 'Done',
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    });

    const response = await request(app.getHttpServer())
      .get('/marketplace-imports/99')
      .set('X-RagaShop-Import-Token', 'secret-token-value-1234')
      .expect(200);

    expect(response.body.data.productId).toBe(1);
    expect(getJobStatus).toHaveBeenCalledWith(99, 'secret-token-value-1234');
  });

  it('GET /marketplace-imports/:jobId rejects query-string tokens', async () => {
    await request(app.getHttpServer())
      .get('/marketplace-imports/99')
      .query({ token: 'secret-token-value-1234' })
      .expect(404);

    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it('POST rejects malformed body', async () => {
    await request(app.getHttpServer())
      .post('/marketplace-imports')
      .send({ url: 'not-a-url' })
      .expect(422);

    expect(importFromUrl).not.toHaveBeenCalled();
  });

  it('POST rejects injected pricing fields', async () => {
    await request(app.getHttpServer())
      .post('/marketplace-imports')
      .send({
        url: 'https://www.trendyol.com/brand/sample-p-1234567',
        price: 1,
        exchangeRate: 99999,
        margin: 100,
      })
      .expect(422);

    expect(importFromUrl).not.toHaveBeenCalled();
  });

  it('rejects oversized marketplace-import body with 413', async () => {
    const oversized = JSON.stringify({
      url: `https://www.trendyol.com/brand/sample-p-1234567?x=${'a'.repeat(
        12000,
      )}`,
    });

    await request(app.getHttpServer())
      .post('/marketplace-imports')
      .set('Content-Type', 'application/json')
      .send(oversized)
      .expect(413);

    expect(importFromUrl).not.toHaveBeenCalled();
  });

  it('GET /products/link is disabled', async () => {
    const response = await request(app.getHttpServer())
      .get('/products/link')
      .query({ link: 'https://www.trendyol.com/brand/sample-p-1234567' })
      .expect(410);

    expect(response.body.success).toBe(false);
    expect(importFromUrl).not.toHaveBeenCalled();
  });
});
