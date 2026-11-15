import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import { SHOWCASE_PILOT_MAX_IDS } from '../showcase-pilot.constants';

export class ShowcasePilotRefreshDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = true;

  @IsOptional()
  @IsIn(['dry_run', 'live'])
  mode?: 'dry_run' | 'live';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SHOWCASE_PILOT_MAX_IDS)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds?: number[];
}
