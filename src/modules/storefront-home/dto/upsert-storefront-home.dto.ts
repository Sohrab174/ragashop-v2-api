import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { STOREFRONT_HOME_SECTION_KEYS } from '../storefront-home.types';

export class UpsertHomeSectionDto {
  @IsString()
  @MaxLength(64)
  sectionKey: string;

  @IsBoolean()
  enabled: boolean;

  @IsInt()
  displayOrder: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subtitle?: string | null;

  /** Opaque JSON object — validated per sectionKey in service. */
  @IsOptional()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  endAt?: string | null;
}

export class UpsertHomeInstanceDto {
  @IsString()
  @MaxLength(64)
  instanceKey: string;

  @IsString()
  @MaxLength(32)
  sectionType: string;

  @IsBoolean()
  enabled: boolean;

  @IsInt()
  displayOrder: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subtitle?: string | null;

  @IsOptional()
  config?: Record<string, unknown>;
}

export class UpsertStorefrontHomeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertHomeSectionDto)
  sections: UpsertHomeSectionDto[];

  /**
   * On PUT /admin, present (even empty) publishes the arrangement in the same
   * transaction as `sections`. Omitted leaves the published arrangement untouched.
   * Preview session routes do not persist this field.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertHomeInstanceDto)
  instances?: UpsertHomeInstanceDto[];
}

export class PublishHomeArrangementDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertHomeInstanceDto)
  instances: UpsertHomeInstanceDto[];
}

export const HOME_SECTION_KEY_ENUM = STOREFRONT_HOME_SECTION_KEYS;
