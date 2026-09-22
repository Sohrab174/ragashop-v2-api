import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Reflector } from '@nestjs/core';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { RolesGuard } from '../auth/role/role.guard';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { ErrorService } from '../../error/error.service';
import { UserCapabilityService } from '../manual-payment/user-capability.service';
import { UserRoles } from '../user/entities/user.entity';

type Actor =
  | { kind: 'none' }
  | { kind: 'customer' }
  | { kind: 'employee'; hasFxCapability: boolean }
  | { kind: 'admin' };

describe('FX mutation authorization (PUT /settings/try-to-rial)', () => {
  let app: INestApplication;
  let actor: Actor = { kind: 'none' };
  const settingService = {
    get: jest.fn().mockResolvedValue({ tryToRial: 35000 }),
    getByAdmin: jest.fn().mockResolvedValue({ tryToRial: 35000 }),
    update: jest.fn().mockResolvedValue(undefined),
    getTryToRial: jest.fn().mockResolvedValue(35000),
  };
  const capabilityService = {
    userHasCapability: jest.fn(),
  };

  class TestJwtGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      if (actor.kind === 'none') {
        throw new UnauthorizedException({
          success: false,
          messages: ['Unauthorized'],
          data: {},
        });
      }
      if (actor.kind === 'customer') {
        // Customer JWT is a different strategy; staff JwtAuthGuard rejects.
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
          actor.hasFxCapability &&
          capability === 'settings.fx_refresh'
        ) {
          return true;
        }
        return false;
      },
    );
  });

  it('allows public read of GET /settings', async () => {
    actor = { kind: 'none' };
    const res = await request(app.getHttpServer()).get('/settings');
    expect(res.status).toBe(200);
    expect(settingService.get).toHaveBeenCalled();
    expect(settingService.getTryToRial).not.toHaveBeenCalled();
  });

  it('denies unauthenticated FX mutation', async () => {
    actor = { kind: 'none' };
    const res = await request(app.getHttpServer()).put('/settings/try-to-rial');
    expect(res.status).toBe(401);
    expect(settingService.getTryToRial).not.toHaveBeenCalled();
  });

  it('denies customer token against FX mutation', async () => {
    actor = { kind: 'customer' };
    const res = await request(app.getHttpServer()).put('/settings/try-to-rial');
    expect(res.status).toBe(401);
    expect(settingService.getTryToRial).not.toHaveBeenCalled();
  });

  it('denies employee without settings.fx_refresh capability', async () => {
    actor = { kind: 'employee', hasFxCapability: false };
    const res = await request(app.getHttpServer()).put('/settings/try-to-rial');
    expect(res.status).toBe(403);
    expect(settingService.getTryToRial).not.toHaveBeenCalled();
  });

  it('allows admin FX mutation', async () => {
    actor = { kind: 'admin' };
    const res = await request(app.getHttpServer()).put('/settings/try-to-rial');
    expect(res.status).toBe(200);
    expect(settingService.getTryToRial).toHaveBeenCalled();
  });

  it('allows employee with settings.fx_refresh capability', async () => {
    actor = { kind: 'employee', hasFxCapability: true };
    const res = await request(app.getHttpServer()).put('/settings/try-to-rial');
    expect(res.status).toBe(200);
    expect(settingService.getTryToRial).toHaveBeenCalled();
  });
});
