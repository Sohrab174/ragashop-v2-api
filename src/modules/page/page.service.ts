import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, getConnection } from 'typeorm';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  paginationResult,
} from '../../utils';
import { PageEntity } from './entities/page.entity';
import { ErrorService } from '../../error/error.service';
import { UserEntity } from '../user/entities/user.entity';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';

@Injectable()
export class PageService {
  constructor(
    @InjectRepository(PageEntity)
    private pageRepository: Repository<PageEntity>,

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
      .select(['page.id', 'page.code', 'page.title'])
      .orderBy('page.id', 'ASC')
      .getMany();
  }

  /**
   * -------------------------------------------------------
   * GET /pages/:code
   */
  async getById(code: string) {
    const page = await this.pageRepository
      .createQueryBuilder('page')
      .andWhere({ code })
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
  async add(dto: CreatePageDto, user: UserEntity) {
    const foundPageByCode = await this.pageRepository.findOne({
      code: dto.code,
    });

    if (foundPageByCode) {
      this.error.unprocessableEntity(['این کد استفاده شده است']);
    }

    // Creating a new page
    const { identifiers } = await this.pageRepository
      .createQueryBuilder()
      .insert()
      .values({
        code: dto.code,
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
  async update(dto: UpdatePageDto, user: UserEntity) {
    // Checking the not used page code
    const foundPageByCode = await this.pageRepository.findOne({
      code: dto.code,
      id: Not(dto.id),
    });

    if (foundPageByCode) {
      this.error.unprocessableEntity(['این کد استفاده شده است']);
    }

    // Found page by id for updating
    const page = await this.pageRepository.findOne({
      where: {
        id: dto.id,
      },
    });

    // Updating the page
    page.code = dto.code;
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
      where: { id },
    });

    if (!page) {
      this.error.unprocessableEntity(['صفحه پیدا نشد!']);
    }

    // Rollbacking the page locales if an error occurs
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Removing the page
      await queryRunner.manager.remove(page);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();

      this.error.methodNotAllowed(['خطایی رخ داده است']);
    } finally {
      await queryRunner.release();
    }

    return true;
  }
}
