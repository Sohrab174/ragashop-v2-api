import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { successfulResult } from '../../utils';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { Roles } from '../auth/role/role.decorator';
import { RolesGuard } from '../auth/role/role.guard';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { RequireCapabilities } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
import { UserRoles } from '../user/entities/user.entity';
import { SearchService } from '../search/search.service';
import { parseStorefrontSearchQuery } from '../search/storefront-search.query';
import { parseStorefrontSuggestionQuery } from '../search/storefront-suggestion.query';
import { CatalogService } from './catalog.service';
import { CatMapV2cAdminService } from './cat-map-v2c-admin.service';
import { CanonicalCategoryStatus } from './entities/canonical-category.entity';
import { SourceCategoryMappingStatus } from './entities/source-category-mapping.entity';
import { parseStorefrontPlpQuery } from './storefront-plp.query';
import { CanonicalHierarchyValidationError } from './canonical-hierarchy.validation';
import { SourceCategoryMappingValidationError } from './source-category-mapping.validation';
import { SourceCategoryMappingV2ValidationError } from './cat-map-v2c-write.validation';
import { AssortmentPolicyAdminService } from './assortment-policy/assortment-policy.admin.service';
import { AssortmentPolicyAdminValidationError } from './assortment-policy/assortment-policy.impact';
import { AssortmentPolicySnapshotService } from './assortment-policy/assortment-policy-snapshot.service';
import { AssortmentPolicyRecomputeService } from './assortment-policy/assortment-policy.recompute.service';
import { AssortmentCommerceService } from './assortment-policy/assortment-commerce.service';
import { InternalAuthGuard } from '../../common/internal-auth.guard';

