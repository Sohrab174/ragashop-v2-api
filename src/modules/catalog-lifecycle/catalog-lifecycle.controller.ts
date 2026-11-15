import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { UserRoles } from '../user/entities/user.entity';
import { successfulResult } from '../../utils';
import { CatalogRefreshExecutorService } from './catalog-refresh-executor.service';
import { CatalogRefreshRunDto } from './dto/catalog-refresh-run.dto';
import { ShowcasePilotRefreshDto } from './dto/showcase-pilot-refresh.dto';
import { ShowcasePilotRefreshService } from './showcase-pilot-refresh.service';
import { DiscountEngineRunDto } from './dto/discount-engine-run.dto';
import { DiscountEngineService } from './discount-engine.service';

@ApiTags('Catalog Lifecycle')
@ApiBearerAuth()
@Controller()
export class CatalogLifecycleController {
  constructor(
    private readonly executor: CatalogRefreshExecutorService,
    private readonly showcasePilot: ShowcasePilotRefreshService,
    private readonly discountEngine: DiscountEngineService,
  ) {}

  /**
   * Operator-triggered curated catalog refresh plan / bounded enqueue.
   * Default dryRun=true. Live enqueue requires CATALOG_REFRESH_LIVE_ENABLED.
   */
  @Post('catalog-lifecycle/refresh/admin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @UsePipes(
    new ValidationPipe({
      errorHttpStatusCode: 422,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async runRefresh(@Body() dto: CatalogRefreshRunDto) {
    const dryRun = dto.dryRun !== false && dto.mode !== 'live';
    const report = await this.executor.execute({
      mode: dryRun ? 'dry_run' : 'live',
      maxItems: dto.maxItems,
      source: dto.source,
      afterProductId: dto.afterProductId,
    });
    return successfulResult([], report);
  }

  /**
   * Local Phase-1 targeted showcase pilot: explicit product ID allowlist (≤40).
   * Default dry-run. Live enqueue requires SHOWCASE_PILOT_LIVE_ENABLED=true.
   * Does not change curated membership or global scheduler config.
   */
  @Post('catalog-lifecycle/showcase-pilot/refresh/admin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @UsePipes(
    new ValidationPipe({
      errorHttpStatusCode: 422,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async runShowcasePilot(@Body() dto: ShowcasePilotRefreshDto) {
    const dryRun = dto.dryRun !== false && dto.mode !== 'live';
    const report = await this.showcasePilot.execute({
      mode: dryRun ? 'dry_run' : 'live',
      productIds: dto.productIds,
    });
    return successfulResult([], report);
  }

  /**
   * Daily discount discovery/verification engine.
   * Default dry-run. Live PDP requires DISCOUNT_ENGINE_LIVE_ENABLED=true.
   * Does not activate global crawler cron.
   */
  @Post('catalog-lifecycle/discount-engine/run/admin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @UsePipes(
    new ValidationPipe({
      errorHttpStatusCode: 422,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async runDiscountEngine(@Body() dto: DiscountEngineRunDto) {
    const dryRun = dto.dryRun !== false && dto.mode !== 'live';
    const report = await this.discountEngine.execute({
      mode: dryRun ? 'dry_run' : 'live',
      liveListing: dto.liveListing === true,
    });
    return successfulResult([], report);
  }
}
