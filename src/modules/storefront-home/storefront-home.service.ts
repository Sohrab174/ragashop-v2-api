import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
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
  STOREFRONT_HOME_SECTION_KEYS,
  StorefrontHomeSectionKey,
} from './storefront-home.types';
import {
  campaignDestinationIssue,
  isLimitedHomeSectionKey,
  isWithinSchedule,
  mergeHomeConfigForPersistence,
  normalizeCampaignConfig,
  incompleteSlideDestinationMessages,
  normalizeCampaignSlides,
  normalizeCategoriesConfig,
  normalizeCategoryChaptersConfig,
  normalizeEditorialConfig,
  normalizeRailConfig,
  optionalStorefrontHref,
  parseJsonObject,
  resolveCampaignHref,
  sanitizeHomeUploadPath,
} from './storefront-home.validate';
import { finalizeVerifiedHomeUpload } from './home-image-upload';
import {
  signHomePreviewCredential,
  verifyHomePreviewCredential,
} from './home-preview-credential';

type HomePreviewSession = {
  userId: number;
  payload: PublicStorefrontHomeDto;
  expiresAt: number;
  createdAt: number;
  handoffNonce: string;
  handoffRedeemed: boolean;
};

/** Short-lived unpublished previews. Process memory only — never written to DB. */
const HOME_PREVIEW_TTL_MS = 5 * 60 * 1000;
const HOME_PREVIEW_MAX_GLOBAL = 48;
const HOME_PREVIEW_MAX_PER_USER = 5;
const homePreviewSessions = new Map<string, HomePreviewSession>();

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
    return this.buildPublicHomeFromRows(rows, now);
  }

  /**
   * Map Admin editor sections to the public homepage DTO without saving.
   * Uses the same eligibility filters and mapPublicSection as getPublicHome.
   */
  async mapAdminSectionsToPublic(
    sections: UpsertHomeSectionDto[],
    now = new Date(),
  ): Promise<PublicStorefrontHomeDto> {
    this.assertValidPreviewSections(sections);
    const rows = sections
      .map((section, index) => this.previewRowFromAdminSection(section, index))
      .sort((a, b) => {
        if (a.displayOrder !== b.displayOrder) {
          return a.displayOrder - b.displayOrder;
        }
        return a.id - b.id;
      });
    return this.buildPublicHomeFromRows(rows, now);
  }

  /**
   * Create a short-lived preview session from unsaved Admin state.
   * Caller must already have verified Admin JWT + storefront_home_read.
   * Returns a preview-only credential. It cannot authorize other Admin APIs.
   */
  async createHomePreviewSession(
    sections: UpsertHomeSectionDto[],
    userId: number,
  ): Promise<{
    token: string;
    credential: string;
    handoffNonce: string;
    expiresAt: string;
  }> {
    const uid = Number(userId);
    if (!Number.isFinite(uid) || uid <= 0) {
      this.error.unauthorized(['نشست مدیریت معتبر نیست']);
    }
    const secret = this.config.auth?.secret;
    if (!secret) {
      this.error.unauthorized(['پیکربندی امنیتی پیش‌نمایش موجود نیست']);
    }
    const payload = await this.mapAdminSectionsToPublic(sections);
    this.pruneExpiredPreviewSessions();
    this.enforcePreviewSessionLimits(uid);
    const token = randomBytes(32).toString('hex');
    const handoffNonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + HOME_PREVIEW_TTL_MS;
    homePreviewSessions.set(token, {
      userId: uid,
      payload,
      expiresAt,
      createdAt: Date.now(),
      handoffNonce,
      handoffRedeemed: false,
    });
    const credential = signHomePreviewCredential(
      {
        sid: token,
        sub: uid,
        exp: Math.floor(expiresAt / 1000),
        nonce: handoffNonce,
      },
      secret,
    );
    return {
      token,
      credential,
      handoffNonce,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /**
   * One-time handoff redeem. Marks the nonce used so a copied grant cannot
   * be replayed. Does not return homepage content.
   */
  redeemHomePreviewHandoff(token: string, credential: string, nonce: string): void {
    const session = this.requirePreviewCredential(token, credential, {
      requireRedeemed: false,
    });
    const presented = String(nonce || '').trim();
    if (!presented || presented !== session.handoffNonce || session.handoffRedeemed) {
      this.error.unauthorized(['دسترسی به پیش‌نمایش مجاز نیست']);
    }
    session.handoffRedeemed = true;
  }

  /**
   * Preview read. Requires a redeemed preview-only credential for this session.
   * Admin JWTs are not accepted here. Do not log the credential.
   */
  getHomePreviewSession(
    token: string,
    credential: string,
  ): PublicStorefrontHomeDto {
    const session = this.requirePreviewCredential(token, credential, {
      requireRedeemed: true,
    });
    return session.payload;
  }

  private requirePreviewCredential(
    token: string,
    credential: string,
    options: { requireRedeemed: boolean },
  ): HomePreviewSession {
    this.pruneExpiredPreviewSessions();
    const key = String(token || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(key)) {
      this.error.notFound(['پیش‌نمایش پیدا نشد یا منقضی شده است']);
    }
    const secret = this.config.auth?.secret;
    const claims = secret
      ? verifyHomePreviewCredential(credential, secret)
      : null;
    if (!claims || claims.sid !== key) {
      this.error.unauthorized(['دسترسی به پیش‌نمایش مجاز نیست']);
    }
    const session = homePreviewSessions.get(key);
    if (!session) {
      this.error.notFound(['پیش‌نمایش پیدا نشد یا منقضی شده است']);
    }
    if (session.expiresAt <= Date.now()) {
      homePreviewSessions.delete(key);
      this.error.notFound(['پیش‌نمایش پیدا نشد یا منقضی شده است']);
    }
    if (claims.sub !== session.userId || claims.nonce !== session.handoffNonce) {
      this.error.unauthorized(['دسترسی به پیش‌نمایش مجاز نیست']);
    }
    if (options.requireRedeemed && !session.handoffRedeemed) {
      this.error.unauthorized(['دسترسی به پیش‌نمایش مجاز نیست']);
    }
    return session;
  }

  /** Test helper — clears in-memory preview sessions. */
  clearHomePreviewSessionsForTests() {
    homePreviewSessions.clear();
  }

  /** Test helper — current in-memory session count. */
  countHomePreviewSessionsForTests() {
    return homePreviewSessions.size;
  }

  /** Test helper — force a session past TTL without waiting. */
  expireHomePreviewSessionForTests(token: string) {
    const session = homePreviewSessions.get(String(token || ''));
    if (session) session.expiresAt = Date.now() - 1;
  }

  private assertValidPreviewSections(sections: UpsertHomeSectionDto[]) {
    if (!Array.isArray(sections) || sections.length === 0) {
      this.error.unprocessableEntity(['حداقل یک سکشن لازم است']);
    }
    if (sections.length > STOREFRONT_HOME_SECTION_KEYS.length) {
      this.error.unprocessableEntity(['تعداد بخش‌های پیش‌نمایش بیش از حد مجاز است']);
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
  }

  private previewRowFromAdminSection(
    section: UpsertHomeSectionDto,
    index: number,
  ): StorefrontHomeSectionEntity {
    const config =
      section.config && typeof section.config === 'object' && !Array.isArray(section.config)
        ? section.config
        : {};
    return {
      id: index + 1,
      sectionKey: section.sectionKey,
      enabled: Boolean(section.enabled),
      displayOrder: Math.floor(Number(section.displayOrder) || 0),
      title:
        section.title == null || section.title === ''
          ? null
          : String(section.title).slice(0, 128),
      subtitle:
        section.subtitle == null || section.subtitle === ''
          ? null
          : String(section.subtitle).slice(0, 255),
      configJson: JSON.stringify(config),
      startAt: this.parseOptionalDate(section.startAt ?? null),
      endAt: this.parseOptionalDate(section.endAt ?? null),
      createdAt: new Date(0),
      updatedAt: null,
    } as StorefrontHomeSectionEntity;
  }

  private pruneExpiredPreviewSessions() {
    const now = Date.now();
    for (const [token, session] of homePreviewSessions) {
      if (session.expiresAt <= now) homePreviewSessions.delete(token);
    }
  }

  /** Drop oldest sessions when per-user or global caps are exceeded. */
  private enforcePreviewSessionLimits(userId: number) {
    const owned = [...homePreviewSessions.entries()]
      .filter(([, session]) => session.userId === userId)
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (owned.length >= HOME_PREVIEW_MAX_PER_USER) {
      const [oldestToken] = owned.shift();
      homePreviewSessions.delete(oldestToken);
    }
    while (homePreviewSessions.size >= HOME_PREVIEW_MAX_GLOBAL) {
      const oldest = [...homePreviewSessions.entries()].sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )[0];
      if (!oldest) break;
      homePreviewSessions.delete(oldest[0]);
    }
  }

  private async buildPublicHomeFromRows(
    rows: StorefrontHomeSectionEntity[],
    now: Date,
  ): Promise<PublicStorefrontHomeDto> {
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
        // Categories section uses canonical navigation IDs (same as storefront tree).
        const c = normalizeCategoriesConfig(cfg);
        for (const id of c.categoryIds ?? []) canonicalCategoryIdsNeeded.add(id);
        for (const p of c.presentation ?? []) {
          canonicalCategoryIdsNeeded.add(p.categoryId);
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
   * PUT /storefront/home/admin — upsert by sectionKey.
   * Known config fields are normalized; stored unknown keys are preserved.
   * Omitted config leaves the previous configJson untouched.
   * All section writes run in one DB transaction — no partial publish.
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
      if (
        section.sectionKey === 'campaign' &&
        section.config &&
        typeof section.config === 'object' &&
        !Array.isArray(section.config)
      ) {
        const destinationErrors = incompleteSlideDestinationMessages(
          section.config as Record<string, unknown>,
        );
        if (destinationErrors.length) {
          this.error.unprocessableEntity(destinationErrors);
        }
      }
      seen.add(section.sectionKey);
    }

    const now = new Date();
    await this.sectionRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(StorefrontHomeSectionEntity);
      for (const section of sections) {
        let row = await repo.findOne({
          where: { sectionKey: section.sectionKey },
        });

        if (!row) {
          row = repo.create({
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
        row.configJson = this.resolveConfigJsonForUpsert(
          section.sectionKey as StorefrontHomeSectionKey,
          section.config,
          row.configJson,
        );
        row.startAt = this.parseOptionalDate(section.startAt);
        row.endAt = this.parseOptionalDate(section.endAt);
        row.updatedAt = now;

        await repo.save(row);
      }
    });

    return this.getAdminHome();
  }

  /**
   * Persist config for one section without accepting client-invented keys.
   * - omitted/null config → keep previous JSON
   * - limited section `{}` → keep previous JSON
   * - explicit config → normalize known fields, keep previous unknowns
   */
  private resolveConfigJsonForUpsert(
    key: StorefrontHomeSectionKey,
    incoming: Record<string, unknown> | null | undefined,
    previousJson: string | null | undefined,
  ): string {
    if (incoming === undefined || incoming === null) {
      return previousJson == null || previousJson === '' ? '{}' : previousJson;
    }

    if (
      isLimitedHomeSectionKey(key) &&
      typeof incoming === 'object' &&
      !Array.isArray(incoming) &&
      Object.keys(incoming).length === 0
    ) {
      return previousJson == null || previousJson === '' ? '{}' : previousJson;
    }

    const previous = parseJsonObject(previousJson);
    const normalized = this.normalizeConfigForKey(key, incoming);
    return JSON.stringify(
      mergeHomeConfigForPersistence(key, normalized, previous),
    );
  }

  /**
   * POST /storefront/home/image/admin — returns public-safe relative path.
   * Verifies raster contents; derives extension from detected format.
   */
  async saveUploadedImage(file: Express.Multer.File | undefined) {
    if (!file?.filename || !file?.path) {
      this.error.unprocessableEntity(['فایل تصویر الزامی است']);
    }
    let verified: { filename: string };
    try {
      verified = await finalizeVerifiedHomeUpload({
        path: file.path,
        filename: file.filename,
        destination: file.destination,
      });
    } catch {
      this.error.unprocessableEntity([
        'فقط تصویرهای JPEG، PNG یا WebP معتبر پذیرفته می‌شوند',
      ]);
    }
    const pathFile = `/home/${verified.filename}`;
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
      case 'campaign': {
        const config = normalizeCampaignConfig(raw) as Record<string, unknown>;
        const slides = normalizeCampaignSlides(raw);
        if (slides !== undefined) config.slides = slides;
        return config;
      }
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
        const managed = normalizeCampaignSlides(cfg);
        if (managed !== undefined) {
          base.hero.slideMode = 'managed';
          base.hero.slides = managed
            .filter(
              (slide) =>
                slide.enabled &&
                Boolean(slide.desktopImagePath || slide.preferredProductId) &&
                campaignDestinationIssue(
                  slide as unknown as Record<string, unknown>,
                  'اسلاید',
                ) == null,
            )
            .map((slide) => {
              const slideProductId =
                slide.preferredProductId != null &&
                activeProductIds.has(slide.preferredProductId)
                  ? slide.preferredProductId
                  : undefined;
              return {
                id: slide.id,
                order: slide.order,
                eyebrow: slide.eyebrow,
                title: slide.title,
                subtitle: slide.subtitle,
                ctaLabel: slide.ctaLabel?.trim() || 'مشاهده',
                ctaHref: resolveCampaignHref({
                  ...slide,
                  preferredProductId: slideProductId,
                }),
                desktopImageUrl: this.toStaticUrl(slide.desktopImagePath),
                mobileImageUrl: this.toStaticUrl(slide.mobileImagePath),
                objectPositionDesktop: slide.objectPositionDesktop,
                objectPositionMobile: slide.objectPositionMobile,
                preferredProductId: slideProductId,
              };
            });
        }
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
        // Filter against canonical IDs only — never silently map source→canonical.
        const c = normalizeCategoriesConfig(cfg);
        const categoryIds = (c.categoryIds ?? []).filter((id) =>
          activeCanonicalCategoryIds.has(id),
        );
        const presentation = (c.presentation ?? [])
          .filter((p) => activeCanonicalCategoryIds.has(p.categoryId))
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

  /**
   * Read-only check for Admin previews.
   * Uses filterActiveProductIds unchanged — no IN_SCOPE and no config writes.
   */
  async findPublicHomepageEligibleProductIds(
    idsParam?: string | string[],
  ): Promise<{ eligibleIds: number[] }> {
    const ids = this.parseHomepageEligibilityIds(idsParam);
    const active = await this.filterActiveProductIds(ids);
    return { eligibleIds: ids.filter((id) => active.has(id)) };
  }

  private parseHomepageEligibilityIds(idsParam?: string | string[]): number[] {
    const raw = Array.isArray(idsParam) ? idsParam.join(',') : String(idsParam ?? '');
    if (!raw.trim()) return [];
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const part of raw.split(/[,\s]+/)) {
      if (!part) continue;
      if (!/^[1-9]\d*$/.test(part)) {
        this.error.unprocessableEntity(['شناسه محصول نامعتبر است']);
      }
      const id = Number(part);
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length > 48) {
      this.error.unprocessableEntity(['حداکثر ۴۸ محصول در هر درخواست مجاز است']);
    }
    return ids;
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
