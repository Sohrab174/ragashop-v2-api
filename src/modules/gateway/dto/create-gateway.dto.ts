import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { GatewayNames, GatewayStatus } from '../entities/gateway.entity';

export class CreateGatewayDto {
  @ApiProperty({ required: true, enum: GatewayNames })
  @IsNotEmpty()
  @IsIn(Object.values(GatewayNames))
  name: GatewayNames;

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
