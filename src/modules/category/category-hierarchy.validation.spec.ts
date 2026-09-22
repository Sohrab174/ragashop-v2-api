import {
  CategoryHierarchyValidationError,
  validateCategoryParentAssignment,
} from './category-hierarchy.validation';

describe('validateCategoryParentAssignment', () => {
  const repo = {
    findOne: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('rejects self-parent', async () => {
    await expect(
      validateCategoryParentAssignment(repo as any, 5, 5),
    ).rejects.toBeInstanceOf(CategoryHierarchyValidationError);
  });

  it('rejects missing parent', async () => {
    repo.findOne.mockResolvedValue(undefined);
    await expect(
      validateCategoryParentAssignment(repo as any, 5, 99),
    ).rejects.toBeInstanceOf(CategoryHierarchyValidationError);
  });

  it('rejects indirect cycle', async () => {
    repo.findOne
      .mockResolvedValueOnce({ id: 2, parentId: 3, status: 'active' })
      .mockResolvedValueOnce({ id: 3, parentId: 5 })
      .mockResolvedValueOnce({ id: 5, parentId: null });
    await expect(
      validateCategoryParentAssignment(repo as any, 5, 2),
    ).rejects.toBeInstanceOf(CategoryHierarchyValidationError);
  });

  it('accepts valid parent chain', async () => {
    repo.findOne
      .mockResolvedValueOnce({ id: 2, parentId: 1, status: 'active' })
      .mockResolvedValueOnce({ id: 1, parentId: null });
    await expect(
      validateCategoryParentAssignment(repo as any, 10, 2),
    ).resolves.toBeUndefined();
  });
});
