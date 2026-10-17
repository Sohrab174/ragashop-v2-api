import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CatalogController } from './catalog.controller';
import { CAPABILITIES_KEY } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
import { PermissionsGuard } from '../auth/capability/permissions.guard';
import { JwtAuthGuard } from '../auth/jwt/jwt.guard';
import { SourceCategoryMappingValidationError } from './source-category-mapping.validation';

describe('CatalogController — Admin category architecture (canonical + mapping)', () => {
  const proto = CatalogController.prototype as any;

  const capsOf = (method: string) =>
    Reflect.getMetadata(CAPABILITIES_KEY, proto[method]);
  const guardsOf = (method: string) =>
    Reflect.getMetadata(GUARDS_METADATA, proto[method]) || [];

  describe('RBAC metadata', () => {
    it.each([
      ['listCanonicalAdmin', UserCapabilityName.category_read],
      ['createCanonicalAdmin', UserCapabilityName.category_manage],
      ['updateCanonicalAdmin', UserCapabilityName.category_manage],
      ['listMappingsAdmin', UserCapabilityName.category_read],
      ['upsertMappingAdmin', UserCapabilityName.category_manage],
      ['categoryCoverageAdmin', UserCapabilityName.category_read],
      ['sourceMappingDetailAdmin', UserCapabilityName.category_read],
      ['saveSourceMappingV2Admin', UserCapabilityName.category_manage],
      ['canonicalPickerAdmin', UserCapabilityName.category_read],
      ['mappingReviewQueueAdmin', UserCapabilityName.category_read],
      ['categoryCoverageV2Admin', UserCapabilityName.category_read],
    ])('%s requires %s behind JWT + PermissionsGuard', (method, cap) => {
      expect(capsOf(method)).toEqual([cap]);
      const guards = guardsOf(method);
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);
    });

    it('public navigation stays unguarded', () => {
      expect(capsOf('getNavigation')).toBeUndefined();
      expect(guardsOf('getNavigation')).toEqual([]);
    });
  });

  describe('handlers', () => {
    let service: Record<string, jest.Mock>;
    let controller: CatalogController;

    let v2c: Record<string, jest.Mock>;

    beforeEach(() => {
      service = {
        createCanonicalCategory: jest.fn(),
        updateCanonicalCategory: jest.fn(),
        listSourceMappingBoardAdmin: jest.fn().mockResolvedValue({ rows: [] }),
        upsertSourceCategoryMapping: jest.fn(),
        getCategoryCoverageAdmin: jest.fn().mockResolvedValue({}),
      };
      v2c = {
        getSourceMappingDetailAdmin: jest.fn().mockResolvedValue({}),
        saveSourceMappingV2Admin: jest.fn().mockResolvedValue({}),
        listCanonicalPickerAdmin: jest.fn().mockResolvedValue({ items: [] }),
        listMappingReviewQueueAdmin: jest.fn().mockResolvedValue({ items: [] }),
        getCategoryCoverageV2Admin: jest.fn().mockResolvedValue({}),
      };
      const assortmentAdmin = {
        getSummaryAdmin: jest.fn().mockResolvedValue({}),
        listReviewQueueAdmin: jest.fn().mockResolvedValue({ items: [] }),
        getCategoryDetailAdmin: jest.fn().mockResolvedValue({}),
        listAuditAdmin: jest.fn().mockResolvedValue({ items: [] }),
        previewDecisionAdmin: jest.fn().mockResolvedValue({}),
        applyDecisionAdmin: jest.fn().mockResolvedValue({}),
      };
      controller = new CatalogController(
        service as any,
        {} as any,
        v2c as any,
        {} as any,
        assortmentAdmin as any,
        {} as any,
        {} as any,
        {} as any,
      );
    });

    it('create rejects empty name without touching the service', async () => {
      await expect(
        controller.createCanonicalAdmin({ name: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.createCanonicalCategory).not.toHaveBeenCalled();
    });

    it('create trims name and returns audience', async () => {
      service.createCanonicalCategory.mockResolvedValue({
        id: 90,
        parentId: 1,
        name: 'کفش',
        status: 'active',
        displayOrder: 0,
        imagePath: null,
        discoveryImagePath: null,
        audience: 'female',
      });
      const res: any = await controller.createCanonicalAdmin({
        name: '  کفش ',
        parentId: 1,
        audience: 'female',
      });
      expect(service.createCanonicalCategory).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'کفش', parentId: 1 }),
      );
      expect(res.data.audience).toBe('female');
    });

    it('update rejects invalid id', async () => {
      await expect(
        controller.updateCanonicalAdmin('abc', { name: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.updateCanonicalCategory).not.toHaveBeenCalled();
    });

    it('mapping board defaults onlyWithProducts=true and limit=200', async () => {
      await controller.listMappingsAdmin('1');
      expect(service.listSourceMappingBoardAdmin).toHaveBeenCalledWith({
        onlyUnmapped: true,
        onlyMapped: false,
        onlyWithProducts: true,
        source: null,
        search: null,
        limit: 200,
      });
    });

    it('mapping upsert requires numeric ids (no ID guessing)', async () => {
      await expect(
        controller.upsertMappingAdmin({ sourceCategoryId: 15 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.upsertMappingAdmin({ canonicalCategoryId: 3 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.upsertSourceCategoryMapping).not.toHaveBeenCalled();
    });

    it('mapping upsert surfaces validation errors as 400', async () => {
      service.upsertSourceCategoryMapping.mockRejectedValue(
        new SourceCategoryMappingValidationError('source mismatch'),
      );
      await expect(
        controller.upsertMappingAdmin({
          sourceCategoryId: 15,
          canonicalCategoryId: 3,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('mapping upsert passes through one explicit pair only', async () => {
      service.upsertSourceCategoryMapping.mockResolvedValue({
        id: 1,
        sourceCategoryId: 15,
        canonicalCategoryId: 3,
        source: 'trendyol',
        status: 'active',
        genderSlice: 'any',
        reviewStatus: 'legacy_unreviewed',
        note: null,
      });
      const res: any = await controller.upsertMappingAdmin({
        sourceCategoryId: 15,
        canonicalCategoryId: 3,
        status: 'active' as any,
      });
      expect(service.upsertSourceCategoryMapping).toHaveBeenCalledTimes(1);
      expect(service.upsertSourceCategoryMapping).toHaveBeenCalledWith({
        sourceCategoryId: 15,
        canonicalCategoryId: 3,
        status: 'active',
        note: undefined,
      });
      expect(res.data.genderSlice).toBe('any');
      expect(res.data.reviewStatus).toBe('legacy_unreviewed');
    });

    it('V2 source detail rejects invalid id without service call', async () => {
      await expect(
        controller.sourceMappingDetailAdmin('abc'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(v2c.getSourceMappingDetailAdmin).not.toHaveBeenCalled();
    });

    it('V2 save requires confirmImpact passthrough and numeric source id', async () => {
      await expect(
        controller.saveSourceMappingV2Admin('x', { rules: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await controller.saveSourceMappingV2Admin('120', {
        rules: [
          { genderSlice: 'female', canonicalCategoryId: 20 },
          { genderSlice: 'male', canonicalCategoryId: 40 },
        ],
        confirmImpact: true,
      });
      expect(v2c.saveSourceMappingV2Admin).toHaveBeenCalledWith(120, {
        rules: [
          { genderSlice: 'female', canonicalCategoryId: 20, status: undefined },
          { genderSlice: 'male', canonicalCategoryId: 40, status: undefined },
        ],
        confirmImpact: true,
      });
    });
  });
});
