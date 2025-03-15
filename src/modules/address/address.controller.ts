import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Delete,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { User } from '../../utils/decorators/user.decorator';
import { UserEntity } from '../user/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@ApiTags('Address')
@Controller('addresses')
export class AddressController {
  constructor(private addressService: AddressService) {}

  /**
   * -------------------------------------------------------
   * POST /addresses/me
   */
  @Post('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: CreateAddressDto, @User() user: UserEntity) {
    const newAddress = await this.addressService.add(dto, user.id);
    return successfulResult(['آدرس جدید با موفقیت ثبت شد'], newAddress);
  }

  /**
   * -------------------------------------------------------
   * PUT /addresses/me
   */
  @Put('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async update(@Body() dto: UpdateAddressDto, @User() user: UserEntity) {
    await this.addressService.update(dto, user.id);
    return successfulResult(['آدرس شما با موفقیت به روز شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /addresses/:id/me
   */
  @Delete(':id/me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') addressId: number, @User() user: UserEntity) {
    await this.addressService.delete(addressId, user);
    return successfulResult(['آدرس مورد نظر شما حذف شد']);
  }
}
