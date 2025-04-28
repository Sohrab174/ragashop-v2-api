import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { PageEntity } from './entities/page.entity';
import { ErrorService } from '../../error/error.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { PageSectionEntity } from './entities/page-section.entity';
import { PageSectionItemEntity } from './entities/page-section-item.entity';
import { getLastDisplayOrder } from '../../utils/last-display-order';
import { UpdatePageSectionDto } from './dto/update-page-section.dto';
import { CreatePageSectionDto } from './dto/create-page-section.dto';
import { UpdatePageSectionItemFileDto } from './dto/update-page-section-item-file.dto';
import { CreatePageSectionItemDto } from './dto/create-page-section-item.dto';
import { UpdatePageSectionItemDto } from './dto/update-page-section-item.dto';
import { PageSectionSortDto } from './dto/page-sort-section.dto';
import { SortAction } from '../../utils/sort';
import { PageSectionItemSortDto } from './dto/page-sort-item.dto';
import { ProductStatus } from '../product/entities/product.entity';
import { CategoryStatus } from '../category/entities/category.entity';

@Injectable()
export class PageService {
  constructor(
    @InjectRepository(PageEntity)
    private pageRepository: Repository<PageEntity>,

    @InjectRepository(PageSectionEntity)
    private pageSectionRepository: Repository<PageSectionEntity>,

    @InjectRepository(PageSectionItemEntity)
    private pageSectionItemRepository: Repository<PageSectionItemEntity>,

    private error: ErrorService,
  ) {}

