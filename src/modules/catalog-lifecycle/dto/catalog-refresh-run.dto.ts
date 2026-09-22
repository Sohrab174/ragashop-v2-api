import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CatalogRefreshRunDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxItems?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterProductId?: number;

  @IsOptional()
  @IsIn(['dry_run', 'live'])
  mode?: 'dry_run' | 'live';
}
