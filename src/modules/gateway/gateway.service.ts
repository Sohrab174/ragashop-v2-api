import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ErrorService } from '../../error/error.service';
import { GatewayEntity, GatewayStatus } from './entities/gateway.entity';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { CreateGatewayDto } from './dto/create-gateway.dto';
import { UpdateGatewayDto } from './dto/update-gateway.dto';
import { getLastDisplayOrder } from '../../utils/last-display-order';

@Injectable()
export class GatewayService {
  constructor(
    @InjectRepository(GatewayEntity)
    private gatewayRepository: Repository<GatewayEntity>,

    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /gateways/:id/admin
   */
  async getById(id: number) {
    const builder = this.gatewayRepository
      .createQueryBuilder('gateway')

      .where({ id, isDeleted: false });

    const gateway = await builder.getOne();

    if (!gateway) {
      this.error.unprocessableEntity(['دروازه پرداخت پیدا نشد']);
    }

    return gateway;
  }

  /**
   * -------------------------------------------------------
   * GET /gateways/admin
   */
  async getAllForAdmin(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.gatewayRepository.createQueryBuilder('gateway');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('gateway.id', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    return {
      items,
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /gateways
   */
  async getAll() {
    const items = await this.gatewayRepository
      .createQueryBuilder('gateway')
      .andWhere({ status: GatewayStatus.active, isDeleted: false })
      .select(['gateway.id', 'gateway.name', 'gateway.displayOrder'])
      .orderBy('gateway.displayOrder', 'ASC')
      .getMany();

    return items;
  }

  /**
   * -------------------------------------------------------
   * POST /gateways/admin
   */
  async add(dto: CreateGatewayDto) {
    const { identifiers } = await this.gatewayRepository
      .createQueryBuilder()
      .insert()
      .values({
        name: dto.name,
        username: dto.username,
        password: dto.password,
        merchantId: dto.merchantId,
        displayOrder: await getLastDisplayOrder(GatewayEntity.name),
        status: dto.status,
        isDeleted: false,
      })
      .execute();

    const newGatewayId = identifiers[0].id;

    return { id: newGatewayId };
  }

  /**
   * -------------------------------------------------------
   * PUT /gateways/admin
   */
  async update(dto: UpdateGatewayDto) {
    const gateway = await this.gatewayRepository.findOne({
      where: { id: dto.id },
    });

    if (!gateway) {
      this.error.unprocessableEntity(['دروازه پرداخت پیدا نشد']);
    }

    await this.gatewayRepository
      .createQueryBuilder()
      .update()
      .set(dto)
      .where({ id: dto.id })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /gateways/:id/admin
   */
  async delete(id: number) {
    const gateway = await this.gatewayRepository.findOne({
      where: { id },
    });

    if (!gateway) {
      this.error.unprocessableEntity(['دروازه پرداخت پیدا نشد']);
    }

    gateway.isDeleted = true;
    await gateway.save();

    return true;
  }
}
