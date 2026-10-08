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
import { containsPersianScript } from '../../utils/persian-script.util';
import {
  CategoryHierarchyValidationError,
  validateCategoryParentAssignment,
} from './category-hierarchy.validation';
import { CategoryHierarchyLockService } from './category-hierarchy-lock.service';
import {
  attachPresentationImages,
  buildCategoryTree,
  inheritImagesFromDescendants,
  prepareCustomerCatalogTree,
} from './category-tree.builder';
import {
  fillImagesFromDescendantCovers,
  resolveDirectPresentationImages,
} from './category-presentation-image';
import {
  ProductEntity,
  ProductStatus,
} from '../product/entities/product.entity';
import {
  ProductGalleryEntity,
  ProductGalleryType,
} from '../product/entities/product-gallery.entity';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(CategoryEntity)
    private categoryRepository: Repository<CategoryEntity>,

    private error: ErrorService,
    private translatorService: TranslatorService,
    private categoryHierarchyLockService: CategoryHierarchyLockService,
  ) {}

  /**
   * -------------------------------------------------------
   * POST /categories/admin
   */
  async add(dto: CreateCategoryDto) {
    return this.categoryHierarchyLockService.withHierarchyMutationLock(
      0,
      dto.parentId ?? null,
      async () => {
        try {
          await validateCategoryParentAssignment(
            this.categoryRepository,
            null,
            dto.parentId ?? null,
          );
        } catch (error) {
          if (error instanceof CategoryHierarchyValidationError) {
            this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
          }
          throw error;
        }

        const { identifiers } = await this.categoryRepository
          .createQueryBuilder()
          .insert()
          .values({
            name: dto.name,
            status: dto.status,
            parentId: dto.parentId,
            isSelection: dto.isSelection || false,
            gender: dto?.gender || null,
            displayOrder: await getLastDisplayOrder(CategoryEntity.name),
            createdAt: new Date(),
          })
          .execute();

        return { id: identifiers[0].id };
      },
    );
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

    return this.categoryHierarchyLockService.withHierarchyMutationLock(
      dto.id,
      dto.parentId ?? null,
      async () => {
        const reloaded = await this.categoryRepository.findOne({
          where: { id: dto.id },
        });
        if (!reloaded) {
          this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
        }

        try {
          await validateCategoryParentAssignment(
            this.categoryRepository,
            dto.id,
            dto.parentId ?? null,
          );
        } catch (error) {
          if (error instanceof CategoryHierarchyValidationError) {
            this.error.unprocessableEntity(['دسته بندی مورد نظر یافت نشد']);
          }
          throw error;
        }

        reloaded.parentId = dto.parentId;
        reloaded.status = dto.status;
        reloaded.name = dto.name;
        reloaded.isSelection = dto.isSelection || false;
        reloaded.gender = dto?.gender || null;

        await reloaded.save();

        return true;
      },
    );
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

    await generateThumbnail(icon.path, 80, 80);
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

    // Pre-check products (soft-deleted rows still block FK) — never orphan products.
    const productCount = await this.categoryRepository.manager
      .createQueryBuilder()
      .from(ProductEntity, 'p')
      .where('p.categoryId = :categoryId', { categoryId: id })
      .getCount();

    if (productCount > 0) {
      this.error.methodNotAllowed(
        [
          `این دسته‌بندی دارای ${productCount} محصول است. ابتدا محصولات را به دسته دیگری منتقل کنید.`,
        ],
        { hasProducts: true, productCount },
      );
    }

    // When force-deleting children, also block if any descendant has products.
    if (dto.force && category.subCategories?.length > 0) {
      const allCategories = await this.categoryRepository.find({
        select: ['id', 'parentId'],
      });
      const descendantIds = this._collectDescendantIds(allCategories, id);
      if (descendantIds.length > 0) {
        const descendantProductCount = await this.categoryRepository.manager
          .createQueryBuilder()
          .from(ProductEntity, 'p')
          .where('p.categoryId IN (:...ids)', { ids: descendantIds })
          .getCount();
        if (descendantProductCount > 0) {
          this.error.methodNotAllowed(
            [
              `زیرشاخه‌های این دسته دارای ${descendantProductCount} محصول هستند. ابتدا محصولات را منتقل کنید.`,
            ],
            {
              hasProducts: true,
              productCount: descendantProductCount,
              inDescendants: true,
            },
          );
        }
      }
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
        'حذف ممکن نیست — این دسته هنوز به محصول، منو یا بخش صفحه متصل است. ابتدا وابستگی‌ها را جابه‌جا کنید.',
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
   * GET /categories/tree/admin
   * Employee-facing hierarchy: includes inactive, excludes system id=1,
   * attaches direct productCount, and returns orphans separately.
   */
  async getTreeForAdmin() {
    const categories = await this.categoryRepository
      .createQueryBuilder('category')
      .select([
        'category.id',
        'category.parentId',
        'category.name',
        'category.sourceName',
        'category.source',
        'category.sourceId',
        'category.iconPath',
        'category.gender',
        'category.status',
        'category.displayOrder',
        'category.isSelection',
        'category.createdAt',
      ])
      .andWhere('category.id != 1')
      .orderBy('category.displayOrder', 'ASC')
      .addOrderBy('category.id', 'ASC')
      .getMany();

    const idSet = new Set(categories.map((c) => Number(c.id)));

    const countRows = await this.categoryRepository.manager
      .createQueryBuilder()
      .select('p.categoryId', 'categoryId')
      .addSelect('COUNT(*)', 'productCount')
      .from(ProductEntity, 'p')
      .where('p.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('p.categoryId IN (:...ids)', {
        ids: categories.length ? categories.map((c) => c.id) : [0],
      })
      .groupBy('p.categoryId')
      .getRawMany();

    const countMap = new Map<number, number>();
    for (const row of countRows) {
      countMap.set(Number(row.categoryId), Number(row.productCount) || 0);
    }

    const enriched = categories.map((c) => ({
      ...c,
      productCount: countMap.get(Number(c.id)) || 0,
    }));

    const orphans = enriched.filter(
      (c) => c.parentId != null && !idSet.has(Number(c.parentId)),
    );

    const tree = buildCategoryTree(enriched as any);

    const attachCounts = (nodes: any[]): any[] =>
      nodes.map((node) => ({
        ...node,
        productCount: node.productCount || 0,
        subCategories: node.subCategories
          ? attachCounts(node.subCategories)
          : undefined,
      }));

    return {
      tree: attachCounts(tree),
      orphans: orphans.map((o) => ({
        ...o,
        hasChildren: false,
        productCount: o.productCount || 0,
      })),
      totalCategories: categories.length,
    };
  }

  private _collectDescendantIds(
    categories: { id: number; parentId: number | null }[],
    parentId: number,
  ): number[] {
    const result: number[] = [];
    const children = categories.filter(
      (c) => Number(c.parentId) === Number(parentId),
    );
    for (const child of children) {
      result.push(child.id);
      result.push(...this._collectDescendantIds(categories, child.id));
    }
    return result;
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
    name = null,
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

    if (name) {
      builder.andWhere(
        '(category.name LIKE :name OR category.sourceName LIKE :name)',
        {
          name: `%${name}%`,
        },
      );
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
        .select(['category.id', 'category.parentId', 'category.displayOrder'])
        .where({
          status: CategoryStatus.active,
        })
        .getMany();
      groupedCategories = buildCategoryTree(subCategories as any);
    }

    const withImages = await this._attachFlatPresentationImages(items);

    return {
      items: withImages.map((item) => ({
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
        .select(['category.id', 'category.parentId', 'category.displayOrder'])
        .where({
          status: CategoryStatus.active,
        })
        .getMany();

      groupedCategories = buildCategoryTree(subCategories as any, +categoryId);
    }

    const [withImage] = await this._attachFlatPresentationImages([category]);

    return {
      ...withImage,
      ...(getSubIds && {
        subIds: this._extractSubIds(groupedCategories || []),
      }),
    };
  }

  /**
   * -------------------------------------------------------
   * GET /categories/tree
   * GET /categories/tree?child_id=1
   *
   * Source-agnostic customer catalog tree:
   * - real category IDs only (no virtual gender IDs)
   * - no name-based business cloning
   * - orphans / inactive-parent children omitted safely
   * - cycle + depth protected
   * - presentationImage resolved in batch
   */
  async getAllTree(childId = null) {
    const categories = await this.categoryRepository
      .createQueryBuilder('category')
      .select([
        'category.id',
        'category.parentId',
        'category.iconPath',
        'category.name',
        'category.gender',
        'category.displayOrder',
      ])
      .where({ status: CategoryStatus.active })
      .andWhere('category.id != 1')
      .orderBy('category.displayOrder', 'ASC')
      .addOrderBy('category.id', 'ASC')
      .getMany();

    const fullTree = buildCategoryTree(categories as any);

    if (childId) {
      return findCategoryParentsByChildId(fullTree, +childId).map((cat) => {
        const clone = { ...cat };
        delete clone.subCategories;
        return clone;
      });
    }

    const customerTree = prepareCustomerCatalogTree(categories as any);
    return this._withPresentationImages(customerTree, categories as any);
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
   * Batched presentation images for a flat category list (no N+1).
   */
  private async _attachFlatPresentationImages(categories: CategoryEntity[]) {
    if (!categories?.length) {
      return categories;
    }

    const imageMap = await this._resolvePresentationImageMap(categories as any);

    return categories.map((category) => ({
      ...category,
      presentationImage: imageMap.get(category.id) || category.iconPath || null,
      hasChildren: undefined,
    }));
  }

  /**
   * Attach batched presentationImage onto a customer tree.
   */
  private async _withPresentationImages(tree, flatCategories) {
    const imageMap = await this._resolvePresentationImageMap(flatCategories);
    const withDirect = attachPresentationImages(tree, imageMap);
    return inheritImagesFromDescendants(withDirect);
  }

  /**
   * One (or two) queries for all category cover images — never per-card.
   * Loads full active taxonomy so descendant inheritance works for hubs/lists.
   */
  private async _resolvePresentationImageMap(flatCategories) {
    const allActive = await this.categoryRepository
      .createQueryBuilder('category')
      .select(['category.id', 'category.parentId', 'category.iconPath'])
      .where({ status: CategoryStatus.active })
      .andWhere('category.id != 1')
      .getMany();

    const taxonomy = allActive.length > 0 ? allActive : flatCategories || [];

    const ids = taxonomy.map((c) => c.id);
    if (!ids.length) {
      return new Map<number, string | null>();
    }

    const covers = await this._fetchProductCoversForCategories(ids);
    const direct = resolveDirectPresentationImages(taxonomy as any, covers);
    return fillImagesFromDescendantCovers(taxonomy as any, direct, covers);
  }

  private async _fetchProductCoversForCategories(categoryIds: number[]) {
    if (!categoryIds.length) {
      return [];
    }

    // Pick one active product cover per categoryId in a single query.
    const rows = await this.categoryRepository.manager
      .createQueryBuilder()
      .select('p.categoryId', 'categoryId')
      .addSelect('pg.pathFile', 'pathFile')
      .from(ProductEntity, 'p')
      .innerJoin(
        ProductGalleryEntity,
        'pg',
        'pg.id = p.coverId AND pg.type = :galleryType',
        { galleryType: ProductGalleryType.photo },
      )
      .where('p.categoryId IN (:...categoryIds)', { categoryIds })
      .andWhere('p.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('p.status = :status', { status: ProductStatus.active })
      .andWhere('p.coverId IS NOT NULL')
      .orderBy('p.categoryId', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .getRawMany();

    // Keep first cover per categoryId
    const seen = new Set<number>();
    const result: { categoryId: number; pathFile: string }[] = [];
    for (const row of rows) {
      const categoryId = Number(row.categoryId);
      if (seen.has(categoryId)) {
        continue;
      }
      seen.add(categoryId);
      if (row.pathFile) {
        result.push({ categoryId, pathFile: row.pathFile });
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
    const candidates = await this.categoryRepository
      .createQueryBuilder('category')
      .select(['category.id', 'category.name'])
      .where('category.sourceName = :sourceName', { sourceName })
      .orderBy('category.id', 'ASC')
      .take(20)
      .getMany();

    const exist = candidates.find((row) => containsPersianScript(row.name));
    if (exist?.name) {
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
      .select([
        'category.id',
        'category.parentId',
        'category.gender',
        'category.displayOrder',
      ])
      .where({
        status: CategoryStatus.active,
      })
      .getMany();

    const groupedCategories = buildCategoryTree(
      subCategories as any,
      +parentId,
    );

    return this._extractSubIds(groupedCategories || []);
  }
}
