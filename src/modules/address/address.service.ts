import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ErrorService } from '../../error/error.service';
import { AddressEntity } from './entities/address.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UserEntity } from '../user/entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(AddressEntity)
    private addressRepository: Repository<AddressEntity>,

    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /addresses/me
   */
  async add(dto: CreateAddressDto, customerId: number) {
    const oldCountAddress = await this.addressRepository.count({
      customerId,
      isDeleted: false,
    });

    // force default if there is any address
    if (!dto.isDefault && oldCountAddress === 0) {
      dto.isDefault = true;
    }

    // Creating a new address
    const { identifiers } = await this.addressRepository
      .createQueryBuilder()
      .insert()
      .values({
        ...dto,
        customerId,
        createdAt: new Date(),
      })
      .execute();

    const newAddressId = identifiers[0].id;

    // Set not default others except self
    if (dto.isDefault && oldCountAddress > 0) {
      await this.addressRepository
        .createQueryBuilder()
        .update()
        .set({ isDefault: false })
        .where('id != :defaultId', { defaultId: newAddressId })
        .andWhere({ customerId, isDeleted: false })
        .execute();
    }

    return { id: newAddressId };
  }

  /**
   * -------------------------------------------------------
   * PUT /addresses/me
   */
  async update(dto: UpdateAddressDto, customerId: number = null) {
    const address = await this.addressRepository.findOne({
      id: dto.id,
      isDeleted: false,
      ...(customerId && { customerId }),
    });
    if (!address) {
      this.error.unprocessableEntity(['آدرس مورد نظر یافت نشد']);
    }

    // force default if there is only one address
    if (address.isDefault && !dto.isDefault) {
      dto.isDefault = true;
    }

    await this.addressRepository
      .createQueryBuilder()
      .update()
      .set(dto)
      .where({ id: address.id })
      .execute();

    // Set not default others
    if (!address.isDefault && dto.isDefault) {
      await this.addressRepository
        .createQueryBuilder()
        .update()
        .set({ isDefault: false })
        .where('id != :defaultId', { defaultId: address.id })
        .andWhere({ customerId: address.customerId, isDeleted: false })
        .execute();
    }

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /addresses/:id/me
   */
  async delete(id: number, user: UserEntity) {
    const address = await this.addressRepository.findOne({
      where: { id, customerId: user.id },
    });

    if (!address) {
      this.error.unprocessableEntity(['آدرس مورد نظر یافت نشد']);
    }

    if (address.isDefault) {
      this.error.unprocessableEntity([
        'امکان حذف آدرس پیشفرض وجود ندارد، لطفا ابتدا آدرس دیگری را پیشفرض نمایید.',
      ]);
    }

    address.isDeleted = true;
    await address.save();

    return true;
  }

  /**
   * -------------------------------------------------------
   */
  async getRecordById(
    id: number,
    customerId = null,
    select = null,
    relations = null,
  ) {
    return await this.addressRepository.findOne({
      where: {
        id,
        isDeleted: false,
        ...(customerId && { customerId }),
      },
      ...(select && { select }),
      ...(relations && { relations }),
    });
  }
}
