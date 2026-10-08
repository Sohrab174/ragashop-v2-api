import {
  SourceCategoryMappingValidationError,
  validateSourceCategoryMappingWrite,
} from './source-category-mapping.validation';

describe('validateSourceCategoryMappingWrite', () => {
  const categoryRepo = { findOne: jest.fn() };
  const mappingRepo = { findOne: jest.fn() };
  const canonicalRepo = { findOne: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('rejects source/category mismatch', async () => {
    categoryRepo.findOne.mockResolvedValue({
      id: 36,
      source: 'trendyol',
      status: 'active',
    });
    canonicalRepo.findOne.mockResolvedValue({ id: 10, status: 'active' });

    await expect(
      validateSourceCategoryMappingWrite(
        categoryRepo as any,
        mappingRepo as any,
        {
          sourceCategoryId: 36,
          canonicalCategoryId: 10,
          source: 'beymen',
        },
        canonicalRepo as any,
      ),
    ).rejects.toBeInstanceOf(SourceCategoryMappingValidationError);
  });

  it('uses authoritative category.source when source omitted', async () => {
    categoryRepo.findOne.mockResolvedValue({
      id: 36,
      source: 'trendyol',
      status: 'active',
    });
    canonicalRepo.findOne.mockResolvedValue({ id: 10, status: 'active' });
    mappingRepo.findOne.mockResolvedValue(undefined);

    const result = await validateSourceCategoryMappingWrite(
      categoryRepo as any,
      mappingRepo as any,
      {
        sourceCategoryId: 36,
        canonicalCategoryId: 10,
      },
      canonicalRepo as any,
    );

    expect(result.source).toBe('trendyol');
  });

  it('rejects second canonical mapping for the same source category any-slice', async () => {
    categoryRepo.findOne.mockResolvedValue({
      id: 36,
      source: 'trendyol',
      status: 'active',
    });
    canonicalRepo.findOne.mockResolvedValue({ id: 11, status: 'active' });
    mappingRepo.findOne.mockResolvedValue({
      id: 1,
      canonicalCategoryId: 10,
    });

    await expect(
      validateSourceCategoryMappingWrite(
        categoryRepo as any,
        mappingRepo as any,
        {
          sourceCategoryId: 36,
          canonicalCategoryId: 11,
          source: 'trendyol',
        },
        canonicalRepo as any,
      ),
    ).rejects.toBeInstanceOf(SourceCategoryMappingValidationError);

    expect(mappingRepo.findOne).toHaveBeenCalledWith({
      where: { sourceCategoryId: 36, genderSlice: 'any' },
    });
  });

  it('rejects non-any genderSlice writes on the legacy V2-A path', async () => {
    categoryRepo.findOne.mockResolvedValue({
      id: 36,
      source: 'trendyol',
      status: 'active',
    });
    canonicalRepo.findOne.mockResolvedValue({ id: 10, status: 'active' });

    await expect(
      validateSourceCategoryMappingWrite(
        categoryRepo as any,
        mappingRepo as any,
        {
          sourceCategoryId: 36,
          canonicalCategoryId: 10,
          genderSlice: 'female' as any,
        },
        canonicalRepo as any,
      ),
    ).rejects.toBeInstanceOf(SourceCategoryMappingValidationError);
  });

  it('defaults omitted genderSlice to any', async () => {
    categoryRepo.findOne.mockResolvedValue({
      id: 36,
      source: 'trendyol',
      status: 'active',
    });
    canonicalRepo.findOne.mockResolvedValue({ id: 10, status: 'active' });
    mappingRepo.findOne.mockResolvedValue(undefined);

    const result = await validateSourceCategoryMappingWrite(
      categoryRepo as any,
      mappingRepo as any,
      { sourceCategoryId: 36, canonicalCategoryId: 10 },
      canonicalRepo as any,
    );
    expect(result.genderSlice).toBe('any');
  });

  it('allows different source-category rows (retailers) into one canonical', async () => {
    categoryRepo.findOne
      .mockResolvedValueOnce({
        id: 36,
        source: 'trendyol',
        status: 'active',
      })
      .mockResolvedValueOnce({
        id: 9001,
        source: 'beymen',
        status: 'active',
      });
    canonicalRepo.findOne.mockResolvedValue({ id: 10, status: 'active' });
    mappingRepo.findOne.mockResolvedValue(undefined);

    const a = await validateSourceCategoryMappingWrite(
      categoryRepo as any,
      mappingRepo as any,
      { sourceCategoryId: 36, canonicalCategoryId: 10, source: 'trendyol' },
      canonicalRepo as any,
    );
    const b = await validateSourceCategoryMappingWrite(
      categoryRepo as any,
      mappingRepo as any,
      { sourceCategoryId: 9001, canonicalCategoryId: 10, source: 'beymen' },
      canonicalRepo as any,
    );

    expect(a.sourceCategoryId).toBe(36);
    expect(b.sourceCategoryId).toBe(9001);
    expect(a.canonicalCategoryId).toBe(b.canonicalCategoryId);
  });

  it('rejects missing source category', async () => {
    categoryRepo.findOne.mockResolvedValue(undefined);
    await expect(
      validateSourceCategoryMappingWrite(
        categoryRepo as any,
        mappingRepo as any,
        { sourceCategoryId: 999, canonicalCategoryId: 10 },
        canonicalRepo as any,
      ),
    ).rejects.toBeInstanceOf(SourceCategoryMappingValidationError);
  });
});

describe('source_category_mapping identity contract', () => {
  it('uses (sourceCategoryId, genderSlice) as unique identity after V2-A', () => {
    const uniquenessKey = (m: {
      sourceCategoryId: number;
      genderSlice: string;
    }) => `${m.sourceCategoryId}:${m.genderSlice}`;
    expect(
      uniquenessKey({ sourceCategoryId: 36, genderSlice: 'any' }),
    ).not.toBe(
      uniquenessKey({ sourceCategoryId: 36, genderSlice: 'female' }),
    );
    expect(
      uniquenessKey({ sourceCategoryId: 36, genderSlice: 'female' }),
    ).toBe(uniquenessKey({ sourceCategoryId: 36, genderSlice: 'female' }));
  });

  it('keeps source as denormalized metadata only', () => {
    const mapping = {
      source: 'trendyol',
      sourceCategoryId: 36,
      canonicalCategoryId: 100,
      genderSlice: 'any',
    };
    expect(mapping).not.toHaveProperty('trendyolCategoryId');
    expect(Object.keys(mapping)).toEqual(
      expect.arrayContaining([
        'source',
        'sourceCategoryId',
        'canonicalCategoryId',
        'genderSlice',
      ]),
    );
  });
});
