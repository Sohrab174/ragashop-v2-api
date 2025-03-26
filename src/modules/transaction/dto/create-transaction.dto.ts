import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional } from 'class-validator';

export class CreateTransactionDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  orderId: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  gatewayId: number;

  @ApiProperty({ required: false })
  @IsOptional()
  usedWalletUSD: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  usedWalletIRT: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  usedWalletTRY: boolean;
}
