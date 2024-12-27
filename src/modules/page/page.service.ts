import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { I18nContext } from 'nestjs-i18n';
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
  async getAllForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
    companyId = null,
  ) {
    const { lang } = I18nContext.current();

    let builder = this.pageRepository
      .createQueryBuilder('page')
      .innerJoin('page.locales', 'locales', 'locales.language = :lang', {
        lang,
      })
      .select(['page.id', 'page.code', 'locales.id', 'locales.title']);

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('page.id', 'ASC');
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
   * GET /pages/:id/admin
   */
  async getByIdForAdmin(id: number, companyId = null) {
    const i18n = I18nContext.current();

    const builder = this.pageRepository
      .createQueryBuilder('page')
      .innerJoinAndSelect('page.locales', 'locales')
      .where({ id });

    if (companyId) {
      builder.andWhere({ companyId });
    }

    const page = await builder.getOne();

    if (!page) {
      this.error.unprocessableEntity([i18n.t('t.The page not found!')]);
    }

    return page;
  }

  /**
   * -------------------------------------------------------
   * GET /pages
   */
  async getAll(companyId) {
    const { lang } = I18nContext.current();

    return await this.pageRepository
      .createQueryBuilder('page')
      .innerJoin('page.locales', 'locales', 'locales.language = :lang', {
        lang,
      })
      .select(['page.id', 'page.code', 'locales.id', 'locales.title'])
      .orderBy('page.id', 'ASC')
      .andWhere({ companyId })
      .getMany();
  }

  /**
   * -------------------------------------------------------
   * GET /pages/:code
   */
  async getById(code: string, companyId) {
    const i18n = I18nContext.current();

    const page = await this.pageRepository
      .createQueryBuilder('page')
      .innerJoinAndSelect(
        'page.locales',
        'locales',
        'locales.language = :lang',
        {
          lang: i18n.lang,
        },
      )
      .andWhere({ code, companyId })
      .getOne();

    if (!page) {
      this.error.unprocessableEntity([i18n.t('t.The page not found!')]);
    }

    return page;
  }

  /**
   * -------------------------------------------------------
   * POST /pages/admin
   */
  async add(dto: CreatePageDto, user: UserEntity) {
    const i18n = I18nContext.current();

    const foundPageByCode = await this.pageRepository.findOne({
      code: dto.code,
    });

    if (foundPageByCode) {
      this.error.unprocessableEntity([
        i18n.t('t.This code has already been used'),
      ]);
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
    const i18n = I18nContext.current();

    // Checking the not used page code
    const foundPageByCode = await this.pageRepository.findOne({
      code: dto.code,
      id: Not(dto.id),
    });

    if (foundPageByCode) {
      this.error.unprocessableEntity([
        i18n.t('t.This code has already been used'),
      ]);
    }

    // Found page by id for updating
    const page = await this.pageRepository.findOne({
      where: {
        id: dto.id,
      },
      relations: ['locales'],
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
  async delete(id: number, user: UserEntity) {
    const i18n = I18nContext.current();

    const page = await this.pageRepository.findOne({
      where: { id },
    });

    if (!page) {
      this.error.unprocessableEntity([i18n.t('t.The page not found!')]);
    }

    // Rollbacking the page locales if an error occurs
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // try {
    //   for (let i = 0; i < page.locales.length; i++) {
    //     const locale = page.locales[i];
    //     // Removing the page locale
    //     await queryRunner.manager.remove(locale);
    //   }
    //   // Removing the page
    //   await queryRunner.manager.remove(page);

    //   await queryRunner.commitTransaction();
    // } catch (err) {
    //   await queryRunner.rollbackTransaction();

    //   this.error.methodNotAllowed([i18n.t('t.An error has occurred!')]);
    // } finally {
    //   await queryRunner.release();
    // }

    return true;
  }
}
