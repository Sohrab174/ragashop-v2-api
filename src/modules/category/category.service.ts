import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getConnection } from 'typeorm/globals';
import * as path from 'path';
import * as fs from 'fs';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  findCategoryParentsByChildId,
  paginationResult,
  removeDuplicateByKey,
} from '../../utils';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryEntity, CategoryStatus } from './entities/category.entity';
import { UpdateCategoryIconDto } from './dto/update-category-icon.dto';
import { getLastDisplayOrder } from '../../utils/last-display-order';
import { DeleteCategoryDto } from './dto/delete-category.dto';
import { CategorySortDto } from './dto/category-sort.dto';
import { UserEntity } from '../user/entities/user.entity';
import {
  applyPathToThumbPath,
  generateThumbnail,
  squareSizeImage,
} from '../../utils/sharp';
import { TranslatorService } from '../../thirdParty/translator/translator.service';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(CategoryEntity)
    private categoryRepository: Repository<CategoryEntity>,

    private error: ErrorService,
    private translatorService: TranslatorService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /categories/admin
   */
  async add(dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parentCategory = await this.categoryRepository.findOne({
        id: dto.parentId,
      });
      if (!parentCategory) {
        this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
      }
    }

    // Creating a new category
    const { identifiers } = await this.categoryRepository
      .createQueryBuilder()
      .insert()
      .values({
        name: dto.name,
        status: dto.status,
        parentId: dto.parentId,
        isSelection: dto.isSelection || false,
        displayOrder: await getLastDisplayOrder(CategoryEntity.name),
        createdAt: new Date(),
      })
      .execute();

    const newCategoryId = identifiers[0].id;

    return { id: newCategoryId };
  }

  /**
   * -------------------------------------------------------
   * PUT /categories/admin
   */
  async update(dto: UpdateCategoryDto) {
    const targetCategory = await this.categoryRepository.findOne({
      where: { id: dto.id },
    });
    if (!targetCategory) {
      this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
    }

    if (dto.parentId === dto.id) {
      this.error.unprocessableEntity(['این درخواست نامعتبر است']);
    }

    if (dto.parentId) {
      const categoryParent = await this.categoryRepository.findOne({
        id: dto.parentId,
      });
      if (!categoryParent) {
        this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
      }
    }

    // Updating the category
    targetCategory.parentId = dto.parentId;
    targetCategory.status = dto.status;
    targetCategory.name = dto.name;
    targetCategory.isSelection = dto.isSelection || false;

    await targetCategory.save();

    return true;
  }

  /**
   * -------------------------------------------------------
   * PUT /categories/icon/admin
   */
  async updateIcon(dto: UpdateCategoryIconDto, icon: Express.Multer.File) {
    const category = await this.categoryRepository
      .createQueryBuilder('category')

      .andWhere({ id: dto.id })
      .getOne();

    if (!category) {
      this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
    }

    const oldIconPath = category.iconPath;

    // Updating the category icon
    await this.categoryRepository
      .createQueryBuilder()
      .update()
      .set({ iconPath: `/categories/${icon.filename}` })
      .where({ id: category.id })
      .execute();

    await generateThumbnail(icon.path, 50, 50);
    await squareSizeImage(icon.path, 200, 200);

    // Remove the old icon from disk
    if (oldIconPath) {
      fs.unlink(path.join(__dirname, '../../..', 'uploads', oldIconPath), (e) =>
        console.log(e),
      );

      fs.unlink(
        path.join(
          __dirname,
          '../../..',
          'uploads',
          applyPathToThumbPath(oldIconPath),
        ),
        (e) => console.log(e),
      );
    }

    return category.iconPath;
  }

  /**
   * -------------------------------------------------------
   * DELETE /categories/:id/icon/admin
   */
  async deleteIcon(id: number, user: UserEntity) {
    const category = await this.categoryRepository.findOne({
      id,
    });

    if (!category) {
      this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
    }

    fs.unlink(
      path.join(__dirname, '../../..', 'uploads', category.iconPath),
      (e) => console.log(e),
    );

    fs.unlink(
      path.join(
        __dirname,
        '../../..',
        'uploads',
        applyPathToThumbPath(category.iconPath),
      ),
      (e) => console.log(e),
    );

    category.iconPath = null;
    await category.save();
    return true;
  }

  /**
   * -------------------------------------------------------
   * DELETE /categories/:id/admin
   */
  async delete(id: number, user: UserEntity, dto: DeleteCategoryDto) {
    const category = await this.categoryRepository.findOne({
      where: { id },
      relations: ['subCategories'],
    });

    if (!category) {
      this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
    }

    const tempIconPath = category.iconPath;

    if (category.subCategories?.length > 0 && !dto.force) {
      this.error.methodNotAllowed(
        [
          'برخی از زیرمجموعه‌ها مربوط به این دسته هستند، لطفاً ابتدا زیر دسته‌های این دسته را حذف کنید',
        ],
        { hasSubCategories: true },
      );
    }

    // Rollbacking the category locales if an error occurs
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Removing the locales
      // await this._deleteLocales(category, queryRunner);

      // Removing the sub categories
      if (category.subCategories?.length > 0) {
        const allCategories = await this.categoryRepository.find();
        await this._deleteSubCategories(
          allCategories,
          category.id,
          queryRunner,
        );
      }

      // Removing the category
      await queryRunner.manager.remove(category);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();

      this.error.methodNotAllowed([
        'برخی از محصولات مربوط به این دسته هستند، لطفا ابتدا محصولات این دسته را حذف کنید',
      ]);
    } finally {
      await queryRunner.release();
    }

    // Remove the icon of the category from disk
    if (tempIconPath) {
      fs.unlink(
        path.join(__dirname, '../../..', 'uploads', tempIconPath),
        (e) => console.log(e),
      );

      fs.unlink(
        path.join(
          __dirname,
          '../../..',
          'uploads',
          applyPathToThumbPath(tempIconPath),
        ),
        (e) => console.log(e),
      );
    }

    return true;
  }

  /**
   * -------------------------------------------------------
   * GET /categories/admin
   */
  async getAllForAdmin(
    page = 1,
    limit = 20,
    filters = null,
    sorts = null,
    parentId = null,
  ) {
    let builder = this.categoryRepository
      .createQueryBuilder('category')
      .leftJoinAndSelect('category.parent', 'parent')
      .andWhere('category.id != 1');

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('category.displayOrder', 'ASC');
    }

    builder = applyFiltersToBuilder(builder, filters);

    if (parentId === '-1') {
      builder.andWhere('(category.parentId IS NULL OR category.parentId = "")');
    } else if (parentId) {
      builder.andWhere({ parentId });
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
   * GET /categories/:id/admin
   */
  async getByIdForAdmin(id: number) {
    const builder = this.categoryRepository
      .createQueryBuilder('category')
      .leftJoinAndSelect('category.parent', 'parent')
      .andWhere('category.id != 1')
      .where({ id });

    const category = await builder.getOne();

    if (!category) {
      this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
    }

    return category;
  }

  /**
   * -------------------------------------------------------
   * GET /categories
   */
  async getAll(
    page = 1,
    limit = 20,
    sorts = null,
    parentId = null,
    getSubIds = false,
    isSelection = false,
  ) {
    let builder = this.categoryRepository
      .createQueryBuilder('category')

      // .innerJoin(
      //   'category.products',
      //   'products',
      //   'products.status = :pStatus',
      //   { pStatus: ProductStatus.active },
      // )
      .andWhere({ status: CategoryStatus.active })
      .andWhere('category.id != 1');

    if (parentId) {
      builder.andWhere(
        parentId === 'NULL' ? 'category.parentId IS NULL' : { parentId },
      );
    }

    if (isSelection) {
      builder.andWhere({ isSelection: true });
    }

    if (sorts) {
      builder = applySortingToBuilder(builder, sorts);
    } else {
      builder.orderBy('category.displayOrder', 'ASC');
    }

    const [items, totalItems] = await builder
      .take(limit)
      .skip((page - 1) * limit)
      .getManyAndCount();

    // Getting the sub category ids
    let groupedCategories = [];
    if (getSubIds) {
      const subCategories = await this.categoryRepository
        .createQueryBuilder('category')
        .select(['category.id', 'category.parentId'])
        .where({
          status: CategoryStatus.active,
        })
        .getMany();
      groupedCategories = this._applyCategoryToTree(subCategories);
    }

    return {
      items: items.map((item) => ({
        ...item,
        ...(getSubIds && {
          subIds: this._extractSubIds(
            groupedCategories.find((g) => g.id === item.id)?.subCategories ||
              [],
          ),
        }),
      })),
      pagination: paginationResult(page, limit, totalItems),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /categories/:id
   */
  async getById(categoryId, getSubIds = false) {
    const builder = this.categoryRepository
      .createQueryBuilder('category')

      // .innerJoin(
      //   'category.products',
      //   'products',
      //   'products.status = :pStatus',
      //   { pStatus: ProductStatus.active },
      // )
      .andWhere({ id: categoryId, status: CategoryStatus.active })
      .andWhere('category.id != 1');

    const category = await builder.getOne();

    if (!category) {
      this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
    }

    // Getting the sub category ids
    let groupedCategories: any = [];
    if (getSubIds) {
      const subCategories = await this.categoryRepository
        .createQueryBuilder('category')
        .select(['category.id', 'category.parentId'])
        .where({
          status: CategoryStatus.active,
        })
        .getMany();

      groupedCategories = this._applyCategoryToTree(subCategories, +categoryId);
    }

    return {
      ...category,
      ...(getSubIds && {
        subIds: this._extractSubIds(groupedCategories || []),
      }),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /categories/tree
   * GET /categories/tree?child_id=1
   */
  async getAllTree(childId = null) {
    const categories = await this.categoryRepository
      .createQueryBuilder('category')

      // .innerJoin(
      //   'category.products',
      //   'products',
      //   'products.status = :pStatus',
      //   { pStatus: ProductStatus.active },
      // )
      .select([
        'category.id',
        'category.parentId',
        'category.iconPath',
        'category.name',
      ])
      .where({ status: CategoryStatus.active })
      .orderBy('category.displayOrder', 'ASC')
      .andWhere('category.id != 1')
      .getMany();

    const groupedCategories = this._applyCategoryToTree(categories);

    if (childId) {
      return findCategoryParentsByChildId(groupedCategories, +childId).map(
        (cat) => {
          delete cat.subCategories;
          return cat;
        },
      );
    }

    return groupedCategories;
  }

  /**
   * -------------------------------------------------------
   */
  async getRecordById(categoryId) {
    return await this.categoryRepository.findOne({ id: categoryId });
  }

  /**
   * -------------------------------------------------------
   * PUT /categories/sort/admin
   */
  async sort(dto: CategorySortDto, user: UserEntity, filters = null) {
    const original = await this.categoryRepository
      .createQueryBuilder('category')

      .select(['category.id', 'category.displayOrder'])
      .andWhere({ id: dto.id })
      .getOne();

    if (!original) {
      return this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
    }

    let builder = this.categoryRepository
      .createQueryBuilder('category')

      .select(['category.id', 'category.displayOrder']);

    if (dto.action) {
      builder = applyFiltersToBuilder(builder, filters);

      if (dto.action === 'up') {
        builder = builder
          .andWhere('category.displayOrder < :displayOrder', {
            displayOrder: original.displayOrder,
          })
          .orderBy('category.displayOrder', 'DESC');
      } else {
        builder = builder
          .andWhere('category.displayOrder > :displayOrder', {
            displayOrder: original.displayOrder,
          })
          .orderBy('category.displayOrder', 'ASC');
      }
    } else {
      builder.andWhere({ id: dto.alternate });
    }

    const alternate = await builder.getOne();

    if (!alternate) {
      return this.error.unprocessableEntity(['دسته بندی جایگزینی یافت نشد']);
    }

    const tempDisplayOrder = original.displayOrder;

    await this.categoryRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: alternate.displayOrder })
      .where({ id: original.id })
      .execute();

    await this.categoryRepository
      .createQueryBuilder()
      .update()
      .set({ displayOrder: tempDisplayOrder })
      .where({ id: alternate.id })
      .execute();

    return true;
  }

  /**
   * -------------------------------------------------------
   */
  async getRecordByName(categoryName) {
    const category = await this.categoryRepository
      .createQueryBuilder('category')
      .where('TRIM(LOWER(category.name)) = :name', {
        name: `${categoryName}`.toLowerCase().trim(),
      })
      .getOne();

    return category?.id || null;
  }

  /**
   * -------------------------------------------------------
   */
  private async _deleteSubCategories(categories, parentId, queryRunner) {
    for (const category of categories) {
      if (category.parentId === parentId) {
        // Deleting the childs
        await this._deleteSubCategories(categories, category.id, queryRunner);

        // Deleting the self
        // await this._deleteLocales(category, queryRunner);
        await queryRunner.manager.remove(category);
      }
    }
  }

  /**
   * -------------------------------------------------------
   */
  private _applyCategoryToTree(categories, parentId: number = null) {
    const result = [];

    for (const category of categories) {
      if (category.parentId === parentId) {
        const subCategories = this._applyCategoryToTree(
          categories,
          category.id,
        );
        if (subCategories.length > 0) {
          category.subCategories = subCategories;
        }
        result.push(category);
      }
    }

    return result;
  }

  private _extractSubIds(subCategories, result = []) {
    for (const obj of subCategories) {
      result.push(obj.id);

      if (obj.subCategories && obj.subCategories.length > 0) {
        this._extractSubIds(obj.subCategories, result);
      }
    }

    return result;
  }

  /**
   * -------------------------------------------------------
   */
  async addOrUpdate(
    source,
    sourceId,
    { sourceName, hierarchy = null, bankTypeId = null, bankTypeName = null },
    tree = [],
  ) {
    let category = await this.categoryRepository.findOne({
      where: { source, sourceId },
      select: ['id', 'parentId', 'sourceName'],
    });

    if (category) {
      if (category.sourceName !== sourceName) {
        category.sourceName = sourceName;
        category.name = await this._findOrTranslate(sourceName);
        category.hierarchy = hierarchy;
        await category.save();
      }
    } else {
      tree = removeDuplicateByKey(tree, 'level').filter(
        (node) => node.id !== sourceId,
      );
      let parentId: number | null = null;

      if (tree.length > 0) {
        let parentCategory = null;

        for (const node of tree.sort((a, b) => a.level - b.level)) {
          parentCategory = await this.categoryRepository.findOne({
            where: { source, sourceId: node.id },
            select: ['id'],
          });

          if (!parentCategory) {
            parentCategory = this.categoryRepository.create({
              parentId,
              source,
              sourceId: node.id,
              sourceName: node.name,
              name: await this._findOrTranslate(node.name),
              displayOrder: await getLastDisplayOrder(CategoryEntity.name),
              createdAt: new Date(),
            });

            await this.categoryRepository.save(parentCategory);
          }

          parentId = parentCategory.id;
        }
      }

      category = this.categoryRepository.create({
        parentId,
        source,
        sourceId,
        sourceName,
        name: await this._findOrTranslate(sourceName),
        hierarchy,
        bankTypeId,
        bankTypeName,
        displayOrder: await getLastDisplayOrder(CategoryEntity.name),
        createdAt: new Date(),
      });
      await this.categoryRepository.save(category);
    }

    return category.id;
  }

  /**
   * -------------------------------------------------------
   */
  private async _findOrTranslate(sourceName) {
    const exist = await this.categoryRepository
      .createQueryBuilder('category')
      .select(['category.id', 'category.name'])
      .where('category.sourceName = :sourceName', { sourceName })
      .andWhere('category.name REGEXP :persianPattern', {
        persianPattern: '[\\u0600-\\u06FF]',
      })
      .getOne();

    if (exist) {
      return exist.name;
    }

    return (await this.translatorService.text(sourceName)) || sourceName;
  }

  /**
   * -------------------------------------------------------
   */
  async getChildIds(parentId) {
    const subCategories = await this.categoryRepository
      .createQueryBuilder('category')
      .select(['category.id', 'category.parentId'])
      .where({
        status: CategoryStatus.active,
      })
      .getMany();

    const groupedCategories = this._applyCategoryToTree(
      subCategories,
      +parentId,
    );

    return this._extractSubIds(groupedCategories || []);
  }
}
