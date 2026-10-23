import { ProductGender } from '../product/entities/product.entity';
import { SLICE_ELIGIBLE_PRODUCT_GENDERS } from './canonical-product-eligibility';
import { SourceCategoryMappingGenderSlice } from './entities/source-category-mapping.entity';
import { classifyGenderRelevance } from './gender-relevance';

describe('classifyGenderRelevance', () => {
  it('treats supermarket pet-shop trees as not gender-applicable', () => {
    const decision = classifyGenderRelevance({
      hierarchy: 'Supermarket/Pet Shop Products/Dog Products/Dog Collars',
    });
    expect(decision.relevance).toBe('gender_not_applicable');
    expect(decision.reason).toBe('supermarket');
    expect(decision.reviewable).toBe(false);
  });

  it('still requires a gender for adult clothing', () => {
    const decision = classifyGenderRelevance({
      hierarchy: 'Giyim/Üst Giyim/Bluz',
      businessDomain: 'fashion_apparel',
    });
    expect(decision.relevance).toBe('gender_required');
  });

  it('excludes household goods without treating them as unisex', () => {
    const decision = classifyGenderRelevance({
      hierarchy: 'Ev & Mobilya/Mobilya/Halı / Kilim/Halı',
      businessDomain: 'home_rugs',
    });
    expect(decision.relevance).toBe('gender_not_applicable');
    expect(decision.reason).toBe('household');
    expect(decision.reviewable).toBe(false);

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ev & Mobilya/Mobilya/Perde/Fon Perde',
        businessDomain: 'home_curtains',
      }).reason,
    ).toBe('household');
    expect(
      classifyGenderRelevance({
        hierarchy:
          'Ev & Mobilya/Ev/Ev Gereçleri/Depolama&Düzenleme Ürünleri/Hurç',
        businessDomain: 'home_goods_small',
      }).relevance,
    ).toBe('gender_not_applicable');
  });

  it('keeps adult apparel and footwear reviewable when gender is missing', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Giyim/Üst Giyim/T-Shirt',
        businessDomain: 'fashion_apparel',
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'adult_apparel' });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'footwear' });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Spor & Outdoor/Spor Giyim/Eşofman',
        businessDomain: 'sport',
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'sportswear' });
  });

  it('does not treat a sneaker as a child product from age group alone', () => {
    const decision = classifyGenderRelevance({
      hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
      businessDomain: 'fashion_shoes',
      categoryGender: null,
    });
    expect(decision.relevance).toBe('gender_required');
  });

  it('excludes structural baby apparel and does not keyword-match bebek', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Giyim/Bebek Giyim/Bebek Takımı',
        businessDomain: 'fashion_apparel',
      }),
    ).toMatchObject({
      relevance: 'gender_not_applicable',
      reason: 'kids_hierarchy',
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Anne & Bebek & Çocuk/Çocuk Gereçleri/Oyuncak',
        businessDomain: 'kids_goods_toys',
      }).relevance,
    ).toBe('gender_not_applicable');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Giyim/Üst Giyim/Bebek Yaka T-Shirt',
        businessDomain: 'fashion_apparel',
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'adult_apparel' });
  });

  it('keeps a child flag on an adult apparel path in the review queue', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Giyim/Üst Giyim/T-Shirt',
        businessDomain: 'fashion_apparel',
        categoryGender: 'child',
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
      reviewable: true,
    });
  });

  it('splits cosmetics into specific, general, and ambiguous', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Kozmetik & Kişisel Bakım/Makyaj/Dudak Makyajı/Ruj',
        businessDomain: 'beauty',
      }),
    ).toMatchObject({
      relevance: 'gender_not_applicable',
      reason: 'cosmetics_general',
      reasonBadge: 'آرایش عمومی',
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Kozmetik & Kişisel Bakım/Saç Bakım/Saç Bakım Seti',
        businessDomain: 'beauty',
      }),
    ).toMatchObject({
      relevance: 'gender_not_applicable',
      reason: 'cosmetics_general',
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Kozmetik & Kişisel Bakım/Cilt Bakım/Yüz Bakım/Tonik',
        businessDomain: 'beauty',
      }).relevance,
    ).toBe('gender_not_applicable');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Kozmetik & Kişisel Bakım/Makyaj/Tırnak/Oje',
        businessDomain: 'beauty',
      }),
    ).toMatchObject({
      relevance: 'gender_not_applicable',
      reason: 'cosmetics_general',
    });

    expect(
      classifyGenderRelevance({
        hierarchy:
          'Kozmetik & Kişisel Bakım/Tıraş, Ağda ve Epilasyon/Islak Tıraş/Tıraş Bıçağı',
        businessDomain: 'beauty',
      }).reason,
    ).toBe('cosmetics_gender_specific');
  });

  it('keeps unknown categories and conflicting signals reviewable', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: null,
        businessDomain: null,
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'unknown_category',
      reviewable: true,
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ev & Mobilya/Mobilya/Halı / Kilim/Halı',
        businessDomain: 'fashion_apparel',
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
    });
  });

  it('excludes sport equipment and keeps accessory gaps reviewable', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Spor & Outdoor/Ekipman & Aksesuar/Kamp/Kamp Sandalyesi',
        businessDomain: 'sport',
      }),
    ).toMatchObject({
      relevance: 'gender_not_applicable',
      reason: 'sport_equipment',
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Aksesuar/Çanta/Omuz Çantası',
        businessDomain: 'fashion_accessories_bags',
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'accessory_ambiguous',
    });
  });

  it('treats nail, mascara, lipstick, and face makeup as general cosmetics', () => {
    const general = [
      'Kozmetik & Kişisel Bakım/Makyaj/Tırnak/Oje',
      'Kozmetik & Kişisel Bakım/Makyaj/Tırnak/Kalıcı Oje',
      'Kozmetik & Kişisel Bakım/Makyaj/Göz Makyajı/Maskara',
      'Kozmetik & Kişisel Bakım/Makyaj/Göz Makyajı/Eyeliner',
      'Kozmetik & Kişisel Bakım/Makyaj/Dudak Makyajı/Ruj',
      'Kozmetik & Kişisel Bakım/Makyaj/Ten Makyajı/Fondöten',
      'Kozmetik & Kişisel Bakım/Makyaj/Makyaj Aksesuarları/Makyaj Çantası',
    ];
    for (const hierarchy of general) {
      expect(classifyGenderRelevance({ hierarchy, businessDomain: 'beauty' })).toMatchObject({
        relevance: 'gender_not_applicable',
        reason: 'cosmetics_general',
      });
    }
  });

  it('keeps explicitly gendered cosmetics reviewable', () => {
    expect(
      classifyGenderRelevance({
        hierarchy:
          'Kozmetik & Kişisel Bakım/Tıraş, Ağda ve Epilasyon/Islak Tıraş/Tıraş Bıçağı',
        businessDomain: 'beauty',
      }),
    ).toMatchObject({
      relevance: 'gender_required',
      reason: 'cosmetics_gender_specific',
      reasonBadge: 'آرایش نیازمند بررسی',
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Kozmetik & Kişisel Bakım/Erkek Bakım/Erkek Parfüm',
        businessDomain: 'beauty',
      }).reason,
    ).toBe('cosmetics_gender_specific');
  });

  it('keeps unknown cosmetic branches reviewable', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Kozmetik & Kişisel Bakım/Parfüm/Niche Parfüm',
        businessDomain: 'beauty',
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'cosmetics_ambiguous',
      reviewable: true,
    });
  });

  it('removes confident children sneakers stored under general footwear', () => {
    const base = {
      hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
      businessDomain: 'fashion_shoes',
    };
    expect(
      classifyGenderRelevance({
        ...base,
        sourceName: 'Cırtlı Çocuk Ayakkabı Unisex Çocuk Sneaker Hafif',
        ageGroup: 'adult',
      }),
    ).toMatchObject({
      relevance: 'gender_not_applicable',
      reason: 'kids_footwear',
      reasonBadge: 'کفش کودک',
    });

    expect(
      classifyGenderRelevance({
        ...base,
        sourceName: 'Court Borough Low 2 (Gs) Günlük Spor Ayakkabısı Sneaker',
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        ...base,
        sourceName: '26-31 Numara Önü Kapalı Çocuk Sandalet',
      }).reason,
    ).toBe('kids_footwear');
  });

  it('keeps adult sneakers with a missing gender in review', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Spor Günlük Sneaker Yürüyüş Ayakkabı Court Vision',
        ageGroup: 'child',
      }),
    ).toMatchObject({
      relevance: 'gender_required',
      reason: 'footwear',
      reasonBadge: 'کفش نیازمند بررسی',
    });
  });

  it('keeps ambiguous footwear and misleading title words reviewable', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Sneaker Bebek Yaka Bebek Mavisi',
        ageGroup: 'child',
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'footwear' });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Grand Court 2.0 Kids Ayakkabı',
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Droids Grand Court Cf I Bebek Günlük Ayakkabı',
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Kız Erkek Günlük Çocuk Sneaker',
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Erkek Sneaker',
        ageGroup: 'child',
      }).reason,
    ).toBe('footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Anzarun Lite AC Inf Sneaker',
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'S10171-033 Star Çocuk',
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'SUPERSTAR CRIB Spor Ayakkabı',
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Smash 3.0 Badges V Inf Kadın Sneaker',
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Kadın Çocuk Sneaker',
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
      reasonBadge: 'اطلاعات متناقض',
    });
  });

  it('uses a reliable age attribute and ignores color and stored gender', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Court Vision',
        attributes: [{ name: 'Yaş Grubu', value: 'Çocuk', kind: 'other' }],
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Court Vision',
        attributes: [{ name: 'Renk', value: 'Çocuk Mavisi', kind: 'color' }],
      }).reason,
    ).toBe('footwear');

    const decision = classifyGenderRelevance({
      hierarchy: 'Giyim/Üst Giyim/T-Shirt',
      businessDomain: 'fashion_apparel',
    });
    expect(decision).not.toHaveProperty('gender');
    expect(decision.reasonBadge).toBe('لباس بدون جنسیت');
  });

  const shoe = {
    hierarchy: 'Ayakkabı/Spor Ayakkabı/Koşu & Antrenman Ayakkabısı',
    businessDomain: 'fashion_shoes',
  };

  it('removes footwear whose Beden variants are entirely a children EU run', () => {
    const runfalcon = [
      '27,5', '28', '28,5', '29', '29,5', '30', '30,5', '31', '31,5', '32',
      '33', '33,5', '34', '35',
    ].map((value) => ({ sourceName: 'Beden', name: 'سایز', value, kind: 'other' }));
    const decision = classifyGenderRelevance({
      ...shoe,
      sourceName: '5 El C Lacivert Unisex Koşu Ve Antreman Ayakkabısı Runfalcon',
      name: 'کفش ران فالکون 5 کودکان',
      ageGroup: 'child',
      attributes: runfalcon,
    });
    expect(decision).toMatchObject({
      relevance: 'gender_not_applicable',
      reason: 'kids_footwear',
      reviewable: false,
    });
    expect(decision).not.toHaveProperty('gender');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'VL Court 3.0 Ayakkabı',
        ageGroup: 'adult',
        attributes: ['28', '35'].map((value) => ({ name: 'Beden', value, kind: 'other' })),
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Sandalet ve Terlik/Sandalet',
        businessDomain: 'fashion_shoes',
        sourceName: 'Krıxı Cırtlı Sandalet',
        attributes: [
          { name: 'Beden', value: '22', kind: 'other' },
          { name: 'Beden', value: '35', kind: 'other' },
          { name: 'Beden', value: '32"', kind: 'other' },
        ],
      }).reason,
    ).toBe('kids_footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Tensaur Hook and Loop Ayakkabı',
        attributes: [
          { name: 'Beden', value: '19', kind: 'other' },
          { name: 'Beden', value: '27', kind: 'other' },
          { name: 'Beden', value: 'standart', kind: 'other' },
          { name: 'Beden', value: 'tek ebat', kind: 'other' },
        ],
      }).reason,
    ).toBe('kids_footwear');
  });

  it('keeps adult and small-adult shoe sizes reviewable', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Hoops 3.0 Bold W Yüksek Taban Sneaker',
        ageGroup: 'child',
        attributes: ['36', '40', '44'].map((value) => ({ name: 'Beden', value, kind: 'other' })),
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'footwear' });

    expect(
      classifyGenderRelevance({
        ...shoe,
        sourceName: 'Kadın Sneaker Ayakkabı Anzarun Lite Jr',
        attributes: [
          { name: 'Beden', value: '35,5', kind: 'other' },
          { name: 'Beden', value: '39', kind: 'other' },
        ],
      }).reason,
    ).toBe('footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Sandalet ve Terlik/Sandalet',
        businessDomain: 'fashion_shoes',
        sourceName: 'Trita Siyah Cırtlı Sandalet',
        attributes: [
          { name: 'Beden', value: '35', kind: 'other' },
          { name: 'Beden', value: '41', kind: 'other' },
        ],
      }).reason,
    ).toBe('footwear');

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Hoops 3.0 Kadın Beyaz Sneaker',
        attributes: [
          { name: 'Beden', value: '35.5', kind: 'other' },
          { name: 'Beden', value: '425', kind: 'other' },
        ],
      }).reason,
    ).toBe('footwear');
  });

  it('keeps a children shoe title even when the Beden run is adult', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Cırtlı Çocuk Ayakkabı Sneaker',
        attributes: ['36', '40', '44'].map((value) => ({ name: 'Beden', value, kind: 'other' })),
      }).reason,
    ).toBe('kids_footwear');
  });

  it('keeps mixed child and adult shoe sizes reviewable', () => {
    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'L003 Neo Bebek Mavi Sneaker',
        name: 'کفش کودک',
        ageGroup: 'child',
        attributes: [
          { name: 'Beden', value: '19', kind: 'other' },
          { name: 'Beden', value: '41', kind: 'other' },
        ],
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
      reviewable: true,
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Tensaur Hook and Loop Ayakkabı',
        attributes: [
          { name: 'Beden', value: '27,5', kind: 'other' },
          { name: 'Beden', value: '40', kind: 'other' },
          { name: 'Beden', value: '38 2/3', kind: 'other' },
          { name: 'Beden', value: '36-37', kind: 'other' },
        ],
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
      reviewable: true,
    });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Ayakkabı/Spor Ayakkabı/Sneaker',
        businessDomain: 'fashion_shoes',
        sourceName: 'Kadın Çocuk Numara Ayakkabı',
        attributes: [
          { name: 'Beden', value: '28', kind: 'other' },
          { name: 'Beden', value: '30', kind: 'other' },
        ],
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
      reviewable: true,
    });
  });

  const apparel = {
    hierarchy: 'Giyim/Üst Giyim/T-Shirt',
    businessDomain: 'fashion_apparel',
  };

  it('removes children and newborn apparel filed under generic clothing', () => {
    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Erkek Çocuk Penye Polo Yaka T-shirt',
        ageGroup: null,
      }),
    ).toMatchObject({
      relevance: 'gender_not_applicable',
      reason: 'kids_apparel',
      reasonBadge: 'لباس کودک',
      reviewable: false,
    });

    expect(
      classifyGenderRelevance({
        ...apparel,
        hierarchy: 'Giyim/Salopet & Tulum/Tulum',
        sourceName: 'Düğmeli ikili Bebek Pijama Takımı',
        attributes: [{ name: 'Beden', value: 'Yeni Doğan', kind: 'other' }],
      }).reason,
    ).toBe('kids_apparel');

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Winnie The Pooh Arı Baskılı Tulum',
        attributes: [{ sourceName: 'Beden', valueSource: '0-3 Ay', kind: 'other' }],
      }).reason,
    ).toBe('kids_apparel');

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Pijama Takım',
        ageGroup: 'adult',
        attributes: [{ name: 'Beden', value: '4-5 Yaş', kind: 'other' }],
      }).reason,
    ).toBe('kids_apparel');

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Graphic Tişört',
        attributes: [
          { name: 'Beden', value: '6-9 Ay', kind: 'other' },
          { name: 'Beden', value: '12-18 Ay', kind: 'other' },
        ],
      }).reason,
    ).toBe('kids_apparel');
  });

  it('keeps adult letter and EU sizes reviewable when gender is missing', () => {
    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Radiohead Dna Breeding Siyah Kapşonlu',
        ageGroup: 'child',
        attributes: [
          { name: 'Beden', value: 'S', kind: 'other' },
          { name: 'Beden', value: 'M', kind: 'other' },
          { name: 'Beden', value: 'XL', kind: 'other' },
        ],
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'adult_apparel' });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Giyim/Üst Giyim/Gömlek',
        businessDomain: 'fashion_apparel',
        sourceName: 'Kadın Gri Düz Oversize Uzun Basic Gömlek',
        attributes: [
          { name: 'Beden', value: '36', kind: 'other' },
          { name: 'Beden', value: '50', kind: 'other' },
        ],
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'adult_apparel' });
  });

  it('does not treat bebek yaka or baby colors as children apparel', () => {
    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Bebek Yaka T-Shirt',
        ageGroup: 'child',
        attributes: [{ name: 'Yaka Tipi', value: 'Bebe Yaka', kind: 'other' }],
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'adult_apparel' });

    expect(
      classifyGenderRelevance({
        hierarchy: 'Giyim/Salopet & Tulum/Tulum',
        businessDomain: 'fashion_apparel',
        sourceName: 'Unisex Bebek Mavi Welsoft Tulum',
        name: 'سرهمی آبی نوزاد',
        attributes: [{ name: 'Renk', value: 'Bebek Mavisi', kind: 'color' }],
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'adult_apparel' });

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Bebek Pembesi Oversize Tişört',
        attributes: [{ name: 'Beden', value: 'M', kind: 'other' }],
      }).reason,
    ).toBe('adult_apparel');
  });

  it('keeps mixed sizes, mother-daughter sets, and missing evidence reviewable', () => {
    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Unisex Mor Bisiklet Yaka Sweatshirt',
        attributes: [
          { name: 'Beden', value: 'S', kind: 'other' },
          { name: 'Beden', value: '4-6 Yaş', kind: 'other' },
        ],
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
      reviewable: true,
    });

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Anne Kız Tişört (ADET FİYATI)',
        attributes: [
          { name: 'Beden', value: 'M', kind: 'other' },
          { name: 'Beden', value: '5-6 Yaş', kind: 'other' },
        ],
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
      reviewable: true,
    });

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Fermuarlı NASA Baskılı Unisex Alt Üst Eşofman Takımı',
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'adult_apparel' });

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Ayı Desenli Alt Üst Takım',
        ageGroup: 'child',
        attributes: [
          { name: 'Beden', value: '2', kind: 'other' },
          { name: 'Beden', value: '5', kind: 'other' },
        ],
      }).reason,
    ).toBe('adult_apparel');
  });

  it('does not assign an adult gender and ignores age group and Persian alone', () => {
    const decision = classifyGenderRelevance({
      ...apparel,
      sourceName: 'Çocuk Tişört',
      name: 'تیشرت کودک',
      ageGroup: 'child',
    });
    expect(decision).not.toHaveProperty('gender');
    expect(decision.reason).toBe('kids_apparel');

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Oversize Tişört',
        name: 'تیشرت کودک',
        ageGroup: 'child',
      }),
    ).toMatchObject({ relevance: 'gender_required', reason: 'adult_apparel' });

    expect(
      classifyGenderRelevance({
        ...apparel,
        sourceName: 'Kadın Çocuk Tişört',
      }),
    ).toMatchObject({
      relevance: 'gender_unresolved',
      reason: 'conflicting_signals',
      reviewable: true,
    });
  });

  it('does not change adult storefront gender eligibility', () => {
    expect(
      SLICE_ELIGIBLE_PRODUCT_GENDERS[SourceCategoryMappingGenderSlice.female],
    ).toEqual([ProductGender.female, ProductGender.unisex]);
    expect(
      SLICE_ELIGIBLE_PRODUCT_GENDERS[SourceCategoryMappingGenderSlice.male],
    ).toEqual([ProductGender.male, ProductGender.unisex]);
    expect(
      SLICE_ELIGIBLE_PRODUCT_GENDERS[SourceCategoryMappingGenderSlice.unisex],
    ).toEqual([ProductGender.unisex]);
    expect(
      SLICE_ELIGIBLE_PRODUCT_GENDERS[SourceCategoryMappingGenderSlice.any],
    ).toBeNull();
  });
});
