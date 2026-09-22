import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';

function toStrictBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === '1' || value === 'true') {
    return true;
  }
  if (
    value === false ||
    value === 0 ||
    value === '0' ||
    value === 'false' ||
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return false;
  }
  return value as boolean;
}

export class CreateTransactionDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  orderId: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  gatewayId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => toStrictBoolean(value))
  @IsBoolean()
  usedWalletUSD?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => toStrictBoolean(value))
  @IsBoolean()
  usedWalletIRT?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => toStrictBoolean(value))
  @IsBoolean()
  usedWalletTRY?: boolean;
}
