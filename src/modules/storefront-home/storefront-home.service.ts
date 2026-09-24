import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ErrorService } from '../../error/error.service';
import { ConfigurationService } from '../../config/configuration.service';
import { ProductEntity, ProductStatus } from '../product/entities/product.entity';
import { CategoryEntity, CategoryStatus } from '../category/entities/category.entity';
import {
  CanonicalCategoryEntity,
  CanonicalCategoryStatus,
} from '../catalog/entities/canonical-category.entity';
import { discoveryEligibilitySql } from '../product/discovery-eligibility';
import { StorefrontHomeSectionEntity } from './entities/storefront-home-section.entity';
import { UpsertHomeSectionDto } from './dto/upsert-storefront-home.dto';
import {
  isStorefrontHomeSectionKey,
  PublicHomeSectionDto,
  PublicStorefrontHomeDto,
  StorefrontHomeSectionKey,
} from './storefront-home.types';
import {
  isWithinSchedule,
  normalizeCampaignConfig,
  normalizeCategoriesConfig,
  normalizeCategoryChaptersConfig,
  normalizeEditorialConfig,
  normalizeRailConfig,
  optionalStorefrontHref,
  parseJsonObject,
  resolveCampaignHref,
  sanitizeHomeUploadPath,
} from './storefront-home.validate';

@Injectable()
export class StorefrontHomeService {
  constructor(
    @InjectRepository(StorefrontHomeSectionEntity)
    private readonly sectionRepo: Repository<StorefrontHomeSectionEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepo: Repository<CategoryEntity>,
    @InjectRepository(CanonicalCategoryEntity)
    private readonly canonicalCategoryRepo: Repository<CanonicalCategoryEntity>,
    private readonly error: ErrorService,
    private readonly config: ConfigurationService,
  ) {}

