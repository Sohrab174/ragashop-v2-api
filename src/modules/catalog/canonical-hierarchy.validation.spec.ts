import {
  CanonicalHierarchyValidationError,
  validateCanonicalParentAssignment,
} from './canonical-hierarchy.validation';

describe('validateCanonicalParentAssignment', () => {
  const repo = {
    findOne: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('rejects self-parent', async () => {
    await expect(
      validateCanonicalParentAssignment(repo as any, 5, 5),
    ).rejects.toBeInstanceOf(CanonicalHierarchyValidationError);
  });

  it('rejects missing parent', async () => {
    repo.findOne.mockResolvedValue(undefined);
    await expect(
      validateCanonicalParentAssignment(repo as any, 5, 99),
    ).rejects.toBeInstanceOf(CanonicalHierarchyValidationError);
  });

  it('rejects inactive parent', async () => {
    repo.findOne.mockResolvedValue({
      id: 2,
      parentId: null,
      status: 'inactive',
    });
    await expect(
      validateCanonicalParentAssignment(repo as any, 5, 2),
    ).rejects.toBeInstanceOf(CanonicalHierarchyValidationError);
  });

  it('rejects indirect cycle', async () => {
    repo.findOne
      .mockResolvedValueOnce({ id: 2, parentId: 3, status: 'active' })
      .mockResolvedValueOnce({ id: 3, parentId: 5 })
      .mockResolvedValueOnce({ id: 5, parentId: null });
    await expect(
      validateCanonicalParentAssignment(repo as any, 5, 2),
    ).rejects.toBeInstanceOf(CanonicalHierarchyValidationError);
  });

  it('accepts valid parent chain', async () => {
    repo.findOne
      .mockResolvedValueOnce({ id: 2, parentId: 1, status: 'active' })
      .mockResolvedValueOnce({ id: 1, parentId: null });
    await expect(
      validateCanonicalParentAssignment(repo as any, 10, 2),
    ).resolves.toBeUndefined();
  });

  it('allows null parent (root)', async () => {
    await expect(
      validateCanonicalParentAssignment(repo as any, 10, null),
    ).resolves.toBeUndefined();
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});
