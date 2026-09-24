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

export class UpsertStorefrontHomeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertHomeSectionDto)
  sections: UpsertHomeSectionDto[];
}

export const HOME_SECTION_KEY_ENUM = STOREFRONT_HOME_SECTION_KEYS;
