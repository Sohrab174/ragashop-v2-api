import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { GatewayStatus } from '../entities/gateway.entity';

export class UpdateGatewayDto {
  @ApiProperty({ required: true })
  @IsNotEmpty()
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  username: string;

  @ApiProperty({ required: false })
  @IsOptional()
  password: string;

  @ApiProperty({ required: false })
  @IsOptional()
  merchantId: string;

  @ApiProperty({ required: true, enum: GatewayStatus })
  @IsNotEmpty()
  @IsIn(Object.values(GatewayStatus))
  status: GatewayStatus;
}
