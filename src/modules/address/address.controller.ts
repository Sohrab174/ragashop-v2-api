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
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { Customer } from '../../utils/decorators/customer.decorator';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { CustomerJwtAuthGuard } from '../customer/jwt/jwt.guard';

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
  @UseGuards(CustomerJwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async add(
    @Body() dto: CreateAddressDto,
    @Customer() customer: CustomerEntity,
  ) {
    const newAddress = await this.addressService.add(dto, customer.id);
    return successfulResult(['آدرس جدید با موفقیت ثبت شد'], newAddress);
  }

  /**
   * -------------------------------------------------------
   * PUT /addresses/me
   */
  @Put('me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async update(
    @Body() dto: UpdateAddressDto,
    @Customer() customer: CustomerEntity,
  ) {
    await this.addressService.update(dto, customer.id);
    return successfulResult(['آدرس شما با موفقیت به روز شد']);
  }

  /**
   * -------------------------------------------------------
   * DELETE /addresses/:id/me
   */
  @Delete(':id/me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async delete(
    @Param('id') addressId: number,
    @Customer() customer: CustomerEntity,
  ) {
    await this.addressService.delete(addressId, customer);
    return successfulResult(['آدرس مورد نظر شما حذف شد']);
  }
}
