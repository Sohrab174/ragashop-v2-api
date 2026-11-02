import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { ErrorService } from '../../error/error.service';
import { UserCapabilityService } from '../manual-payment/user-capability.service';
import { UserRoles } from '../user/entities/user.entity';
import { CAPABILITIES_KEY } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';

type Actor =
  | { kind: 'none' }
  | { kind: 'customer' }
  | { kind: 'employee'; hasWrite: boolean }
  | { kind: 'admin' };

describe('Settings bootstrap authorization (POST /settings/bootstrap)', () => {
  let app: INestApplication;
  let actor: Actor = { kind: 'none' };
  const settingService = {
    get: jest.fn().mockResolvedValue({}),
    getByAdmin: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue(undefined),
    getTryToRial: jest.fn().mockResolvedValue(35000),
    bootstrapApprovedSingleton: jest.fn().mockResolvedValue({
      outcome: 'created',
      storefrontReady: false,
      settingId: 1,
      tryToRial: null,
      message: 'ok',
      settingsCommitted: true,
      fxRecoveryRequired: true,
    }),
  };
  const capabilityService = {
    userHasCapability: jest.fn(),
  };

  class TestJwtGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      if (actor.kind === 'none' || actor.kind === 'customer') {
        throw new UnauthorizedException({
          success: false,
          messages: ['Unauthorized'],
          data: {},
        });
      }
      if (actor.kind === 'employee') {
        req.user = { id: 2, role: UserRoles.employee };
        return true;
      }
      req.user = { id: 1, role: UserRoles.admin };
      return true;
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SettingController],
      providers: [
        { provide: SettingService, useValue: settingService },
        { provide: UserCapabilityService, useValue: capabilityService },
        RolesGuard,
        PermissionsGuard,
        ErrorService,
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    actor = { kind: 'none' };
    capabilityService.userHasCapability.mockImplementation(
      async (user: { role: string }, capability: string) => {
        if (user.role === UserRoles.admin) {
          return true;
        }
        if (
          actor.kind === 'employee' &&
          actor.hasWrite &&
          capability === UserCapabilityName.settings_write
        ) {
          return true;
        }
        return false;
      },
    );
  });

  it('declares JWT + Roles + Permissions and settings.write capability', () => {
    const proto = SettingController.prototype as any;
    const caps = Reflect.getMetadata(
      CAPABILITIES_KEY,
      proto.bootstrapApprovedSingleton,
    );
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, proto.bootstrapApprovedSingleton) ||
      [];
    expect(caps).toEqual([UserCapabilityName.settings_write]);
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
    expect(guards).toContain(PermissionsGuard);
  });

  it('denies unauthenticated bootstrap', async () => {
    actor = { kind: 'none' };
    const res = await request(app.getHttpServer()).post('/settings/bootstrap');
    expect(res.status).toBe(401);
    expect(settingService.bootstrapApprovedSingleton).not.toHaveBeenCalled();
  });

  it('denies customer token', async () => {
    actor = { kind: 'customer' };
    const res = await request(app.getHttpServer()).post('/settings/bootstrap');
    expect(res.status).toBe(401);
    expect(settingService.bootstrapApprovedSingleton).not.toHaveBeenCalled();
  });

  it('denies employee without settings.write', async () => {
    actor = { kind: 'employee', hasWrite: false };
    const res = await request(app.getHttpServer()).post('/settings/bootstrap');
    expect(res.status).toBe(403);
    expect(settingService.bootstrapApprovedSingleton).not.toHaveBeenCalled();
  });

  it('allows admin bootstrap', async () => {
    actor = { kind: 'admin' };
    const res = await request(app.getHttpServer()).post('/settings/bootstrap');
    expect([200, 201]).toContain(res.status);
    expect(settingService.bootstrapApprovedSingleton).toHaveBeenCalled();
  });

  it('allows employee with settings.write', async () => {
    actor = { kind: 'employee', hasWrite: true };
    const res = await request(app.getHttpServer()).post('/settings/bootstrap');
    expect([200, 201]).toContain(res.status);
    expect(settingService.bootstrapApprovedSingleton).toHaveBeenCalled();
  });
});
