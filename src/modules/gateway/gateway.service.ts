import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { I18nContext } from 'nestjs-i18n';

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
  async getById(id: number, companyId = null) {
    const i18n = I18nContext.current();

    const builder = this.gatewayRepository
      .createQueryBuilder('gateway')

      .where({ id, isDeleted: false });

    if (companyId) {
      builder.andWhere({ companyId });
    }

    const gateway = await builder.getOne();

    if (!gateway) {
      this.error.unprocessableEntity([i18n.t('t.The gateway was not found!')]);
    }

    return gateway;
  }

  /**
   * -------------------------------------------------------
   * GET /gateways/admin
   */
  async getAllForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
    companyId = null,
  ) {
    let builder = this.gatewayRepository.createQueryBuilder('gateway');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('gateway.id', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    if (companyId) {
      builder.andWhere({ companyId });
    }

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
  async getAll(companyId) {
    const items = await this.gatewayRepository
      .createQueryBuilder('gateway')
      .andWhere({ companyId, status: GatewayStatus.active, isDeleted: false })
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
  async update(dto: UpdateGatewayDto, companyId: number) {
    const i18n = I18nContext.current();

    const gateway = await this.gatewayRepository.findOne({
      where: { companyId, id: dto.id },
    });

    if (!gateway) {
      this.error.unprocessableEntity([i18n.t('t.The gateway was not found!')]);
    }

    await this.gatewayRepository
      .createQueryBuilder()
      .update()
      .set(dto)
      .where({ companyId, id: dto.id })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /gateways/:id/admin
   */
  async delete(id: number, companyId: number) {
    const i18n = I18nContext.current();

    const gateway = await this.gatewayRepository.findOne({
      where: { id, companyId },
    });

    if (!gateway) {
      this.error.unprocessableEntity([i18n.t('t.The gateway was not found!')]);
    }

    gateway.isDeleted = true;
    await gateway.save();

    return true;
  }
}