@ApiTags('Catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly searchService: SearchService,
    private readonly catMapV2cAdminService: CatMapV2cAdminService,
    private readonly assortmentPolicyAdminService: AssortmentPolicyAdminService,
    private readonly assortmentPolicySnapshotService: AssortmentPolicySnapshotService,
    private readonly assortmentPolicyRecomputeService: AssortmentPolicyRecomputeService,
    private readonly assortmentCommerceService: AssortmentCommerceService,
  ) {}

  /**
   * GET /catalog/navigation
   * Customer-facing RagaShop canonical catalog tree.
   * Distinct from GET /categories/tree (source/import taxonomy).
   */
  @Get('navigation')
  async getNavigation() {
    const tree = await this.catalogService.getStorefrontNavigation();
    return successfulResult([], tree);
  }

  /**
   * GET /catalog/canonical/admin — RagaShop category flat list for Admin tree.
   */
  @Get('canonical/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async listCanonicalAdmin() {
    const rows = await this.catalogService.listCanonicalCategoriesAdmin();
    return successfulResult(
      [],
      rows.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        name: row.name,
        status: row.status,
        displayOrder: row.displayOrder,
        imagePath: row.imagePath,
        discoveryImagePath: row.discoveryImagePath,
        audience: row.audience,
        isLocalPrototype: row.isLocalPrototype,
      })),
    );
  }

  /**
   * POST /catalog/canonical/admin — create RagaShop category.
   */
  @Post('canonical/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_manage)
  async createCanonicalAdmin(
    @Body()
    body?: {
      name?: string;
      parentId?: number | null;
      displayOrder?: number;
      imagePath?: string | null;
      discoveryImagePath?: string | null;
      audience?: string | null;
      status?: CanonicalCategoryStatus;
    },
  ) {
    const name = String(body?.name || '').trim();
    if (!name) {
      throw new BadRequestException('نام دسته‌بندی را وارد کنید.');
    }
    try {
      const created = await this.catalogService.createCanonicalCategory({
        name,
        parentId: body?.parentId ?? null,
        displayOrder: body?.displayOrder,
        imagePath: body?.imagePath,
        discoveryImagePath: body?.discoveryImagePath,
        audience: body?.audience,
        status: body?.status,
      });
      return successfulResult(['دسته‌بندی فروشگاه ایجاد شد'], {
        id: created.id,
        parentId: created.parentId,
        name: created.name,
        status: created.status,
        displayOrder: created.displayOrder,
        imagePath: created.imagePath,
        discoveryImagePath: created.discoveryImagePath,
        audience: created.audience,
      });
    } catch (err) {
      if (err instanceof CanonicalHierarchyValidationError) {
        throw new BadRequestException(err.message);
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : 'ایجاد دسته‌بندی ناموفق بود.',
      );
    }
  }

  /**
   * PUT /catalog/canonical/:id/admin
   */
  @Put('canonical/:id/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_manage)
  async updateCanonicalAdmin(
    @Param('id') id?: string,
    @Body()
    body?: {
      name?: string;
      parentId?: number | null;
      displayOrder?: number;
      imagePath?: string | null;
      discoveryImagePath?: string | null;
      audience?: string | null;
      status?: CanonicalCategoryStatus;
    },
  ) {
    const categoryId = Number(id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throw new BadRequestException('شناسه دسته نامعتبر است.');
    }
    try {
      const updated = await this.catalogService.updateCanonicalCategory(
        categoryId,
        body ?? {},
      );
      return successfulResult(['دسته‌بندی فروشگاه به‌روزرسانی شد'], {
        id: updated.id,
        parentId: updated.parentId,
        name: updated.name,
        status: updated.status,
        displayOrder: updated.displayOrder,
        imagePath: updated.imagePath,
        discoveryImagePath: updated.discoveryImagePath,
        audience: updated.audience,
      });
    } catch (err) {
      if (err instanceof CanonicalHierarchyValidationError) {
        throw new BadRequestException(err.message);
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : 'به‌روزرسانی دسته ناموفق بود.',
      );
    }
  }

  /**
   * GET /catalog/mappings/admin — source→RagaShop mapping board.
   */
  @Get('mappings/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async listMappingsAdmin(
    @Query('onlyUnmapped') onlyUnmapped?: string,
    @Query('onlyMapped') onlyMapped?: string,
    @Query('onlyWithProducts') onlyWithProducts?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.catalogService.listSourceMappingBoardAdmin({
      onlyUnmapped: onlyUnmapped === '1' || onlyUnmapped === 'true',
      onlyMapped: onlyMapped === '1' || onlyMapped === 'true',
      onlyWithProducts:
        onlyWithProducts === undefined || onlyWithProducts === ''
          ? true
          : onlyWithProducts === '1' || onlyWithProducts === 'true',
      source: source || null,
      search: search || null,
      limit: limit ? Number(limit) : 200,
    });
    return successfulResult([], data);
  }

  /**
   * PUT /catalog/mappings/admin — upsert one mapping (human-confirmed).
   */
  @Put('mappings/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_manage)
  async upsertMappingAdmin(
    @Body()
    body?: {
      sourceCategoryId?: number;
      canonicalCategoryId?: number;
      status?: SourceCategoryMappingStatus;
      note?: string | null;
    },
  ) {
    const sourceCategoryId = Number(body?.sourceCategoryId);
    const canonicalCategoryId = Number(body?.canonicalCategoryId);
    if (!Number.isInteger(sourceCategoryId) || sourceCategoryId <= 0) {
      throw new BadRequestException('دسته‌بندی منبع نامعتبر است.');
    }
    if (!Number.isInteger(canonicalCategoryId) || canonicalCategoryId <= 0) {
      throw new BadRequestException('دسته‌بندی فروشگاه نامعتبر است.');
    }
    try {
      const saved = await this.catalogService.upsertSourceCategoryMapping({
        sourceCategoryId,
        canonicalCategoryId,
        status: body?.status,
        note: body?.note,
      });
      return successfulResult(['نگاشت دسته‌بندی ذخیره شد'], {
        id: saved.id,
        sourceCategoryId: saved.sourceCategoryId,
        canonicalCategoryId: saved.canonicalCategoryId,
        source: saved.source,
        status: saved.status,
        genderSlice: saved.genderSlice,
        reviewStatus: saved.reviewStatus,
        note: saved.note,
      });
    } catch (err) {
      if (err instanceof SourceCategoryMappingValidationError) {
        throw new BadRequestException(err.message);
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : 'ذخیره نگاشت ناموفق بود.',
      );
    }
  }

  /**
   * GET /catalog/category-coverage/admin
   * Legacy coverage (V1 mapped-count style). Prefer /category-coverage/v2/admin.
   */
  @Get('category-coverage/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async categoryCoverageAdmin() {
    const data = await this.catalogService.getCategoryCoverageAdmin();
    return successfulResult([], data);
  }

  /**
   * GET /catalog/mappings/source/:sourceCategoryId/admin
   * CAT-MAP-V2-C source detail + gender distribution + routing diagnostics.
   */
  @Get('mappings/source/:sourceCategoryId/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async sourceMappingDetailAdmin(
    @Param('sourceCategoryId') sourceCategoryId?: string,
  ) {
    const id = Number(sourceCategoryId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('دسته‌بندی منبع نامعتبر است.');
    }
    const data = await this.catMapV2cAdminService.getSourceMappingDetailAdmin(
      id,
    );
    return successfulResult([], data);
  }

  /**
   * PUT /catalog/mappings/source/:sourceCategoryId/admin
   * Atomic V2 save (female/male rules). Do not use against real mappings in V2-C review.
   */
  @Put('mappings/source/:sourceCategoryId/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_manage)
  async saveSourceMappingV2Admin(
    @Param('sourceCategoryId') sourceCategoryId?: string,
    @Body()
    body?: {
      rules?: Array<{
        genderSlice?: string;
        canonicalCategoryId?: number;
        status?: string;
      }>;
      confirmImpact?: boolean;
    },
  ) {
    const id = Number(sourceCategoryId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('دسته‌بندی منبع نامعتبر است.');
    }
    try {
      const data = await this.catMapV2cAdminService.saveSourceMappingV2Admin(
        id,
        {
          rules: (body?.rules || []).map((r) => ({
            genderSlice: String(r.genderSlice || ''),
            canonicalCategoryId: Number(r.canonicalCategoryId),
            status: r.status,
          })),
          confirmImpact: body?.confirmImpact === true,
        },
      );
      return successfulResult(['نگاشت نسخه ۲ ذخیره شد'], data);
    } catch (err) {
      if (err instanceof SourceCategoryMappingV2ValidationError) {
        throw new BadRequestException({
          message: err.message,
          code: err.code,
          details: err.details || null,
        });
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : 'ذخیره نگاشت نسخه ۲ ناموفق بود.',
      );
    }
  }

  /**
   * GET /catalog/canonical/picker/admin
   * Destination picker with full canonical paths. audienceHint ranks only.
   */
  @Get('canonical/picker/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async canonicalPickerAdmin(
    @Query('q') q?: string,
    @Query('audienceHint') audienceHint?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.catMapV2cAdminService.listCanonicalPickerAdmin({
      q: q || null,
      audienceHint: audienceHint || null,
      includeInactive: includeInactive === '1' || includeInactive === 'true',
      limit: limit ? Number(limit) : 100,
    });
    return successfulResult([], data);
  }

  /**
   * GET /catalog/mappings/review-queue/admin
   */
  @Get('mappings/review-queue/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async mappingReviewQueueAdmin(
    @Query('classification') classification?: string,
    @Query('routingStatus') routingStatus?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.catMapV2cAdminService.listMappingReviewQueueAdmin({
      classification: classification || null,
      routingStatus: routingStatus || null,
      source: source || null,
      search: search || null,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
    return successfulResult([], data);
  }

  /**
   * GET /catalog/category-coverage/v2/admin
   * V2 coverage: reviewed/routed vs currently-discoverable (legacy-aware).
   */
  @Get('category-coverage/v2/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async categoryCoverageV2Admin() {
    const data = await this.catMapV2cAdminService.getCategoryCoverageV2Admin();
    return successfulResult([], data);
  }

  /**
   * GET /catalog/assortment/internal/snapshot
   * Versioned minimal policy snapshot for crawler (x-crawler-secret).
   */
  @Get('assortment/internal/snapshot')
  @UseGuards(InternalAuthGuard)
  async assortmentInternalSnapshot(@Query('provider') provider?: string) {
    const data = await this.assortmentPolicySnapshotService.getInternalSnapshot(
      { provider: provider || null },
    );
    return successfulResult([], data);
  }

  /**
   * POST /catalog/assortment/internal/materialize-missing
   * Crawler hook after a newly created source category: reuse the central
   * evaluator to fill missing resolution rows. No-op when complete.
   */
  @Post('assortment/internal/materialize-missing')
  @UseGuards(InternalAuthGuard)
  async assortmentInternalMaterializeMissing() {
    const data =
      await this.assortmentPolicyRecomputeService.materializeMissingResolutions(
        'system:crawler-materialize',
      );
    return successfulResult([], {
      changed: data.changed,
      missingBefore: data.missingBefore,
      policyVersion: data.policyVersion,
      changedCategoryIds: data.changedCategoryIds,
    });
  }

  /**
   * GET /catalog/assortment/paste-link-reviews/admin
   * Read-only: customer paste-link products whose category is not IN_SCOPE.
   */
  @Get('assortment/paste-link-reviews/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async assortmentPasteLinkReviewsAdmin(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const data =
      await this.assortmentCommerceService.listPasteLinkReviewRequestsAdmin({
        status: status || null,
        limit: limit ? Number(limit) : 50,
      });
    return successfulResult([], data);
  }

  /**
   * GET /catalog/assortment/summary/admin
   * Compact assortment policy counts for Admin chips.
   */
  @Get('assortment/summary/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async assortmentSummaryAdmin() {
    const data = await this.assortmentPolicyAdminService.getSummaryAdmin();
    return successfulResult([], data);
  }

  /**
   * GET /catalog/assortment/review-queue/admin
   * Default tab = REVIEW_REQUIRED («نیازمند تصمیم»).
   */
  @Get('assortment/review-queue/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async assortmentReviewQueueAdmin(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('provider') provider?: string,
    @Query('businessDomain') businessDomain?: string,
    @Query('reasonCode') reasonCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.assortmentPolicyAdminService.listReviewQueueAdmin({
      status: status || 'REVIEW_REQUIRED',
      q: q || null,
      provider: provider || null,
      businessDomain: businessDomain || null,
      reasonCode: reasonCode || null,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
    return successfulResult([], data);
  }

  /**
   * GET /catalog/assortment/source/:sourceCategoryId/admin
   */
  @Get('assortment/source/:sourceCategoryId/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async assortmentSourceDetailAdmin(
    @Param('sourceCategoryId') sourceCategoryId?: string,
  ) {
    const id = Number(sourceCategoryId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('دسته‌بندی منبع نامعتبر است.');
    }
    const data = await this.assortmentPolicyAdminService.getCategoryDetailAdmin(
      id,
    );
    return successfulResult([], data);
  }

  /**
   * GET /catalog/assortment/audit/admin
   */
  @Get('assortment/audit/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_read)
  async assortmentAuditAdmin(
    @Query('categoryId') categoryId?: string,
    @Query('ruleId') ruleId?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.assortmentPolicyAdminService.listAuditAdmin({
      categoryId: categoryId ? Number(categoryId) : null,
      ruleId: ruleId ? Number(ruleId) : null,
      limit: limit ? Number(limit) : 50,
    });
    return successfulResult([], data);
  }

  /**
   * POST /catalog/assortment/preview/admin — no mutation.
   */
  @Post('assortment/preview/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_manage)
  async assortmentPreviewAdmin(
    @Body()
    body?: {
      sourceCategoryId?: number;
      targetStatus?: string;
      note?: string | null;
    },
  ) {
    try {
      const data = await this.assortmentPolicyAdminService.previewDecisionAdmin(
        {
          sourceCategoryId: Number(body?.sourceCategoryId),
          targetStatus: String(body?.targetStatus || ''),
          note: body?.note ?? null,
        },
      );
      return successfulResult([], data);
    } catch (err) {
      if (err instanceof AssortmentPolicyAdminValidationError) {
        throw new BadRequestException({
          message: err.message,
          code: err.code,
          details: err.details || null,
        });
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : 'پیش‌نمایش تصمیم ناموفق بود.',
      );
    }
  }

  /**
   * POST /catalog/assortment/apply/admin — transactional override + recompute.
   */
  @Post('assortment/apply/admin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRoles.admin, UserRoles.employee)
  @RequireCapabilities(UserCapabilityName.category_manage)
  async assortmentApplyAdmin(
    @Req() req: { user?: { id?: number; email?: string } },
    @Body()
    body?: {
      sourceCategoryId?: number;
      targetStatus?: string;
      note?: string | null;
      confirmImpact?: boolean;
    },
  ) {
    const user = req?.user;
    const actor = user?.email
      ? `user:${user.email}`
      : user?.id
      ? `user:${user.id}`
      : 'admin:unknown';
    try {
      const data = await this.assortmentPolicyAdminService.applyDecisionAdmin({
        sourceCategoryId: Number(body?.sourceCategoryId),
        targetStatus: String(body?.targetStatus || ''),
        note: body?.note ?? null,
        confirmImpact: body?.confirmImpact === true,
        actor,
      });
      return successfulResult(['تصمیم حوزه فروش ذخیره شد'], data);
    } catch (err) {
      if (err instanceof AssortmentPolicyAdminValidationError) {
        throw new BadRequestException({
          message: err.message,
          code: err.code,
          details: err.details || null,
        });
      }
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'ذخیره تصمیم حوزه فروش ناموفق بود.',
      );
    }
  }

  /**
   * GET /catalog/search/suggestions
   * Lightweight autocomplete for the Universal Search Bar (Search UX V1.1).
   * Brand/category first; product titles only for longer prefixes.
   */
  @Get('search/suggestions')
  async searchSuggestions(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = parseStorefrontSuggestionQuery({ q, limit });
    if (parsed.ok === false) {
      throw new BadRequestException(parsed.error.message);
    }
    const data = await this.searchService.getSuggestions(parsed.value);
    return successfulResult([], data);
  }

  /**
   * GET /catalog/search
   * Search Engine V1 — keyword catalog search over A4-discoverable products.
   * Does NOT live-query retailers. Paste-a-Link remains a separate path.
   *
   * Query:
   *   q          — required search text (max 120)
   *   page/limit — same bounds as PLP
   *   sort       — relevance (default) | newest | price_asc | price_desc | discount | default
   *   categoryId — optional canonical category scope
   *   brands / minPrice / maxPrice / attrs — same filter grammar as PLP
   */
  @Get('search')
  async searchProducts(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brands') brands?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('attrs') attrs?: string,
  ) {
    const parsed = parseStorefrontSearchQuery({
      q,
      page,
      limit,
      sort,
      categoryId,
      brands,
      minPrice,
      maxPrice,
      attrs,
    });
    if (parsed.ok === false) {
      throw new BadRequestException(parsed.error.message);
    }
    const data = await this.searchService.searchCatalog(parsed.value);
    return successfulResult([], data);
  }

  /**
   * GET /catalog/products
   * Canonical-aware Product Listing + dynamic facets (PLP-2).
   *
   * Query:
   *   categoryId — CANONICAL category id (required)
   *   page       — 1-based (default 1)
   *   limit      — default 24, max 48
   *   sort       — default | newest | price_asc | price_desc | discount
   *   brands     — comma-separated Brand ids (OR within)
   *   minPrice   — toman (inclusive), customer-facing
   *   maxPrice   — toman (inclusive), customer-facing
   *   attrs      — attributeId:valueId,valueId;attributeId:valueId
   *                (OR within attribute, AND across attributes)
   *
   * Price filter uses the same effective-price SQL as sort/display.
   * Filtering converts toman → TRY via tryToToman (inverse of display).
   * Facets are scoped to the same eligible Product population.
   */
  @Get('products')
  async getProducts(
    @Query('categoryId') categoryId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('brands') brands?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('attrs') attrs?: string,
  ) {
    const parsed = parseStorefrontPlpQuery({
      categoryId,
      page,
      limit,
      sort,
      brands,
      minPrice,
      maxPrice,
      attrs,
    });
    if (parsed.ok === false) {
      throw new BadRequestException(parsed.error.message);
    }

    const data = await this.catalogService.getStorefrontProducts(parsed.value);
    return successfulResult([], data);
  }

  /**
   * GET /catalog/products/:id
   * Storefront Product Detail (PDP-1) — source-agnostic public contract.
   * Visibility matches PLP core eligibility (by product id, no facet cost).
   */
  @Get('products/:id')
  async getProduct(@Param('id') id?: string) {
    const productId = Number(id);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new BadRequestException('شناسه محصول نامعتبر است.');
    }

    const data = await this.catalogService.getStorefrontProductDetail(
      productId,
    );
    return successfulResult([], data);
  }
}
