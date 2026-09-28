import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { AddressEntity } from './entities/address.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { CustomerEntity } from '../customer/entities/customer.entity';
import { CityEntity } from '../city/entities/city.entity';
import {
  AddressWrite,
  AddressWriteInput,
  buildAddressWrite,
} from './address-write';
import { CustomerAddressView, toAddressView } from './address-view';

@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(AddressEntity)
    private addressRepository: Repository<AddressEntity>,

    @InjectRepository(CityEntity)
    private cityRepository: Repository<CityEntity>,

    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /addresses/me
   */
  async listForCustomer(customerId: number): Promise<CustomerAddressView[]> {
    const rows = await this.addressRepository
      .createQueryBuilder('address')
      .leftJoinAndSelect('address.city', 'city')
      .leftJoinAndSelect('city.province', 'province')
      .where('address.customerId = :customerId', { customerId })
      .andWhere('address.isDeleted = 0')
      .orderBy('address.isDefault', 'DESC')
      .addOrderBy('address.id', 'DESC')
      .getMany();

    return rows.map((row) => toAddressView(row));
  }

  /**
   * -------------------------------------------------------
   * POST /addresses/me
   */
  async add(dto: CreateAddressDto, customerId: number) {
    this.assertCustomerScope(customerId);
    const write = await this.prepareWrite(dto, 'create');

    const oldCountAddress = await this.addressRepository.count({
      customerId,
      isDeleted: false,
    });

    if (!write.isDefault && oldCountAddress === 0) {
      write.isDefault = true;
    }

    const { identifiers } = await this.addressRepository
      .createQueryBuilder()
      .insert()
      .values({
        ...this.toPersistColumns(write),
        customerId,
        createdAt: new Date(),
      })
      .execute();

    const newAddressId = identifiers[0].id;

    if (write.isDefault && oldCountAddress > 0) {
      await this.clearOtherDefaults(customerId, newAddressId);
    }

    return this.getOwnedView(newAddressId, customerId);
  }

  /**
   * -------------------------------------------------------
   * PUT /addresses/me
   */
  async update(dto: UpdateAddressDto, customerId: number) {
    this.assertCustomerScope(customerId);
    const prepared = buildAddressWrite(dto, 'update');
    if (prepared.status === 'error' || prepared.id == null) {
      this.error.unprocessableEntity(
        [prepared.status === 'error' ? prepared.message : 'آدرس معتبر نیست'],
        {
          fields:
            prepared.status === 'error'
              ? prepared.fields
              : { id: 'آدرس معتبر نیست' },
        },
      );
    }

    const address = await this.addressRepository.findOne({
      id: prepared.id,
      isDeleted: false,
      customerId,
    });
    if (!address) {
      this.error.unprocessableEntity(['آدرس مورد نظر یافت نشد']);
    }

    const write = await this.prepareWrite(dto, 'update');

    if (address.isDefault && !write.isDefault) {
      write.isDefault = true;
    }

    await this.addressRepository
      .createQueryBuilder()
      .update()
      .set(this.toPersistColumns(write))
      .where({ id: address.id, customerId })
      .execute();

    if (!address.isDefault && write.isDefault) {
      await this.clearOtherDefaults(customerId, address.id);
    }

    return this.getOwnedView(address.id, customerId);
  }

  /**
   * -------------------------------------------------------
   * DELETE /addresses/:id/me
   * Soft-delete only. Orders keep their own delivery snapshot.
   */
  async delete(id: number, customer: CustomerEntity) {
    const addressId = Number(id);
    if (!Number.isInteger(addressId) || addressId < 1 || !customer?.id) {
      this.error.unprocessableEntity(['آدرس مورد نظر یافت نشد']);
    }

    const address = await this.addressRepository.findOne({
      where: { id: addressId, customerId: customer.id, isDeleted: false },
    });

    if (!address) {
      this.error.unprocessableEntity(['آدرس مورد نظر یافت نشد']);
    }

    if (address.isDefault) {
      const others = await this.addressRepository.count({
        customerId: customer.id,
        isDeleted: false,
        id: Not(address.id),
      });
      if (others > 0) {
        this.error.unprocessableEntity([
          'امکان حذف آدرس پیشفرض وجود ندارد، لطفا ابتدا آدرس دیگری را پیشفرض نمایید.',
        ]);
      }
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

  private assertCustomerScope(customerId: number): void {
    if (!Number.isInteger(Number(customerId)) || Number(customerId) < 1) {
      this.error.forbidden(['دسترسی مجاز نیست']);
    }
  }

  private async prepareWrite(
    dto: AddressWriteInput,
    intent: 'create' | 'update',
  ): Promise<AddressWrite> {
    const prepared = buildAddressWrite(dto, intent);
    if (prepared.status === 'error') {
      this.error.unprocessableEntity([prepared.message], {
        fields: prepared.fields,
      });
    }

    if (prepared.value.cityId != null) {
      const city = await this.cityRepository.findOne({
        where: { id: prepared.value.cityId },
      });
      if (!city) {
        this.error.unprocessableEntity(['شهر معتبر نیست'], {
          fields: { cityId: 'شهر معتبر نیست' },
        });
      }
    }

    return prepared.value;
  }

  /** Explicit column set. Never copies customerId, id, or order fields. */
  private toPersistColumns(write: AddressWrite): Partial<AddressEntity> {
    const columns: Partial<AddressEntity> = {
      title: write.title,
      address: write.address,
      details: write.details,
      postalCode: write.postalCode,
      phone: write.phone,
      cityId: write.cityId,
      isDefault: write.isDefault,
    };
    if (write.includeRecipient) {
      columns.recipientFirstName = write.recipientFirstName;
      columns.recipientLastName = write.recipientLastName;
    }
    if (write.geo?.include) {
      columns.latitude = write.geo.latitude;
      columns.longitude = write.geo.longitude;
      columns.location = write.geo.location;
    }
    return columns;
  }

  private async clearOtherDefaults(customerId: number, defaultId: number) {
    await this.addressRepository
      .createQueryBuilder()
      .update()
      .set({ isDefault: false })
      .where('id != :defaultId', { defaultId })
      .andWhere({ customerId, isDeleted: false })
      .execute();
  }

  private async getOwnedView(
    id: number,
    customerId: number,
  ): Promise<CustomerAddressView> {
    const row = await this.addressRepository.findOne({
      where: { id, customerId, isDeleted: false },
      relations: ['city', 'city.province'],
    });
    if (!row) {
      this.error.unprocessableEntity(['آدرس مورد نظر یافت نشد']);
    }
    return toAddressView(row);
  }
}
