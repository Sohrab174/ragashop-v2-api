import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class DiscountEngineRunDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsIn(['dry_run', 'live'])
  mode?: 'dry_run' | 'live';

  /** Dry-run listing probes only (no PDP). */
  @IsOptional()
  @IsBoolean()
  liveListing?: boolean;
}
