import {
  BadRequestException,
  CanActivate,
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ErrorsInterceptor } from './errors.interceptor';
import { BadRequestExceptionFilter } from '../exceptions/bad-request.exceptions';
import { UnauthorizedExceptionFilter } from '../exceptions/unauthorized-request.exceptions';
import { UnprocessableEntityExceptionFilter } from '../exceptions/unprocessable-entity.exceptions';
import { ErrorService } from '../../error/error.service';
import { CatalogController } from '../../modules/catalog/catalog.controller';
import { CatalogService } from '../../modules/catalog/catalog.service';
import { SearchService } from '../../modules/search/search.service';
import { CatMapV2cAdminService } from '../../modules/catalog/cat-map-v2c-admin.service';
import { AssortmentPolicyAdminService } from '../../modules/catalog/assortment-policy/assortment-policy.admin.service';
import { AssortmentPolicySnapshotService } from '../../modules/catalog/assortment-policy/assortment-policy-snapshot.service';
import { AssortmentPolicyRecomputeService } from '../../modules/catalog/assortment-policy/assortment-policy.recompute.service';
import { AssortmentCommerceService } from '../../modules/catalog/assortment-policy/assortment-commerce.service';
import { JwtAuthGuard } from '../../modules/auth/jwt/jwt.guard';
import { RolesGuard } from '../../modules/auth/role/role.guard';
import { PermissionsGuard } from '../../modules/auth/capability/permissions.guard';

const CONFIRM_MESSAGE = 'این نگاشت پرتأثیر است؛ تأیید صریح لازم است.';

class StructuredBadRequestGuard implements CanActivate {
  canActivate(): boolean {
    throw new BadRequestException({
      message: 'guard structured',
      code: 'guard_blocked',
      details: { reason: 'test' },
    });
  }
}

@Controller('contract')
class ErrorContractTestController {
  private readonly errors = new ErrorService();

  @Get('plain')
  plain() {
    throw new BadRequestException('پیام ساده');
  }

  @Get('validation-array')
  validationArray() {
    throw new BadRequestException([
      'name must be a string',
      'age must be a number',
    ]);
  }

  @Get('object')
  object() {
    throw new BadRequestException({ message: 'پیام شیء' });
  }

  @Get('structured')
  structured() {
    throw new BadRequestException({
      message: CONFIRM_MESSAGE,
      code: 'confirm_required',
      details: {
        impactProductCount: 5929,
        threshold: 500,
        confirmImpactRequired: true,
      },
    });
  }

  @Get('structured-unsafe')
  structuredUnsafe() {
    throw new BadRequestException({
      message: 'x',
      code: 'confirm_required',
      details: {
        impactProductCount: 1,
        nested: { sql: 'SELECT * FROM user' },
        stack: 'Error: at internal.js:1',
        sqlQuery: 'SELECT 1',
        accessToken: 'secret',
        list: [1, 2],
        notFinite: Infinity,
      },
      internal: { password: 'p' },
      stack: 'Error: top-level stack',
    });
  }

  @Get('structured-bad-code')
  structuredBadCode() {
    throw new BadRequestException({
      message: 'x',
      code: "'; DROP TABLE product; --",
      details: { a: 1 },
    });
  }

  @Get('guard-structured')
  @UseGuards(StructuredBadRequestGuard)
  guardStructured() {
    return { ok: true };
  }

  @Get('unauthorized')
  unauthorized() {
    throw new UnauthorizedException();
  }

  @Get('forbidden')
  forbidden() {
    throw new ForbiddenException();
  }

  @Get('forbidden-service')
  forbiddenService() {
    this.errors.forbidden(['دسترسی ندارید']);
  }

  @Get('not-found')
  notFound() {
    throw new NotFoundException('missing');
  }

  @Get('unprocessable-service')
  unprocessableService() {
    this.errors.unprocessableEntity(['نامعتبر'], { field: 'x' });
  }

  @Get('boom')
  boom() {
    throw Object.assign(
      new Error('ER_PARSE_ERROR near SELECT * FROM secret_table'),
      { sql: 'SELECT * FROM secret_table', code: 'ER_PARSE_ERROR' },
    );
  }

  @Get('structured-500')
  structured500() {
    throw new InternalServerErrorException({
      message: 'internal detail',
      code: 'db_down',
      details: { host: 'db.internal' },
    });
  }
}

function applyMainFilters(app: INestApplication) {
  app.useGlobalFilters(new UnprocessableEntityExceptionFilter());
  app.useGlobalFilters(new BadRequestExceptionFilter());
  app.useGlobalFilters(new UnauthorizedExceptionFilter());
}