  /**
   * GET /storefront/home — presentation-only public contract.
   */
  async getPublicHome(now = new Date()): Promise<PublicStorefrontHomeDto> {
    const rows = (
      await this.sectionRepo.find({
        order: { displayOrder: 'ASC', id: 'ASC' },
      })
    ).slice().sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }
      return a.id - b.id;
    });

    const productIdsNeeded = new Set<number>();
    const categoryIdsNeeded = new Set<number>();
    const canonicalCategoryIdsNeeded = new Set<number>();
    for (const row of rows) {
      if (!isStorefrontHomeSectionKey(row.sectionKey)) continue;
      const cfg = parseJsonObject(row.configJson);
      if (row.sectionKey === 'campaign') {
        const c = normalizeCampaignConfig(cfg);
        if (c.preferredProductId) productIdsNeeded.add(c.preferredProductId);
      } else if (row.sectionKey === 'newest' || row.sectionKey === 'discounts') {
        for (const id of normalizeRailConfig(cfg).productIds ?? []) {
          productIdsNeeded.add(id);
        }
      } else if (row.sectionKey === 'categories') {
        const c = normalizeCategoriesConfig(cfg);
        for (const id of c.categoryIds ?? []) categoryIdsNeeded.add(id);
        for (const p of c.presentation ?? []) {
          categoryIdsNeeded.add(p.categoryId);
          if (p.preferredProductId) productIdsNeeded.add(p.preferredProductId);
        }
      } else if (row.sectionKey === 'editorial_promo') {
        const c = normalizeEditorialConfig(cfg);
        if (c.preferredProductId) productIdsNeeded.add(c.preferredProductId);
        for (const id of c.productIds ?? []) productIdsNeeded.add(id);
      } else if (row.sectionKey === 'category_chapters') {
        const c = normalizeCategoryChaptersConfig(cfg);
        for (const chapter of c.chapters ?? []) {
          canonicalCategoryIdsNeeded.add(chapter.categoryId);
          if (chapter.preferredProductId) {
            productIdsNeeded.add(chapter.preferredProductId);
          }
          for (const id of chapter.productIds ?? []) productIdsNeeded.add(id);
        }
      } else if (row.sectionKey === 'category_spotlight') {
        /* limit only */
      }
    }

    const [activeProductIds, activeCategoryIds, activeCanonicalCategoryIds] =
      await Promise.all([
        this.filterActiveProductIds([...productIdsNeeded]),
        this.filterActiveCategoryIds([...categoryIdsNeeded]),
        this.filterActiveCanonicalCategoryIds([...canonicalCategoryIdsNeeded]),
      ]);

    const sections: PublicHomeSectionDto[] = [];
    for (const row of rows) {
      if (!isStorefrontHomeSectionKey(row.sectionKey)) continue;
      const scheduled = isWithinSchedule(row.startAt, row.endAt, now);
      const enabled = Boolean(row.enabled) && scheduled;
      const mapped = this.mapPublicSection(
        row,
        enabled,
        activeProductIds,
        activeCategoryIds,
        activeCanonicalCategoryIds,
        now,
      );
      if (mapped) sections.push(mapped);
    }

    return { sections };
  }

  /**
   * GET /storefront/home/admin — full editable config (no public image resolve).
   */
  async getAdminHome() {
    const rows = await this.sectionRepo.find({
      order: { displayOrder: 'ASC', id: 'ASC' },
    });

    return {
      sections: rows
        .filter((row) => isStorefrontHomeSectionKey(row.sectionKey))
        .map((row) => ({
          id: row.id,
          sectionKey: row.sectionKey as StorefrontHomeSectionKey,
          enabled: Boolean(row.enabled),
          displayOrder: row.displayOrder,
          title: row.title,
          subtitle: row.subtitle,
          config: parseJsonObject(row.configJson),
          startAt: row.startAt,
          endAt: row.endAt,
          updatedAt: row.updatedAt,
        })),
    };
  }

  /**
   * PUT /storefront/home/admin — upsert by sectionKey; rejects unknown keys.
   */
  async upsertAdminHome(sections: UpsertHomeSectionDto[]) {
    if (!Array.isArray(sections) || sections.length === 0) {
      this.error.unprocessableEntity(['حداقل یک سکشن لازم است']);
    }

    const seen = new Set<string>();
    for (const section of sections) {
      if (!isStorefrontHomeSectionKey(section.sectionKey)) {
        this.error.unprocessableEntity([
          `کلید سکشن نامعتبر: ${section.sectionKey}`,
        ]);
      }
      if (seen.has(section.sectionKey)) {
        this.error.unprocessableEntity([
          `کلید سکشن تکراری: ${section.sectionKey}`,
        ]);
      }
      seen.add(section.sectionKey);
    }

    const now = new Date();
    for (const section of sections) {
      const configJson = JSON.stringify(
        this.normalizeConfigForKey(
          section.sectionKey as StorefrontHomeSectionKey,
          section.config ?? {},
        ),
      );

      let row = await this.sectionRepo.findOne({
        where: { sectionKey: section.sectionKey },
      });

      if (!row) {
        row = this.sectionRepo.create({
          sectionKey: section.sectionKey,
          createdAt: now,
        });
      }

      row.enabled = Boolean(section.enabled);
      row.displayOrder = Math.floor(Number(section.displayOrder) || 0);
      row.title =
        section.title == null || section.title === ''
          ? null
          : String(section.title).slice(0, 128);
      row.subtitle =
        section.subtitle == null || section.subtitle === ''
          ? null
          : String(section.subtitle).slice(0, 255);
      row.configJson = configJson;
      row.startAt = this.parseOptionalDate(section.startAt);
      row.endAt = this.parseOptionalDate(section.endAt);
      row.updatedAt = now;

      await this.sectionRepo.save(row);
    }

    return this.getAdminHome();
  }

  /**
   * POST /storefront/home/image/admin — returns public-safe relative path.
   */
  async saveUploadedImage(file: Express.Multer.File | undefined) {
    if (!file?.filename) {
      this.error.unprocessableEntity(['فایل تصویر الزامی است']);
    }
    const pathFile = `/home/${file.filename}`;
    const safe = sanitizeHomeUploadPath(pathFile);
    if (!safe) {
      this.error.unprocessableEntity(['مسیر تصویر نامعتبر است']);
    }
    return {
      path: safe,
      url: this.toStaticUrl(safe),
    };
  }

  private normalizeConfigForKey(
    key: StorefrontHomeSectionKey,
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (key) {
      case 'campaign':
        return normalizeCampaignConfig(raw) as Record<string, unknown>;
      case 'newest':
      case 'discounts':
        return normalizeRailConfig(raw) as Record<string, unknown>;
      case 'categories':
        return normalizeCategoriesConfig(raw) as Record<string, unknown>;
      case 'editorial_promo':
        return normalizeEditorialConfig(raw) as Record<string, unknown>;
      case 'category_chapters':
        return normalizeCategoryChaptersConfig(raw) as Record<string, unknown>;
      case 'category_spotlight': {
        const limit = Number(raw.limit);
        return {
          limit:
            Number.isFinite(limit) && limit > 0
              ? Math.min(Math.floor(limit), 24)
              : 6,
        };
      }
      default:
        return {};
    }
  }

  private mapPublicSection(
    row: StorefrontHomeSectionEntity,
    enabled: boolean,
    activeProductIds: Set<number>,
    activeCategoryIds: Set<number>,
    activeCanonicalCategoryIds: Set<number>,
    now: Date,
  ): PublicHomeSectionDto | null {
    const key = row.sectionKey as StorefrontHomeSectionKey;
    const base: PublicHomeSectionDto = {
      key,
      enabled,
      order: row.displayOrder,
      title: row.title ?? undefined,
      subtitle: row.subtitle ?? undefined,
    };

    const cfg = parseJsonObject(row.configJson);

    switch (key) {
      case 'campaign': {
        const c = normalizeCampaignConfig(cfg);
        const preferredProductId =
          c.preferredProductId != null &&
          activeProductIds.has(c.preferredProductId)
            ? c.preferredProductId
            : undefined;
        base.hero = {
          eyebrow: c.eyebrow,
          title: row.title?.trim() || 'RagaShop',
          subtitle: row.subtitle ?? undefined,
          ctaLabel: c.ctaLabel?.trim() || 'مشاهده',
          ctaHref: resolveCampaignHref({ ...c, preferredProductId }),
          desktopImageUrl: this.toStaticUrl(c.desktopImagePath),
          mobileImageUrl: this.toStaticUrl(c.mobileImagePath),
          objectPositionDesktop: c.objectPositionDesktop,
          objectPositionMobile: c.objectPositionMobile,
          preferredProductId,
        };
        return base;
      }
      case 'newest':
      case 'discounts': {
        const r = normalizeRailConfig(cfg);
        const source =
          r.source ?? (key === 'discounts' ? 'discount' : 'newest');
        const productIds = (r.productIds ?? []).filter((id) =>
          activeProductIds.has(id),
        );
        base.rail = {
          source:
            source === 'curated' && productIds.length === 0
              ? r.fallbackSource ??
                (key === 'discounts' ? 'discount' : 'newest')
              : source,
          limit: r.limit ?? 12,
          seeAllLabel: r.seeAllLabel,
          seeAllHref: optionalStorefrontHref(r.seeAllHref),
          productIds,
        };
        return base;
      }
      case 'categories': {
        const c = normalizeCategoriesConfig(cfg);
        const categoryIds = (c.categoryIds ?? []).filter((id) =>
          activeCategoryIds.has(id),
        );
        const presentation = (c.presentation ?? [])
          .filter((p) => activeCategoryIds.has(p.categoryId))
          .map((p) => ({
            categoryId: p.categoryId,
            imageUrl: this.toStaticUrl(p.imagePath),
            objectPosition: p.objectPosition,
            ...(p.preferredProductId != null &&
            activeProductIds.has(p.preferredProductId)
              ? { preferredProductId: p.preferredProductId }
              : {}),
          }));
        base.categories = {
          limit: c.limit ?? 8,
          categoryIds,
          presentation,
        };
        return base;
      }
      case 'editorial_promo': {
        const c = normalizeEditorialConfig(cfg);
        const preferredProductId =
          c.preferredProductId != null &&
          activeProductIds.has(c.preferredProductId)
            ? c.preferredProductId
            : undefined;
        const productIds = (c.productIds ?? []).filter((id) =>
          activeProductIds.has(id),
        );
        base.editorial = {
          title: row.title ?? undefined,
          subtitle: row.subtitle ?? undefined,
          ctaLabel: c.ctaLabel,
          ctaHref: optionalStorefrontHref(c.ctaHref),
          imageUrl: this.toStaticUrl(c.desktopImagePath),
          objectPosition: c.objectPosition,
          preferredProductId,
          productIds,
        };
        return base;
      }
      case 'category_spotlight': {
        const limit = Number(cfg.limit);
        base.spotlight = {
          limit:
            Number.isFinite(limit) && limit > 0
              ? Math.min(Math.floor(limit), 24)
              : 6,
        };
        return base;
      }
      case 'category_chapters': {
        const c = normalizeCategoryChaptersConfig(cfg);
        const chapters = (c.chapters ?? [])
          .filter((chapter) =>
            activeCanonicalCategoryIds.has(chapter.categoryId),
          )
          .map((chapter, index) => {
            const productIds = (chapter.productIds ?? []).filter((id) =>
              activeProductIds.has(id),
            );
            const preferredProductId =
              chapter.preferredProductId != null &&
              activeProductIds.has(chapter.preferredProductId)
                ? chapter.preferredProductId
                : undefined;
            const chapterStart =
              chapter.startAt && !Number.isNaN(Date.parse(chapter.startAt))
                ? new Date(chapter.startAt)
                : null;
            const chapterEnd =
              chapter.endAt && !Number.isNaN(Date.parse(chapter.endAt))
                ? new Date(chapter.endAt)
                : null;
            const chapterScheduled = isWithinSchedule(
              chapterStart,
              chapterEnd,
              now,
            );
            const source =
              chapter.source === 'curated' && productIds.length === 0
                ? 'newest'
                : (chapter.source ?? 'newest');
            return {
              enabled: chapter.enabled !== false && chapterScheduled,
              order: chapter.order ?? index + 1,
              categoryId: chapter.categoryId,
              title: chapter.title,
              subtitle: chapter.subtitle,
              imageUrl: this.toStaticUrl(chapter.imagePath),
              preferredProductId,
              source,
              productIds,
              limit: chapter.limit ?? 8,
              ctaLabel: chapter.ctaLabel,
              ctaHref: optionalStorefrontHref(chapter.ctaHref),
              startAt: chapter.startAt,
              endAt: chapter.endAt,
              surfaceTone: chapter.surfaceTone,
            };
          })
          .sort((a, b) => a.order - b.order);
        base.categoryChapters = {
          limit: c.limit ?? 6,
          chapters,
        };
        return base;
      }
      case 'quick_guide':
      case 'paste_link':
      case 'link_shopping':
      case 'featured_brands':
        return base;
      default:
        return null;
    }
  }

  private async filterActiveProductIds(ids: number[]): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const rows = await this.productRepo
      .createQueryBuilder('product')
      .select(['product.id'])
      .where('product.id IN (:...ids)', { ids })
      .andWhere('product.isDeleted = 0')
      .andWhere('product.status = :status', { status: ProductStatus.active })
      .andWhere(discoveryEligibilitySql('product'))
      .getMany();
    return new Set(rows.map((r) => r.id));
  }

  private async filterActiveCategoryIds(ids: number[]): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const rows = await this.categoryRepo.find({
      where: { id: In(ids), status: CategoryStatus.active },
      select: ['id'],
    });
    return new Set(rows.map((r) => r.id));
  }

  /** Category chapters reference canonical taxonomy (storefront navigation). */
  private async filterActiveCanonicalCategoryIds(
    ids: number[],
  ): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const rows = await this.canonicalCategoryRepo.find({
      where: { id: In(ids), status: CanonicalCategoryStatus.active },
      select: ['id'],
    });
    return new Set(rows.map((r) => r.id));
  }

  private toStaticUrl(path: string | undefined | null): string | null {
    const safe = sanitizeHomeUploadPath(path ?? undefined);
    if (!safe) return null;
    const base = (this.config.app.apiBaseUrl || '').replace(/\/$/, '');
    // common static route: /static/:path/:filename → uploads/{path}/{filename}
    const withoutSlash = safe.replace(/^\//, '');
    const [folder, ...rest] = withoutSlash.split('/');
    const filename = rest.join('/');
    if (!folder || !filename) return null;
    return `${base}/static/${folder}/${filename}`;
  }

  private parseOptionalDate(value?: string | null): Date | null {
    if (value == null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
}
