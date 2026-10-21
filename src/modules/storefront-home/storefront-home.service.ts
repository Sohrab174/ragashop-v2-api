import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { EntityManager, In, Repository } from 'typeorm';
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
import { StorefrontHomeSectionInstanceEntity } from './entities/storefront-home-section-instance.entity';
import { UpsertHomeInstanceDto, UpsertHomeSectionDto } from './dto/upsert-storefront-home.dto';
import {
  HOME_INSTANCE_EDITOR_KEYS,
  HOME_LAYOUT_MARKER_KEY,
  HOME_LAYOUT_SECTION_TYPE,
  HomeRepeatableSectionType,
  normalizeHomeArrangement,
  NormalizedHomeInstance,
} from './storefront-home.instances';
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
  normalizeCategoryChaptersList,
  normalizeEditorialConfig,
  normalizeFeaturedBrandsConfig,
  normalizeRailConfig,
  normalizeSiteFooterConfig,
  normalizeSiteHeaderConfig,
  normalizeSiteIntroConfig,
  optionalStorefrontHref,
  parseJsonObject,
  resolveCampaignHref,
  sanitizeHomeUploadPath,
} from './storefront-home.validate';
import { finalizeVerifiedHomeUpload } from './home-image-upload';
import {
  finalizeHomeMasterUpload,
  isHomeMasterProfile,
  parseFocalPoint,
  recropFromRetainedMaster,
  sanitizeHomeMasterPath,
} from './home-master-image';
import {
  signHomePreviewCredential,
  verifyHomePreviewCredential,
} from './home-preview-credential';
import { HomeImageAccessService } from './home-image-access.service';
import { collectHomeImagePathsFromValue } from './home-image-retention';

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

type AdminArrangementInstance = {
  instanceKey: string;
  sectionType: string;
  enabled: boolean;
  displayOrder: number;
  title: string | null;
  subtitle: string | null;
  config: Record<string, unknown>;
};