describe('HTTP error contract (ErrorsInterceptor + global filters)', () => {
  let app: INestApplication;
  let consoleError: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ErrorContractTestController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ErrorsInterceptor }],
    }).compile();
    app = moduleRef.createNestApplication();
    applyMainFilters(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('structured BadRequest → 400 with code + details in data', async () => {
    const res = await request(app.getHttpServer()).get('/contract/structured');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      messages: [CONFIRM_MESSAGE],
      data: {
        code: 'confirm_required',
        details: {
          impactProductCount: 5929,
          threshold: 500,
          confirmImpactRequired: true,
        },
      },
    });
  });

  it('plain string BadRequest → 400, existing message behavior unchanged', async () => {
    const res = await request(app.getHttpServer()).get('/contract/plain');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      messages: ['Bad Request'],
      data: {},
    });
  });

  it('string[] validation BadRequest → 400 with all messages', async () => {
    const res = await request(app.getHttpServer()).get(
      '/contract/validation-array',
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      messages: ['name must be a string', 'age must be a number'],
      data: {},
    });
  });

  it('object-form BadRequest without code → 400 with its message, empty data', async () => {
    const res = await request(app.getHttpServer()).get('/contract/object');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      messages: ['پیام شیء'],
      data: {},
    });
  });

  it('drops nested / unsafe / non-primitive details and extra top-level fields', async () => {
    const res = await request(app.getHttpServer()).get(
      '/contract/structured-unsafe',
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      messages: ['x'],
      data: { code: 'confirm_required', details: { impactProductCount: 1 } },
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/SELECT|stack|password|secret|internal/i);
  });

  it('rejects codes outside the safe identifier pattern', async () => {
    const res = await request(app.getHttpServer()).get(
      '/contract/structured-bad-code',
    );
    expect(res.status).toBe(400);
    expect(res.body.data).toEqual({});
  });

  it('structured BadRequest thrown by a guard keeps code via BadRequestExceptionFilter', async () => {
    const res = await request(app.getHttpServer()).get(
      '/contract/guard-structured',
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      messages: ['guard structured'],
      data: { code: 'guard_blocked', details: { reason: 'test' } },
    });
  });

  it('Unauthorized stays 401', async () => {
    const res = await request(app.getHttpServer()).get(
      '/contract/unauthorized',
    );
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toEqual({});
  });

  it('Forbidden stays 403 (Nest exception and ErrorService)', async () => {
    const a = await request(app.getHttpServer()).get('/contract/forbidden');
    expect(a.status).toBe(403);
    expect(a.body).toEqual({ success: false, messages: ['Error'], data: {} });

    const b = await request(app.getHttpServer()).get(
      '/contract/forbidden-service',
    );
    expect(b.status).toBe(403);
    expect(b.body).toEqual({
      success: false,
      messages: ['دسترسی ندارید'],
      data: {},
    });
  });

  it('NotFound stays 404', async () => {
    const res = await request(app.getHttpServer()).get('/contract/not-found');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      messages: ['Not Found'],
      data: {},
    });
  });

  it('ErrorService 422 envelope passes through unchanged', async () => {
    const res = await request(app.getHttpServer()).get(
      '/contract/unprocessable-service',
    );
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      messages: ['نامعتبر'],
      data: { field: 'x' },
    });
  });

  describe('unexpected errors stay 500 without leaking internals', () => {
    const prevEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = prevEnv;
    });

    it('plain Error → 500; production hides message; never exposes sql/stack/code', async () => {
      process.env.NODE_ENV = 'production';
      const res = await request(app.getHttpServer()).get('/contract/boom');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        messages: ['Internal Server Error'],
        data: {},
      });
    });

    it('plain Error in non-production → 500 with data {} and no sql/stack fields', async () => {
      process.env.NODE_ENV = 'development';
      const res = await request(app.getHttpServer()).get('/contract/boom');
      expect(res.status).toBe(500);
      expect(res.body.data).toEqual({});
      expect(Object.keys(res.body).sort()).toEqual([
        'data',
        'messages',
        'success',
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(
        /"sql"|stack|ER_PARSE_ERROR"/,
      );
    });

    it('object-form 5xx HttpException is not reclassified as 4xx and drops code/details', async () => {
      process.env.NODE_ENV = 'production';
      const res = await request(app.getHttpServer()).get(
        '/contract/structured-500',
      );
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        messages: ['Internal Server Error'],
        data: {},
      });
    });
  });
});

