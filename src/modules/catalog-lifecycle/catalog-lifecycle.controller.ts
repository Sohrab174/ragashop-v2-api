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

@ApiTags('Catalog Lifecycle')
@ApiBearerAuth()
@Controller()
export class CatalogLifecycleController {
  constructor(private readonly executor: CatalogRefreshExecutorService) {}

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
}
