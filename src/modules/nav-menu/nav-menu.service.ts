import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { CreateNavMenuDto } from './dto/create-nav-menu.dto';
import { UpdateNavMenuDto } from './dto/update-nav-menu.dto';
import { NavMenuEntity } from './entities/nav-menu.entity';
import { getLastDisplayOrder } from '../../utils/last-display-order';
import { NavMenuSortDto } from './dto/nav-menu-sort.dto';

@Injectable()
export class NavMenuService {
  constructor(
    @InjectRepository(NavMenuEntity)
    private navMenuRepository: Repository<NavMenuEntity>,

    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /nav-menus/admin
   */
  async add(dto: CreateNavMenuDto) {
    const { identifiers } = await this.navMenuRepository
      .createQueryBuilder()
      .insert()
      .values({
        title: dto.title,
        position: dto.position,
        pageId: dto.pageId || null,
        categoryId: dto.categoryId || null,
        internalLink: dto.internalLink || null,
        externalLink: dto.externalLink || null,
        displayOrder: await getLastDisplayOrder(NavMenuEntity.name),
      })
      .execute();

    const newNavMenuId = identifiers[0].id;

    return { id: newNavMenuId };
  }

  /**
   * -------------------------------------------------------
   * PUT /nav-menus/admin
   */
  async update(dto: UpdateNavMenuDto) {
    await this.navMenuRepository
      .createQueryBuilder()
      .update()
      .set(dto)
      .where({ id: dto.id })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /nav-menus/:id/admin
   */
  async delete(id: number) {
    await this.navMenuRepository
      .createQueryBuilder()
      .update()
      .set({ isDeleted: true })
      .where({ id })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * GET /nav-menus/admin
   */
  async getAllForAdmin(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.navMenuRepository
      .createQueryBuilder('nav')
      .leftJoin('nav.page', 'page')
      .leftJoin('nav.category', 'category')
      .andWhere({ isDeleted: false })
      .addSelect(['page.id', 'page.title', 'category.id', 'category.name']);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('nav.displayOrder', 'ASC');
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
   * GET /nav-menus/:id/admin
   */
  async getByIdForAdmin(id: number) {
    const builder = this.navMenuRepository
      .createQueryBuilder('nav-menu')
      .where({ id })
      .andWhere({ isDeleted: false });

    const category = await builder.getOne();

    if (!category) {
      this.error.unprocessableEntity(['منوی مورد نظر یافت نشد']);
    }

    return category;
  }

  /**
   * -------------------------------------------------------
   * GET /nav-menus
   */
  async getAll(filters = null) {
    let builder = this.navMenuRepository
      .createQueryBuilder('nav')
      .leftJoin('nav.page', 'page')
      .leftJoin('nav.category', 'category')
      .andWhere({ isDeleted: false })
      .addSelect(['page.id', 'page.title', 'category.id', 'category.name'])
      .orderBy('nav.displayOrder', 'ASC');

    builder = applyFiltersToBuilder(builder, filters);

    return await builder.getMany();
  }

  /**
   * -------------------------------------------------------
   */
  async getRecordById(navMenuId) {
    return await this.navMenuRepository.findOne({ id: navMenuId });
  }

  /**
   * -------------------------------------------------------
   * PUT /nav-menus/sort/admin
   */
  async sort(dto: NavMenuSortDto, filters = null) {
    const original = await this.navMenuRepository
      .createQueryBuilder('nav')
      .select(['nav.id', 'nav.displayOrder'])
      .andWhere({ id: dto.id })
      .getOne();

    if (!original) {
      return this.error.unprocessableEntity(['منوی مورد نظر یافت نشد']);
    }

    let builder = this.navMenuRepository
      .createQueryBuilder('nav')
      .select(['nav.id', 'nav.displayOrder']);

    if (dto.action) {
      builder = applyFiltersToBuilder(builder, filters);

      if (dto.action === 'up') {
        builder = builder
          .andWhere('nav.displayOrder < :displayOrder', {
            displayOrder: original.displayOrder,
          })
          .orderBy('nav.displayOrder', 'DESC');
      } else {
        builder = builder
          .andWhere('nav.displayOrder > :displayOrder', {
            displayOrder: original.displayOrder,
          })
          .orderBy('nav.displayOrder', 'ASC');
      }
    } else {
      builder.andWhere({ id: dto.alternate });
    }

    const alternate = await builder.getOne();

    if (!alternate) {
      return this.error.unprocessableEntity(['منوی جایگزینی یافت نشد']);
    }

    const tempDisplayOrder = original.displayOrder;

    await this.navMenuRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: alternate.displayOrder })
      .where({ id: original.id })
      .execute();

    await this.navMenuRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: tempDisplayOrder })
      .where({ id: alternate.id })
      .execute();

    return true;
  }
}