  /**
   * -------------------------------------------------------
   * GET /pages/admin
   */
  async getAllForAdmin(page = 1, limit = 20, filters = null, sorts = null) {
    let builder = this.pageRepository
      .createQueryBuilder('page')

      .select(['page.id', 'page.code', 'page.title']);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('page.id', 'ASC');
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
   * GET /pages/:id/admin
   */
  async getByIdForAdmin(id: number) {
    const builder = this.pageRepository
      .createQueryBuilder('page')
      .where({ id });

    const page = await builder.getOne();

    if (!page) {
      this.error.unprocessableEntity(['صفحه پیدا نشد!']);
    }

    return page;
  }

  /**
   * -------------------------------------------------------
   * GET /pages
   */
  async getAll() {
    return await this.pageRepository
      .createQueryBuilder('page')
      .select(['page.id', 'page.title'])
      .where({ isDeleted: false })
      .orderBy('page.id', 'ASC')
      .getMany();
  }

  /**
   * -------------------------------------------------------
   * GET /pages/:id
   */
  async getById(id: string) {
    const page = await this.pageRepository
      .createQueryBuilder('page')
      .leftJoinAndSelect(
        'page.sections',
        'sections',
        'sections.isDeleted = 0 AND sections.isPublished = 1',
      )
      .leftJoinAndSelect('sections.items', 'items', 'items.isDeleted = 0')
      .leftJoin(
        'items.product',
        'product',
        'product.isDeleted = 0 AND product.status = :productActive',
        { productActive: ProductStatus.active },
      )
      .leftJoin('product.cover', 'productCover')
      .leftJoin(
        'items.category',
        'category',
        'category.status = :categoryActive',
        { categoryActive: CategoryStatus.active },
      )
      .leftJoin('items.brand', 'brand')
      .leftJoin('items.page', 'itemPage')
      .addSelect([
        'product.id',
        'product.name',
        'product.price',
        'product.discountedPrice',
        'product.discountPercent',
        'product.quantity',
        'product.star',
        'product.starCountPerson',
        'productCover.id',
        'productCover.type',
        'productCover.pathFile',
        'productCover.source',
        'category.id',
        'category.name',
        'category.isSelection',
        'category.iconPath',
        'brand.id',
        'brand.name',
        'brand.isSelection',
        'itemPage.id',
        'itemPage.title',
      ])
      .andWhere({ id, isDeleted: false })
      // .andWhere(
      //   '(landing.position IN (:...withoutItemShow) OR items.id IS NOT NULL)',
      //   {
      //     withoutItemShow: [
      //       PageSectionPosition.header,
      //       PageSectionPosition.consultation,
      //       PageSectionPosition.banner,
      //       PageSectionPosition.footer,
      //       PageSectionPosition.branch,
      //     ],
      //   },
      // )
      .orderBy('sections.displayOrder', 'ASC')
      .addOrderBy('items.displayOrder', 'ASC')
      .getOne();

    if (!page) {
      this.error.unprocessableEntity(['صفحه پیدا نشد!']);
    }

    return page;
  }

  /**
   * -------------------------------------------------------
   * POST /pages/admin
   */
  async add(dto: CreatePageDto) {
    const { identifiers } = await this.pageRepository
      .createQueryBuilder()
      .insert()
      .values({
        title: dto.title,
        content: dto.content,
        isLocked: false,
        createdAt: new Date(),
      })
      .execute();

    const newPageId = identifiers[0].id;

    return { id: newPageId };
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/admin
   */
  async update(dto: UpdatePageDto) {
    console.log({ id: dto.id });

    const page = await this.pageRepository.findOne(dto.id);

    console.log({ page });

    if (!page) {
      this.error.unprocessableEntity(['صفحه یافت نشد']);
    }

    // Updating the page
    page.title = dto.title;
    page.content = dto.content;
    page.updatedAt = new Date();
    await page.save();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/:id/admin
   */
  async delete(id: number) {
    const page = await this.pageRepository.findOne({
      where: { id, isDeleted: false },
    });

    if (!page) {
      this.error.unprocessableEntity(['صفحه پیدا نشد!']);
    }

    if (page.isLocked) {
      this.error.methodNotAllowed(['امکان حذف این صفحه وجود ندارد!']);
    }

    page.isDeleted = true;
    await page.save();
  }

  /**
   * --------------------------------------------------------
   * GET /pages/:id/sections/admin
   */
  async getSectionsByPageIdForAdmin(pageId: number) {
    return await this.pageSectionRepository
      .createQueryBuilder('section')
      .leftJoinAndSelect('section.items', 'items', 'items.isDeleted = 0')
      .leftJoin('items.product', 'product', 'product.isDeleted = 0')
      .leftJoin('product.cover', 'productCover')
      .leftJoin('items.category', 'category')
      .leftJoin('items.brand', 'brand')
      .leftJoin('items.page', 'page')
      .addSelect([
        'product.id',
        'product.name',
        'product.price',
        'product.discountedPrice',
        'product.discountPercent',
        'product.quantity',
        'product.star',
        'product.starCountPerson',
        'productCover.id',
        'productCover.type',
        'productCover.pathFile',
        'productCover.source',
        'category.id',
        'category.name',
        'category.isSelection',
        'category.iconPath',
        'brand.id',
        'brand.name',
        'brand.sourceName',
        'brand.isSelection',
        'page.id',
        'page.title',
      ])
      .where({ pageId })
      .andWhere({ isDeleted: false })
      .orderBy('section.displayOrder', 'ASC')
      .addOrderBy('items.displayOrder', 'ASC')
      .getMany();
  }

  /**
   * --------------------------------------------------------
   * POST /pages/section/admin
   */
  async createSection(dto: CreatePageSectionDto) {
    const { identifiers } = await this.pageSectionRepository
      .createQueryBuilder()
      .insert()
      .values({
        ...dto,
        displayOrder: await getLastDisplayOrder(PageSectionEntity.name, {
          pageId: dto.pageId,
        }),
        createdAt: new Date(),
      })
      .execute();

    return identifiers[0].id;
  }

  /**
   * --------------------------------------------------------
   * PUT /pages/section/admin
   */
  async updateSectionById(dto: UpdatePageSectionDto) {
    await this.pageSectionRepository
      .createQueryBuilder()
      .update()
      .set({ ...dto, updatedAt: new Date() })
      .where({
        id: dto.id,
        isDeleted: false,
      })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/section/1/admin
   */
  async deleteSectionById(id: number) {
    await this.pageSectionRepository
      .createQueryBuilder()
      .update()
      .set({ isDeleted: true })
      .where({ id, isDeleted: false })
      .execute();

    return true;
  }

  /**
   * --------------------------------------------------------
   * POST /pages/section/item/admin
   */
  async createItem(dto: CreatePageSectionItemDto) {
    const section = await this.pageSectionRepository.findOne({
      id: dto.sectionId,
    });

    if (!section) {
      this.error.unprocessableEntity(['سکشن مورد نظر یافت نشد!']);
    }

    const { identifiers } = await this.pageSectionItemRepository
      .createQueryBuilder()
      .insert()
      .values({
        ...dto,
        sectionId: section.id,
        displayOrder: await getLastDisplayOrder(PageSectionItemEntity.name, {
          sectionId: section.id,
        }),
        createdAt: new Date(),
      })
      .execute();

    return identifiers[0].id;
  }

  /**
   * --------------------------------------------------------
   * PUT /pages/section/item/admin
   */
  async updateItemById(dto: UpdatePageSectionItemDto) {
    const item = await this.pageSectionItemRepository
      .createQueryBuilder('item')
      .where({ id: dto.id })
      .getOne();

    if (!item) {
      this.error.unprocessableEntity(['آیتم مورد نظر یافت نشد!']);
    }

    await this.pageSectionItemRepository
      .createQueryBuilder()
      .update()
      .set({ ...dto, updatedAt: new Date() })
      .where({
        id: dto.id,
        isDeleted: false,
      })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/section/item/file/admin
   */
  async updateItemFile(
    dto: UpdatePageSectionItemFileDto,
    file: Express.Multer.File,
  ) {
    await this.pageSectionItemRepository
      .createQueryBuilder()
      .update()
      .set({ filePath: `/pages/${file.filename}`, updatedAt: new Date() })
      .where({
        id: dto.id,
        isDeleted: false,
      })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/section/item/:id/file/admin
   */
  async deleteItemFile(id: number) {
    await this.pageSectionItemRepository
      .createQueryBuilder()
      .update()
      .set({ filePath: null })
      .where({ id, isDeleted: false })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /pages/section/item/1/admin
   */
  async deleteItemById(id: number) {
    await this.pageSectionItemRepository
      .createQueryBuilder()
      .update()
      .set({ isDeleted: true })
      .where({ id, isDeleted: false })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/section/sort/admin
   */
  async sortSection(dto: PageSectionSortDto) {
    const original = await this.pageSectionRepository.findOne({
      id: dto.id,
      isDeleted: false,
    });

    if (!original) {
      return this.error.unprocessableEntity(['سکشن یافت نشد']);
    }

    let builder = this.pageSectionRepository.createQueryBuilder().where({
      isDeleted: false,
      pageId: original.pageId,
    });

    if (dto.action === SortAction.up) {
      builder = builder
        .andWhere('displayOrder < :displayOrder', {
          displayOrder: original.displayOrder,
        })
        .orderBy('displayOrder', 'DESC');
    } else {
      builder = builder
        .andWhere('displayOrder > :displayOrder', {
          displayOrder: original.displayOrder,
        })
        .orderBy('displayOrder', 'ASC');
    }

    const alternate = await builder.getOne();

    if (!alternate) {
      return this.error.unprocessableEntity([
        'سکشن جایگزین یافت نشد، جهت دیگری را امتحان نمایید.',
      ]);
    }

    const tempDisplayOrder = original.displayOrder;

    await this.pageSectionRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: alternate.displayOrder })
      .where({ id: original.id })
      .execute();

    await this.pageSectionRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: tempDisplayOrder })
      .where({ id: alternate.id })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   * PUT /pages/section/item/sort/admin
   */
  async sortItem(dto: PageSectionItemSortDto) {
    const originalBuilder = this.pageSectionItemRepository
      .createQueryBuilder('page')
      .where({ id: dto.id });

    const original = await originalBuilder.getOne();
    if (!original) {
      return this.error.unprocessableEntity(['آیتم یافت نشد']);
    }

    let builder = this.pageSectionItemRepository.createQueryBuilder().andWhere({
      sectionId: original.sectionId,
    });

    if (dto.action === SortAction.up) {
      builder = builder
        .andWhere('displayOrder < :displayOrder', {
          displayOrder: original.displayOrder,
        })
        .orderBy('displayOrder', 'DESC');
    } else {
      builder = builder
        .andWhere('displayOrder > :displayOrder', {
          displayOrder: original.displayOrder,
        })
        .orderBy('displayOrder', 'ASC');
    }

    const alternate = await builder.getOne();

    if (!alternate) {
      return this.error.unprocessableEntity([
        'آیتم جایگزین یافت نشد، جهت دیگری را امتحان نمایید.',
      ]);
    }

    const tempDisplayOrder = original.displayOrder;

    await this.pageSectionItemRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: alternate.displayOrder })
      .where({ id: original.id })
      .execute();

    await this.pageSectionItemRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: tempDisplayOrder })
      .where({ id: alternate.id })
      .execute();

    return true;
  }
}
