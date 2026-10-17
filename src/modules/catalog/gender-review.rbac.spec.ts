import 'reflect-metadata';
import { CAPABILITIES_KEY } from '../auth/capability/capability.decorator';
import { UserCapabilityName } from '../auth/capability/capability.catalog';
import { UserRoles } from '../user/entities/user.entity';
import { CatalogController } from './catalog.controller';

describe('gender review RBAC', () => {
  it('keeps read and resolve behind the existing product capabilities', () => {
    expect(
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        CatalogController.prototype.genderReviewSummaryAdmin,
      ),
    ).toEqual([UserCapabilityName.product_read]);
    expect(
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        CatalogController.prototype.genderReviewQueueAdmin,
      ),
    ).toEqual([UserCapabilityName.product_read]);
    expect(
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        CatalogController.prototype.genderReviewProductPreviewAdmin,
      ),
    ).toEqual([UserCapabilityName.product_read]);
    expect(
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        CatalogController.prototype.genderReviewResolveAdmin,
      ),
    ).toEqual([UserCapabilityName.product_write]);
    expect(
      Reflect.getMetadata('roles', CatalogController.prototype.genderReviewResolveAdmin),
    ).toEqual([UserRoles.admin, UserRoles.employee]);
  });
});
