import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ManualPaymentRail,
  PaymentRejectionReasonCode,
} from '../manual-payment.types';

export class CreateBankDestinationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  bankName: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  accountHolderName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  cardNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ enum: ManualPaymentRail, isArray: true })
  @IsArray()
  @IsEnum(ManualPaymentRail, { each: true })
  allowedRails: ManualPaymentRail[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instructions?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minAmountIrt?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxAmountIrt?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;
}

export class UpdateBankDestinationDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  accountHolderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  cardNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ManualPaymentRail, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ManualPaymentRail, { each: true })
  allowedRails?: ManualPaymentRail[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instructions?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minAmountIrt?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxAmountIrt?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;
}

export class UpdateManualPaymentMethodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id?: number;

  @ApiPropertyOptional({ enum: ManualPaymentRail })
  @IsOptional()
  @IsEnum(ManualPaymentRail)
  rail?: ManualPaymentRail;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerInstructions?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minAmountIrt?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxAmountIrt?: number | null;
}

export class ApprovePaymentSubmissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  amountMismatchOverrideReason?: string | null;
}

export class RejectPaymentSubmissionDto {
  @ApiProperty({ enum: PaymentRejectionReasonCode })
  @IsEnum(PaymentRejectionReasonCode)
  rejectionReasonCode: PaymentRejectionReasonCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  rejectionReasonText?: string | null;
}

export class CreatePaymentSubmissionBodyDto {
  @ApiProperty({ enum: ManualPaymentRail })
  @IsEnum(ManualPaymentRail)
  rail: ManualPaymentRail;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankDestinationId: number;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  submittedAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankReference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  payerName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  customerNote?: string | null;
}

export class ResubmitPaymentBodyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  submittedAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  bankReference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  payerName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  customerNote?: string | null;
}