@Injectable()
export class StorefrontHomeService {
  /** Overlapping publishes run one at a time so their transactions cannot interleave. */
  private homepagePublishTail: Promise<void> = Promise.resolve();

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
    private readonly homeImageAccess: HomeImageAccessService,
    @Optional()
    @InjectRepository(StorefrontHomeSectionInstanceEntity)
    private readonly instanceRepo?: Repository<StorefrontHomeSectionInstanceEntity>,
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
    const layoutRows = this.instanceRepo
      ? await this.instanceRepo.find({
          order: { displayOrder: 'ASC', id: 'ASC' },
        })
      : undefined;
    return this.buildPublicHomeFromRows(rows, now, layoutRows);
  }

  /**
   * Map Admin editor sections to the public homepage DTO without saving.
   * Uses the same eligibility filters and mapPublicSection as getPublicHome.
   */
  async mapAdminSectionsToPublic(
    sections: UpsertHomeSectionDto[],
    now = new Date(),
    instances?: UpsertHomeInstanceDto[],
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
    const layoutRows = Array.isArray(instances)
      ? this.previewLayoutRows(instances)
      : undefined;
    return this.buildPublicHomeFromRows(rows, now, layoutRows);
  }

  /**
   * Create a short-lived preview session from unsaved Admin state.
   * Caller must already have verified Admin JWT + storefront_home_read.
   * Returns a preview-only credential. It cannot authorize other Admin APIs.
   */
  async createHomePreviewSession(
    sections: UpsertHomeSectionDto[],
    userId: number,
    instances?: UpsertHomeInstanceDto[],
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
    const mapped = await this.mapAdminSectionsToPublic(
      sections,
      new Date(),
      instances,
    );
    const payload = this.signDraftUrlsInPublicHomeDto(mapped);
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
   * Replace the merchandising payload of an existing preview session.
   * Does not rotate the token, credential, or iframe URL, and does not publish.
   */
  async replaceHomePreviewSession(
    token: string,
    sections: UpsertHomeSectionDto[],
    userId: number,
    instances?: UpsertHomeInstanceDto[],
  ): Promise<{ ok: true }> {
    const uid = Number(userId);
    if (!Number.isFinite(uid) || uid <= 0) {
      this.error.unauthorized(['نشست مدیریت معتبر نیست']);
    }
    this.pruneExpiredPreviewSessions();
    const key = String(token || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(key)) {
      this.error.notFound(['پیش‌نمایش پیدا نشد یا منقضی شده است']);
    }
    const session = homePreviewSessions.get(key);
    if (!session || session.expiresAt <= Date.now() || session.userId !== uid) {
      this.error.notFound(['پیش‌نمایش پیدا نشد یا منقضی شده است']);
    }
    const mapped = await this.mapAdminSectionsToPublic(
      sections,
      new Date(),
      instances,
    );
    session.payload = this.signDraftUrlsInPublicHomeDto(mapped);
    return { ok: true };
  }

  /**
   * Handoff redeem. The same nonce may be presented again for the same
   * session (iframe cookie retries). A different nonce cannot replay.
   * Does not return homepage content.
   */
  redeemHomePreviewHandoff(token: string, credential: string, nonce: string): void {
    const session = this.requirePreviewCredential(token, credential, {
      requireRedeemed: false,
    });
    const presented = String(nonce || '').trim();
    if (!presented || presented !== session.handoffNonce) {
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

  /**
   * Dry-run image retention report — never deletes files.
   * Inventories section + instance configJson and active preview sessions.
   */
  async reportHomeImageRetentionDryRun() {
    const { buildHomeImageRetentionDryRunReport } = await import(
      './home-image-retention'
    );
    const sections = await this.sectionRepo.find();
    const instances = this.instanceRepo
      ? await this.instanceRepo.find()
      : [];
    this.pruneExpiredPreviewSessions();
    const previewSessionPayloads = [...homePreviewSessions.entries()].map(
      ([token, session]) => ({
        tokenHint: token.slice(0, 8),
        payload: session.payload,
      }),
    );
    return buildHomeImageRetentionDryRunReport({
      sectionConfigs: sections.map((row) => ({
        key: row.sectionKey,
        config: parseJsonObject(row.configJson),
      })),
      instanceConfigs: instances.map((row) => ({
        key: row.instanceKey,
        config: parseJsonObject(row.configJson),
      })),
      previewSessionPayloads,
    });
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
    layoutRows?: StorefrontHomeSectionInstanceEntity[],
  ): Promise<PublicStorefrontHomeDto> {
    const publishedInstances = this.publishedContentInstances(layoutRows);
    const instanceSectionRows = (publishedInstances ?? []).map((row, index) =>
      this.instanceToSectionRow(row, index),
    );
    const productIdsNeeded = new Set<number>();
    const categoryIdsNeeded = new Set<number>();
    const canonicalCategoryIdsNeeded = new Set<number>();
    for (const row of [...rows, ...instanceSectionRows]) {
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

    if (!publishedInstances) return { sections };
    const instances = publishedInstances
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id)
      .flatMap((row) => {
        const section = this.mapPublicSection(
          this.instanceToSectionRow(row, 0),
          Boolean(row.enabled),
          activeProductIds,
          activeCategoryIds,
          activeCanonicalCategoryIds,
          now,
        );
        if (!section) return [];
        return [
          {
            instanceKey: row.instanceKey,
            sectionType: row.sectionType,
            enabled: Boolean(row.enabled),
            order: row.displayOrder,
            title: row.title ?? undefined,
            subtitle: row.subtitle ?? undefined,
            section,
          },
        ];
      });
    return { sections, layout: { managed: true, instances } };
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
      arrangement: await this.readAdminArrangement(),
    };
  }

  /**
   * PUT /storefront/home/admin — upsert by sectionKey.
   * Known config fields are normalized; stored unknown keys are preserved.
   * Omitted config leaves the previous configJson untouched.
   * Sections and, when `instances` is present, the arrangement commit in one
   * transaction. Omitted `instances` leaves the published arrangement as it is.
   * An empty `instances` array publishes an intentional empty arrangement.
   */
  async upsertAdminHome(
    sections: UpsertHomeSectionDto[],
    instances?: UpsertHomeInstanceDto[],
  ) {
    this.assertUpsertSections(sections);
    const arrangement =
      instances === undefined ? null : this.requireArrangement(instances);
    const now = new Date();
    await this.enqueueHomepagePublish(() =>
      this.sectionRepo.manager.transaction(async (manager) => {
        if (arrangement) {
          await this.writeArrangement(manager, arrangement, now);
        }
        await this.writeSections(manager, sections, now);
      }),
    );
    this.homeImageAccess.invalidatePublishedAllowlist();
    return this.getAdminHome();
  }

  private assertUpsertSections(sections: UpsertHomeSectionDto[]) {
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
  }

  private async writeSections(
    manager: EntityManager,
    sections: UpsertHomeSectionDto[],
    now: Date,
  ) {
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
  }

  private enqueueHomepagePublish<T>(work: () => Promise<T>): Promise<T> {
    const run = this.homepagePublishTail.then(() => work());
    this.homepagePublishTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
      url: this.toStaticUrl(safe, 'draft'),
    };
  }

  /**
   * POST /storefront/home/image/admin/master — retain master + desktop/mobile WebP.
   * Preserves the legacy single-file upload above.
   */
  async saveMasterUploadedImage(
    file: Express.Multer.File | undefined,
    body: {
      profile?: string;
      focusDesktopX?: string | number;
      focusDesktopY?: string | number;
      focusMobileX?: string | number;
      focusMobileY?: string | number;
    } = {},
  ) {
    if (!file?.filename || !file?.path) {
      this.error.unprocessableEntity(['فایل تصویر الزامی است']);
    }
    const profile = isHomeMasterProfile(body.profile) ? body.profile : 'hero';
    const focusDesktop = parseFocalPoint(body.focusDesktopX, body.focusDesktopY);
    const focusMobile = parseFocalPoint(
      body.focusMobileX ?? body.focusDesktopX,
      body.focusMobileY ?? body.focusDesktopY,
      focusDesktop,
    );
    let result: Awaited<ReturnType<typeof finalizeHomeMasterUpload>>;
    try {
      result = await finalizeHomeMasterUpload({
        path: file.path,
        destination: file.destination,
        profile,
        focusDesktop,
        focusMobile,
      });
    } catch (error) {
      this.throwMasterProcessError(error);
    }
    return this.mapMasterProcessResult(result);
  }

  /**
   * POST /storefront/home/image/admin/recrop — regenerate crops from retained master.
   */
  async recropMasterImage(
    body: {
      masterPath?: string;
      profile?: string;
      focusDesktopX?: string | number;
      focusDesktopY?: string | number;
      focusMobileX?: string | number;
      focusMobileY?: string | number;
      focusMobileWideX?: string | number;
      focusMobileWideY?: string | number;
      compositionDesktop?: Record<string, unknown>;
      compositionMobile?: Record<string, unknown>;
      compositionMobileWide?: Record<string, unknown>;
    } = {},
  ) {
    const masterPath = sanitizeHomeMasterPath(body.masterPath);
    if (!masterPath) {
      this.error.unprocessableEntity(['مسیر تصویر اصلی نامعتبر است']);
    }
    const profile = isHomeMasterProfile(body.profile) ? body.profile : 'hero';
    const focusDesktop = parseFocalPoint(body.focusDesktopX, body.focusDesktopY);
    const focusMobile = parseFocalPoint(
      body.focusMobileX ?? body.focusDesktopX,
      body.focusMobileY ?? body.focusDesktopY,
      focusDesktop,
    );
    const focusMobileWide = parseFocalPoint(
      body.focusMobileWideX ?? body.focusMobileX ?? body.focusDesktopX,
      body.focusMobileWideY ?? body.focusMobileY ?? body.focusDesktopY,
      focusMobile,
    );
    let result: Awaited<ReturnType<typeof recropFromRetainedMaster>>;
    try {
      result = await recropFromRetainedMaster({
        masterPath,
        profile,
        focusDesktop,
        focusMobile,
        focusMobileWide,
        compositionDesktop: body.compositionDesktop,
        compositionMobile: body.compositionMobile,
        compositionMobileWide: body.compositionMobileWide,
      });
    } catch (error) {
      this.throwMasterProcessError(error);
    }
    return this.mapMasterProcessResult(result);
  }

  private throwMasterProcessError(error: unknown): never {
    const code = error instanceof Error ? error.message : '';
    if (code === 'OVERSIZED_UPLOAD') {
      this.error.unprocessableEntity(['حجم تصویر اصلی بیش از حد مجاز است']);
    }
    if (
      code === 'UNSUPPORTED_TYPE' ||
      code === 'CORRUPT_OR_UNSUPPORTED' ||
      code === 'EMPTY_IMAGE'
    ) {
      this.error.unprocessableEntity([
        'فقط تصویرهای JPEG، PNG یا WebP معتبر پذیرفته می‌شوند',
      ]);
    }
    if (
      code === 'IMAGE_TOO_SMALL' ||
      code === 'IMAGE_DIMENSIONS_EXCEEDED' ||
      code === 'IMAGE_PIXELS_EXCEEDED'
    ) {
      this.error.unprocessableEntity(['ابعاد تصویر برای پردازش مناسب نیست']);
    }
    if (code === 'INVALID_MASTER_PATH' || code === 'MASTER_NOT_FOUND') {
      this.error.unprocessableEntity(['تصویر اصلی برای برش مجدد پیدا نشد']);
    }
    this.error.unprocessableEntity(['پردازش تصویر اصلی ناموفق بود']);
  }

  private mapMasterProcessResult(
    result: Awaited<ReturnType<typeof finalizeHomeMasterUpload>>,
  ) {
    const desktopPath = sanitizeHomeUploadPath(result.desktopPath);
    const mobilePath = sanitizeHomeUploadPath(result.mobilePath);
    const masterPreviewPath = sanitizeHomeUploadPath(result.masterPreviewPath);
    const mobileWidePath = result.mobileWidePath
      ? sanitizeHomeUploadPath(result.mobileWidePath)
      : undefined;
    const masterPath = sanitizeHomeMasterPath(result.masterPath);
    if (!desktopPath || !mobilePath || !masterPath || !masterPreviewPath) {
      this.error.unprocessableEntity(['مسیر تصویر نامعتبر است']);
    }
    return {
      profile: result.profile,
      masterPath,
      masterPreviewPath,
      masterPreviewUrl: this.toStaticUrl(masterPreviewPath, 'draft'),
      desktopPath,
      mobilePath,
      mobileWidePath,
      desktopUrl: this.toStaticUrl(desktopPath, 'draft'),
      mobileUrl: this.toStaticUrl(mobilePath, 'draft'),
      mobileWideUrl: mobileWidePath
        ? this.toStaticUrl(mobileWidePath, 'draft')
        : null,
      desktopWidth: result.desktopWidth,
      desktopHeight: result.desktopHeight,
      mobileWidth: result.mobileWidth,
      mobileHeight: result.mobileHeight,
      mobileWideWidth: result.mobileWideWidth,
      mobileWideHeight: result.mobileWideHeight,
      path: desktopPath,
      url: this.toStaticUrl(desktopPath, 'draft'),
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
      case 'paste_link': {
        const ctaLabel = String(raw.ctaLabel || '').trim().slice(0, 80);
        return ctaLabel ? { ctaLabel } : {};
      }
      case 'featured_brands':
        return normalizeFeaturedBrandsConfig(raw);
      case 'site_header':
        return normalizeSiteHeaderConfig(raw);
      case 'site_intro':
        return normalizeSiteIntroConfig(raw);
      case 'site_footer':
        return normalizeSiteFooterConfig(raw);
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
          imageFitDesktop: c.compositionDesktop?.fit,
          imageFitMobile: c.compositionMobile?.fit,
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
                imageFitDesktop: slide.compositionDesktop?.fit,
                imageFitMobile: slide.compositionMobile?.fit,
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
            ...(p.label ? { label: p.label } : {}),
            ...(p.hidden ? { hidden: true } : {}),
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
        const managedChapters = normalizeCategoryChaptersList(cfg);
        const chapters = (managedChapters ?? [])
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
            const source = chapter.source ?? 'newest';
            return {
              enabled: chapter.enabled !== false && chapterScheduled,
              order: chapter.order ?? index + 1,
              categoryId: chapter.categoryId,
              title: chapter.title,
              subtitle: chapter.subtitle,
              imageUrl: this.toStaticUrl(chapter.imagePath),
              desktopImageUrl: this.toStaticUrl(
                chapter.desktopImagePath || chapter.imagePath,
              ),
              mobileImageUrl: this.toStaticUrl(
                chapter.mobileImagePath || chapter.imagePath,
              ),
              mobileWideImageUrl: this.toStaticUrl(
                chapter.mobileWideImagePath ||
                  (chapter.imageProfile === 'pets'
                    ? chapter.mobileImagePath || chapter.imagePath
                    : undefined),
              ),
              objectPositionDesktop: chapter.objectPositionDesktop,
              objectPositionMobile: chapter.objectPositionMobile,
              /** Compat alias — older clients read a single position. */
              objectPosition:
                chapter.objectPositionDesktop || chapter.objectPositionMobile,
              imageFitDesktop: chapter.compositionDesktop?.fit,
              imageFitMobile: chapter.compositionMobile?.fit,
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
          ...(managedChapters !== undefined
            ? { chaptersMode: 'managed' as const }
            : {}),
          chapters,
        };
        return base;
      }
      case 'paste_link': {
        const ctaLabel = String(cfg.ctaLabel || '').trim().slice(0, 80);
        if (ctaLabel) base.ctaLabel = ctaLabel;
        return base;
      }
      case 'featured_brands': {
        const brands = normalizeFeaturedBrandsConfig(cfg).brands;
        if (Array.isArray(brands)) {
          base.brands = brands.map((brand) => ({
            brandId: Number(brand.brandId),
            logoUrl: this.toStaticUrl(
              typeof brand.logoPath === 'string' ? brand.logoPath : undefined,
            ),
            order: Number(brand.order) || 0,
            enabled: brand.enabled !== false,
          }));
        }
        return base;
      }
      case 'site_header': {
        const header = normalizeSiteHeaderConfig(cfg);
        const links = Array.isArray(header.links)
          ? (header.links as Array<{ label: string; href: string }>)
          : [];
        base.header = {
          logoUrl: this.toStaticUrl(
            typeof header.logoPath === 'string' ? header.logoPath : undefined,
          ),
          ...(typeof header.wordmark === 'string'
            ? { wordmark: header.wordmark }
            : {}),
          links,
        };
        return base;
      }
      case 'site_intro': {
        const intro = normalizeSiteIntroConfig(cfg);
        base.intro = {
          ...(typeof intro.kicker === 'string' ? { kicker: intro.kicker } : {}),
          imageUrl: this.toStaticUrl(
            typeof intro.imagePath === 'string' ? intro.imagePath : undefined,
          ),
          ...(Array.isArray(intro.links)
            ? { links: intro.links as Array<{ label: string; href: string }> }
            : {}),
        };
        return base;
      }
      case 'site_footer': {
        const footer = normalizeSiteFooterConfig(cfg);
        base.footer = {
          logoUrl: this.toStaticUrl(
            typeof footer.logoPath === 'string' ? footer.logoPath : undefined,
          ),
          ...(Array.isArray(footer.groups)
            ? {
                groups: footer.groups as Array<{
                  title: string;
                  links: Array<{ label: string; href: string }>;
                }>,
              }
            : {}),
          social: Array.isArray(footer.social)
            ? (footer.social as Array<{ label: string; href: string }>)
            : [],
        };
        return base;
      }
      case 'quick_guide':
      case 'link_shopping':
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

  /**
   * Replace the published repeatable arrangement in one transaction.
   * Does not update or delete storefront_home_section.
   * An empty list publishes an intentional empty body.
   */
  async publishHomeArrangement(instances: UpsertHomeInstanceDto[]) {
    const repo = this.instanceRepo;
    if (!repo) {
      this.error.unprocessableEntity(['جدول چیدمان صفحه در این محیط آماده نیست']);
    }
    const arrangement = this.requireArrangement(instances);
    const now = new Date();
    await this.enqueueHomepagePublish(() =>
      repo.manager.transaction(async (manager) => {
        await this.writeArrangement(manager, arrangement, now);
      }),
    );
    this.homeImageAccess.invalidatePublishedAllowlist();
    return this.readAdminArrangement();
  }

  private requireArrangement(instances: UpsertHomeInstanceDto[]): NormalizedHomeInstance[] {
    if (!this.instanceRepo) {
      this.error.unprocessableEntity(['جدول چیدمان صفحه در این محیط آماده نیست']);
    }
    const normalized = normalizeHomeArrangement(instances);
    if (!('instances' in normalized)) {
      this.error.unprocessableEntity([normalized.message]);
    }
    return normalized.instances;
  }

  private async writeArrangement(
    manager: EntityManager,
    instances: NormalizedHomeInstance[],
    now: Date,
  ) {
    const instanceRepo = manager.getRepository(StorefrontHomeSectionInstanceEntity);
    await instanceRepo
      .createQueryBuilder()
      .delete()
      .from(StorefrontHomeSectionInstanceEntity)
      .execute();
    const marker = instanceRepo.create({
      instanceKey: HOME_LAYOUT_MARKER_KEY,
      sectionType: HOME_LAYOUT_SECTION_TYPE,
      enabled: true,
      displayOrder: 0,
      title: null,
      subtitle: null,
      configJson: null,
      createdAt: now,
      updatedAt: now,
    });
    await instanceRepo.save(marker);
    if (instances.length) {
      await instanceRepo.save(
        instances.map((row) =>
          instanceRepo.create({
            instanceKey: row.instanceKey,
            sectionType: row.sectionType,
            enabled: row.enabled,
            displayOrder: row.displayOrder,
            title: row.title,
            subtitle: row.subtitle,
            configJson: JSON.stringify(row.config),
            createdAt: now,
            updatedAt: now,
          }),
        ),
      );
    }
  }

  private async readAdminArrangement() {
    if (!this.instanceRepo) {
      return { managed: false, instances: [] as AdminArrangementInstance[] };
    }
    const rows = await this.instanceRepo.find({
      order: { displayOrder: 'ASC', id: 'ASC' },
    });
    const content = this.publishedContentInstances(rows);
    if (!content) return { managed: false, instances: [] as AdminArrangementInstance[] };
    return {
      managed: true,
      instances: content
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id)
        .map((row) => ({
          instanceKey: row.instanceKey,
          sectionType: row.sectionType,
          enabled: Boolean(row.enabled),
          displayOrder: row.displayOrder,
          title: row.title,
          subtitle: row.subtitle,
          config: parseJsonObject(row.configJson),
        })),
    };
  }

  /**
   * null means no published arrangement. An empty array is intentional.
   */
  private publishedContentInstances(
    rows: StorefrontHomeSectionInstanceEntity[] | undefined,
  ): StorefrontHomeSectionInstanceEntity[] | null {
    if (!rows) return null;
    if (!rows.some((row) => row.instanceKey === HOME_LAYOUT_MARKER_KEY)) {
      return null;
    }
    return rows.filter(
      (row) =>
        row.instanceKey !== HOME_LAYOUT_MARKER_KEY &&
        row.sectionType !== HOME_LAYOUT_SECTION_TYPE,
    );
  }

  private previewLayoutRows(
    instances: UpsertHomeInstanceDto[],
  ): StorefrontHomeSectionInstanceEntity[] {
    const normalized = normalizeHomeArrangement(instances);
    if (!('instances' in normalized)) {
      this.error.unprocessableEntity([normalized.message]);
    }
    const now = new Date(0);
    const marker = {
      id: 0,
      instanceKey: HOME_LAYOUT_MARKER_KEY,
      sectionType: HOME_LAYOUT_SECTION_TYPE,
      enabled: true,
      displayOrder: 0,
      title: null,
      subtitle: null,
      configJson: null,
      createdAt: now,
      updatedAt: null,
    } as StorefrontHomeSectionInstanceEntity;
    return [
      marker,
      ...normalized.instances.map(
        (row, index) =>
          ({
            id: index + 1,
            instanceKey: row.instanceKey,
            sectionType: row.sectionType,
            enabled: row.enabled,
            displayOrder: row.displayOrder,
            title: row.title,
            subtitle: row.subtitle,
            configJson: JSON.stringify(row.config),
            createdAt: now,
            updatedAt: null,
          }) as StorefrontHomeSectionInstanceEntity,
      ),
    ];
  }

  private instanceToSectionRow(
    row: StorefrontHomeSectionInstanceEntity,
    index: number,
  ): StorefrontHomeSectionEntity {
    const sectionType = row.sectionType as HomeRepeatableSectionType;
    return {
      id: 100000 + index,
      sectionKey: HOME_INSTANCE_EDITOR_KEYS[sectionType] || 'campaign',
      enabled: Boolean(row.enabled),
      displayOrder: row.displayOrder,
      title: row.title,
      subtitle: row.subtitle,
      configJson: row.configJson,
      startAt: null,
      endAt: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } as StorefrontHomeSectionEntity;
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

  /**
   * @param access `public` — untokenized URL for published homepage (default).
   *              `draft` — path-bound expiring `hda` token for Admin / preview.
   */
  private toStaticUrl(
    path: string | undefined | null,
    access: 'public' | 'draft' = 'public',
  ): string | null {
    if (access === 'draft') {
      return this.homeImageAccess.buildSignedStaticUrl(path);
    }
    return this.homeImageAccess.buildPublicStaticUrl(path);
  }

  /**
   * Rewrite public-shaped image URLs in an unpublished preview payload so the
   * storefront iframe can load draft crops without making them world-readable.
   */
  signDraftUrlsInPublicHomeDto(
    dto: PublicStorefrontHomeDto,
  ): PublicStorefrontHomeDto {
    const rewrite = (value: unknown): unknown => {
      if (value == null) return value;
      if (typeof value === 'string') {
        const match = value.match(/^(https?:\/\/[^?\s]+)(\/static\/home\/[a-zA-Z0-9._-]+)(\?.*)?$/i);
        if (match) {
          const logical = sanitizeHomeUploadPath(
            `/home/${match[2].split('/').pop()}`,
          );
          const signed = logical
            ? this.homeImageAccess.buildSignedStaticUrl(logical)
            : null;
          return signed || value;
        }
        if (value.startsWith('/static/home/') || value.startsWith('/home/')) {
          const logical = sanitizeHomeUploadPath(
            value.startsWith('/home/')
              ? value
              : `/home/${value.split('/').pop()}`,
          );
          return (
            this.homeImageAccess.buildSignedStaticUrl(logical) || value
          );
        }
        return value;
      }
      if (Array.isArray(value)) return value.map((item) => rewrite(item));
      if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = rewrite(v);
        }
        return out;
      }
      return value;
    };
    return rewrite(dto) as PublicStorefrontHomeDto;
  }

  /** Admin: mint short-lived signed static URLs for logical `/home/...` paths. */
  signHomeMediaPaths(paths: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    // Include previousImage snapshots so Restore UI can still render them.
    const unique = new Set<string>();
    for (const raw of paths || []) {
      collectHomeImagePathsFromValue(raw, unique);
    }
    for (const logical of unique) {
      if (!logical.startsWith('/home/')) continue;
      const signed = this.homeImageAccess.buildSignedStaticUrl(logical);
      if (signed) out[logical] = signed;
    }
    return out;
  }

  private parseOptionalDate(value?: string | null): Date | null {
    if (value == null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
}
