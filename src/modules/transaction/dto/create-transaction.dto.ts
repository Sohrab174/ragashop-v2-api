import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class CreateTransactionDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  orderId: number;

  @ApiProperty({ required: true })
  @IsNotEmpty()
  gatewayId: number;
}