describe('V2-C high-impact endpoint HTTP contract (in-memory, no DB)', () => {
  let app: INestApplication;
  let repo: { save: jest.Mock };
  let transaction: jest.Mock;
  const prevThreshold = process.env.MAPPING_HIGH_IMPACT_THRESHOLD;

  function makeAdminService() {
    const existing: any[] = [];
    repo = {
      save: jest.fn(async (row: any) => ({
        ...row,
        id: 900 + repo.save.mock.calls.length,
      })),
    } as any;
    const txRepo = {
      findOne: jest.fn(async () => undefined),
      find: jest.fn(async () => [...existing]),
      create: jest.fn((row: any) => ({ ...row, id: undefined })),
      save: repo.save,
    };
    const manager: any = { getRepository: () => txRepo };
    transaction = jest.fn(async (fn: any) => fn(manager));
    manager.transaction = transaction;

    const mappingRepository = {
      find: jest.fn(async () => [...existing]),
      findOne: txRepo.findOne,
      manager,
      create: txRepo.create,
      save: repo.save,
    };
    const categoryRepository = {
      findOne: jest.fn(async () => ({
        id: 17,
        source: 'trendyol',
        status: 'active',
      })),
      find: jest.fn(async () => [
        {
          id: 17,
          parentId: null,
          source: 'trendyol',
          status: 'active',
          name: 'T',
          displayOrder: 0,
        },
      ]),
    };
    const canonicalRepository = {
      find: jest.fn(async () => [
        {
          id: 1,
          parentId: null,
          name: 'زنانه',
          audience: 'female',
          status: 'active',
        },
        {
          id: 19,
          parentId: 1,
          name: 'تیشرت',
          audience: null,
          status: 'active',
        },
        {
          id: 6,
          parentId: null,
          name: 'مردانه',
          audience: 'male',
          status: 'active',
        },
        {
          id: 39,
          parentId: 6,
          name: 'تیشرت',
          audience: null,
          status: 'active',
        },
      ]),
    };
    const productQb: any = {
      select: () => productQb,
      addSelect: () => productQb,
      where: () => productQb,
      andWhere: () => productQb,
      groupBy: () => productQb,
      getRawMany: async () => [
        { gender: 'female', count: '10' },
        { gender: 'male', count: '8' },
      ],
      getCount: async () => 18,
    };
    return new CatMapV2cAdminService(
      canonicalRepository as any,
      mappingRepository as any,
      categoryRepository as any,
      { createQueryBuilder: () => productQb } as any,
      { find: async () => [] } as any,
    );
  }

  beforeAll(async () => {
    process.env.MAPPING_HIGH_IMPACT_THRESHOLD = '10';
    const allow = { canActivate: () => true } as CanActivate;
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: ErrorsInterceptor },
        { provide: CatalogService, useValue: {} },
        { provide: SearchService, useValue: {} },
        { provide: CatMapV2cAdminService, useFactory: makeAdminService },
        { provide: AssortmentPolicyAdminService, useValue: {} },
        { provide: AssortmentPolicySnapshotService, useValue: {} },
        { provide: AssortmentPolicyRecomputeService, useValue: {} },
        { provide: AssortmentCommerceService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(PermissionsGuard)
      .useValue(allow)
      .compile();
    app = moduleRef.createNestApplication();
    applyMainFilters(app);
    await app.init();
  });

  afterAll(async () => {
    if (prevThreshold === undefined)
      delete process.env.MAPPING_HIGH_IMPACT_THRESHOLD;
    else process.env.MAPPING_HIGH_IMPACT_THRESHOLD = prevThreshold;
    await app.close();
  });

  const rules = [
    { genderSlice: 'female', canonicalCategoryId: 19, status: 'active' },
    { genderSlice: 'male', canonicalCategoryId: 39, status: 'active' },
  ];

  it('without confirmImpact → 400 confirm_required with metadata; no write', async () => {
    repo.save.mockClear();
    transaction.mockClear();
    const res = await request(app.getHttpServer())
      .put('/catalog/mappings/source/17/admin')
      .send({ rules, confirmImpact: false });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.messages).toEqual([CONFIRM_MESSAGE]);
    expect(res.body.data).toEqual({
      code: 'confirm_required',
      details: {
        impactProductCount: 18,
        threshold: 10,
        confirmImpactRequired: true,
      },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('other V2 validation errors keep their code (audience_mismatch) as 400', async () => {
    const res = await request(app.getHttpServer())
      .put('/catalog/mappings/source/17/admin')
      .send({
        rules: [
          { genderSlice: 'female', canonicalCategoryId: 39, status: 'active' },
        ],
        confirmImpact: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.data.code).toBe('audience_mismatch');
    expect(res.body.data.details).toMatchObject({ slice: 'female' });
  });

  it('confirmImpact:true → 200 against in-memory repositories', async () => {
    repo.save.mockClear();
    const res = await request(app.getHttpServer())
      .put('/catalog/mappings/source/17/admin')
      .send({ rules, confirmImpact: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reviewStatus).toBe('reviewed_ok');
    expect(repo.save).toHaveBeenCalled();
  });
});
