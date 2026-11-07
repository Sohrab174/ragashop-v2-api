import { buildStorefrontPdpGallery } from './storefront-pdp.gallery';
import {
  buildStorefrontPdpDescription,
  stripHtmlToPlainText,
} from './storefront-pdp.description';
import { mapStorefrontPdpAttributesAndOptions } from './storefront-pdp.options';
import {
  resolveStorefrontPdpAvailability,
  STOREFRONT_PDP_LOW_STOCK_THRESHOLD,
} from './storefront-pdp.availability';
import {
  buildCanonicalBreadcrumbTrail,
  compactBreadcrumbTrail,
} from './storefront-pdp.breadcrumb';
import { mapStorefrontPdpProduct } from './storefront-pdp.mapper';
import {
  effectiveSellPrice,
  isRealSale,
  visibleDiscountPercent,
} from './storefront-plp.pricing';

describe('storefront-pdp.gallery', () => {
  it('puts cover first and dedupes matching gallery path', () => {
    const images = buildStorefrontPdpGallery(
      { id: 1, pathFile: '/products/a.jpg' },
      [
        { id: 2, pathFile: '/products/a.jpg', type: 'photo' },
        { id: 3, pathFile: '/products/b.jpg', type: 'photo' },
        { id: 4, pathFile: '/products/c.mp4', type: 'video' },
      ],
    );
    expect(images).toEqual([
      { id: 1, path: '/products/a.jpg' },
      { id: 3, path: '/products/b.jpg' },
    ]);
  });

  it('works without cover', () => {
    const images = buildStorefrontPdpGallery(null, [
      { id: 9, pathFile: 'cdn/x.jpg', type: 'photo' },
    ]);
    expect(images).toEqual([{ id: 9, path: 'cdn/x.jpg' }]);
  });

  it('skips empty and invalid paths', () => {
    const images = buildStorefrontPdpGallery({ id: 1, pathFile: '   ' }, [
      { id: 2, pathFile: '', type: 'photo' },
      { id: 3, pathFile: 'null', type: 'photo' },
      { id: 4, pathFile: '/products/ok.jpg', type: 'photo' },
      { id: 5, pathFile: '/products/ok.jpg', type: 'photo' },
    ]);
    expect(images).toEqual([{ id: 4, path: '/products/ok.jpg' }]);
  });
});

describe('storefront-pdp.description', () => {
  it('strips HTML and script blocks', () => {
    const plain = stripHtmlToPlainText(
      '<p>Hello</p><script>alert(1)</script><div>World</div>',
    );
    expect(plain).toBe('Hello\nWorld');
    expect(plain).not.toContain('script');
  });

  it('skips deleted rows and prefers content', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: '<p>پارچه نرم برای استفاده روزانه</p>',
        displayOrder: 2,
        isDeleted: false,
      },
      {
        content: 'Gone',
        displayOrder: 1,
        isDeleted: true,
      },
    ]);
    expect(text).toContain('پارچه نرم');
    expect(text).not.toContain('Gone');
  });

  it('prefers Persian content and skips source-language twin', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: 'این محصول از جنس شیفون نرم برای استفاده مجلسی ساخته شده است.',
        sourceContent:
          'This product is made of soft chiffon fabric for evening use.',
        displayOrder: 0,
        isDeleted: false,
      },
      {
        content:
          'This product is made of soft chiffon fabric for evening use.',
        sourceContent:
          'This product is made of soft chiffon fabric for evening use.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('شیفون');
    expect(text).not.toMatch(/soft chiffon fabric/i);
  });

  it('falls back to source language when translation missing', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: 'Pamuklu kumaş yumuşak dokuya sahiptir ve günlük kullanım için uygundur.',
        sourceContent:
          'Pamuklu kumaş yumuşak dokuya sahiptir ve günlük kullanım için uygundur.',
        displayOrder: 0,
        isDeleted: false,
      },
    ]);
    expect(text).toMatch(/Pamuklu kumaş|cotton|yumuşak|fabric/i);
  });

  it('removes import machine tokens while preserving genuine prose', () => {
    const text = buildStorefrontPdpDescription([
      {
        content:
          'پارچه نخی نرم و سبک.\n[page]["page":"merchant_info"]\nمناسب استفاده روزانه.\nreturn_conditions\npage= merchant /page',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('پارچه نخی نرم و سبک');
    expect(text).toContain('مناسب استفاده روزانه');
    expect(text).not.toContain('[page]');
    expect(text).not.toContain('merchant_info');
    expect(text).not.toContain('return_conditions');
    expect(text).not.toMatch(/\/page/i);
  });

  it('suppresses marketplace operational boilerplate without retailer names', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: [
          'این محصول از جنس پنبه با بافت نرم ساخته شده است.',
          'این کالا توسط فروشنده ارسال خواهد شد و ممکن است توسط چند فروشنده ارائه شود.',
          'یک محصول می‌تواند توسط چندین فروشنده عرضه شود.',
          'برای اطلاعات بیشتر .',
          'این محصول توسط ارسال خواهد شد.',
          'فروشندگان بر اساس رتبه رتبه‌بندی می‌شوند.',
          'کمتر از ۵ عدد در انبار باقی مانده است که با قیمت ویژه به فروش می‌رسد.',
          'حداکثر ۱۰ عدد از این محصول قابل سفارش است. Trendyol حق لغو سفارش‌های بیش از ۱۰ عدد را محفوظ می‌دارد.',
          'بازگشت رایگان در مدت 15 روز. برای اطلاعات بیشتر .',
          'شرایط بازگشت کالا مطابق قوانین پلتفرم است.',
          'ابعاد محصول حدود ۲۰ سانتی‌متر است.',
        ].join('\n\n'),
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('پنبه');
    expect(text).toContain('ابعاد محصول');
    expect(text).not.toMatch(/چند(?:ین)?\s*فروشنده/);
    expect(text).not.toMatch(/برای اطلاعات بیشتر/);
    expect(text).not.toMatch(/رتبه‌بندی/);
    expect(text).not.toMatch(/ارسال خواهد/);
    expect(text).not.toMatch(/کمتر از/);
    expect(text).not.toMatch(/حداکثر/);
    expect(text).not.toMatch(/Trendyol/i);
    expect(text).not.toMatch(/بازگشت رایگان/);
    expect(text).not.toMatch(/شرایط بازگشت/);
  });

  it('filters ops via generic signals without a retailer-name list (PDP1-M1)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: [
          'پارچه نخی سبک مناسب فصل گرم.',
          'حداکثر ۵ عدد از این محصول قابل سفارش است. Hepsiburada حق لغو سفارش را محفوظ می‌دارد.',
          'Amazon Basics پنبه ارگانیک در ترکیب پارچه استفاده شده است.',
        ].join('\n\n'),
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('پارچه نخی');
    expect(text).toContain('Amazon Basics');
    expect(text).toContain('پنبه ارگانیک');
    expect(text).not.toMatch(/حداکثر/);
    expect(text).not.toMatch(/Hepsiburada/i);
    expect(text).not.toMatch(/قابل سفارش/);
  });

  it('keeps product-fact sentence from a mixed product+ops paragraph', () => {
    const text = buildStorefrontPdpDescription([
      {
        content:
          'این محصول از پارچه پنبه‌ای تولید شده است. ارسال توسط فروشنده انجام می‌شود.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('پارچه پنبه‌ای');
    expect(text).not.toMatch(/ارسال/);
    expect(text).not.toMatch(/فروشنده/);
  });

  it('omits low-value residual when only marketplace ops + orphan fragment remain', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: 'سه گانه کاسکورسه',
        displayOrder: 0,
        isDeleted: false,
      },
      {
        content:
          'کمتر از ۵ عدد در انبار باقی مانده است که با قیمت ویژه به فروش می‌رسد.',
        displayOrder: 4,
        isDeleted: false,
      },
      {
        content:
          'حداکثر ۱۰ عدد از این محصول قابل سفارش است. Trendyol حق لغو سفارش‌های بیش از ۱۰ عدد را محفوظ می‌دارد.',
        displayOrder: 1003,
        isDeleted: false,
      },
      {
        content: 'بازگشت رایگان در مدت 15 روز. برای اطلاعات بیشتر .',
        displayOrder: 1005,
        isDeleted: false,
      },
    ]);
    expect(text).toBeNull();
  });

  it('dedupes identical product-fact paragraphs once', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: 'فاقد پارابن و گلوتن.\nفاقد پارابن و گلوتن.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toBe('فاقد پارابن و گلوتن.');
  });

  it('omits lines that duplicate structured attributes', () => {
    const text = buildStorefrontPdpDescription(
      [
        {
          content: 'جنس: پنبه\nپارچه لطیف و سبک برای استفاده روزانه',
          displayOrder: 1,
          isDeleted: false,
        },
      ],
      null,
      null,
      [{ name: 'جنس', value: 'پنبه' }],
    );
    expect(text).toContain('پارچه لطیف');
    expect(text).not.toMatch(/^جنس:\s*پنبه$/m);
  });

  it('keeps explanatory prose that mentions an attribute value', () => {
    const text = buildStorefrontPdpDescription(
      [
        {
          content: 'پارچه پنبه‌ای نرم و تنفس‌پذیر برای استفاده روزمره.',
          displayOrder: 1,
          isDeleted: false,
        },
      ],
      null,
      null,
      [{ name: 'جنس', value: 'پنبه' }],
    );
    expect(text).toContain('پارچه پنبه‌ای نرم');
  });

  it('drops online-purchase marketplace ops even if color words appear', () => {
    const text = buildStorefrontPdpDescription([
      {
        content:
          'با قابلیت شستشو در دمای ۳۰ درجه نگهداری آسانی دارد.\nبا ویژگی رنگ وب، به راحتی به صورت آنلاین یافت و خریداری می‌شود.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('شستشو');
    expect(text).not.toMatch(/آنلاین/);
    expect(text).not.toMatch(/خریداری/);
  });

  // PDP-1 description boilerplate — Persian marketplace policy fragments (A–I)
  it('removes seller/fulfillment boilerplate (A)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: 'پارچه نخی سبک.\nفروش و ارسال توسط فروشنده\nجنس پنبه نرم.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('پارچه نخی');
    expect(text).toContain('جنس پنبه');
    expect(text).not.toMatch(/فروش\s+و\s+ارسال\s+توسط/);
  });

  it('removes order-limit / cancel-rights policy (B)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content:
          'ابعاد محصول ۲۰ سانتی‌متر است.\nاین پلتفرم حق دارد سفارشات بیش از ۱۰ عدد را لغو کند.\nرنگ مشکی مات.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('ابعاد محصول');
    expect(text).toContain('رنگ مشکی');
    expect(text).not.toMatch(/حق\s+دارد/);
    expect(text).not.toMatch(/لغو/);
    expect(text).not.toMatch(/سفارشات\s+بیش\s+از/);
  });

  it('removes return-policy مرجوعی boilerplate (C)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content:
          'قابل شستشو در دمای ۳۰ درجه.\nامکان مرجوعی رایگان ظرف ۱۵ روز وجود دارد.\nبافت نرم و سبک.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('شستشو');
    expect(text).toContain('بافت نرم');
    expect(text).not.toMatch(/مرجوعی/);
  });

  it('removes click/details navigation fragment (D)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content:
          'یقه گرد و آستین کوتاه.\nبرای جزئیات، کلیک کنید.\nمناسب استفاده روزانه.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('یقه گرد');
    expect(text).toContain('استفاده روزانه');
    expect(text).not.toMatch(/کلیک/);
    expect(text).not.toMatch(/برای\s+جزئیات/);
  });

  it('preserves genuine size-guidance prose (E)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content:
          'برای مشتریانی که بین دو سایز هستند، انتخاب سایز بزرگ‌تر ممکن است استفاده راحت‌تری را فراهم کند.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('بین دو سایز');
    expect(text).toContain('سایز بزرگ‌تر');
  });

  it('preserves genuine composition fact (F)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: 'پارچه این محصول ۸۰٪ پنبه و ۲۰٪ پلی‌استر است.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('۸۰٪ پنبه');
    expect(text).toContain('پلی‌استر');
  });

  it('does not remove content merely for a retailer/brand name (G)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content: 'Amazon Basics پیراهن نخی با ترکیب ۱۰۰٪ پنبه',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('Amazon Basics');
    expect(text).toContain('۱۰۰٪ پنبه');
  });

  it('keeps product fact and drops ops in a mixed paragraph (H)', () => {
    const text = buildStorefrontPdpDescription([
      {
        content:
          'پارچه این محصول ۸۰٪ پنبه و ۲۰٪ پلی‌استر است. امکان مرجوعی رایگان ظرف ۱۵ روز وجود دارد.',
        displayOrder: 1,
        isDeleted: false,
      },
    ]);
    expect(text).toContain('۸۰٪ پنبه');
    expect(text).not.toMatch(/مرجوعی/);
  });

  it('recognizes order/return policy with Persian/Arabic/ASCII digits (I)', () => {
    const variants = [
      'این پلتفرم حق دارد سفارشات بیش از ۱۰ عدد را لغو کند.',
      'این پلتفرم حق دارد سفارشات بیش از 10 عدد را لغو کند.',
      'این پلتفرم حق دارد سفارشات بیش از ١٠ عدد را لغو کند.',
      'امکان مرجوعی رایگان ظرف ۱۵ روز وجود دارد.',
      'امکان مرجوعی رایگان ظرف 15 روز وجود دارد.',
      'امکان مرجوعی رایگان ظرف ١٥ روز وجود دارد.',
    ];
    for (const content of variants) {
      const text = buildStorefrontPdpDescription([
        {
          content: `جنس پنبه نرم.\n${content}\nابعاد ۲۰ سانتی‌متر.`,
          displayOrder: 1,
          isDeleted: false,
        },
      ]);
      expect(text).toContain('جنس پنبه');
      expect(text).toContain('ابعاد');
      expect(text).not.toMatch(/لغو|مرجوعی/);
    }
  });
});

describe('storefront-pdp.options', () => {
  const pav = (
    id: number,
    attrId: number,
    attrName: string,
    valueName: string,
    quantity = -1,
    price: number | null = null,
  ) => ({
    id,
    quantity,
    price,
    discountedPrice: null as number | null,
    attributeValue: {
      id: id * 10,
      name: valueName,
      extraValue: null,
      attributeId: attrId,
      attribute: { id: attrId, name: attrName, type: 'other' },
    },
  });

  it('keeps commerce-signaled multi-value as the only purchase option', () => {
    const { options, attributes } = mapStorefrontPdpAttributesAndOptions(
      [
        pav(1, 7, 'سایز', 'S', -1, 100),
        pav(2, 7, 'سایز', 'M', 0, 100),
        pav(3, 8, 'جنس', 'پنبه'),
      ],
      10000,
    );

    expect(options).toHaveLength(1);
    expect(options[0].name).toBe('سایز');
    expect(options[0].required).toBe(true);
    expect(options[0].values.find((v) => v.label === 'M')?.available).toBe(
      false,
    );
    expect(attributes).toEqual([
      { attributeId: 8, name: 'جنس', value: 'پنبه' },
    ]);
  });

  it('does not restore stale discounts on selected PAV prices', () => {
    const first = { ...pav(11, 7, 'سایز', 'S', 2, 100), discountedPrice: 70 };
    const second = { ...pav(12, 7, 'سایز', 'M', 2, 100), discountedPrice: 70 };
    const { options } = mapStorefrontPdpAttributesAndOptions([first, second], 10, false);
    expect(options[0].values.map((value) => value.price)).toEqual([1000, 1000]);
    expect(options[0].values.every((value) => value.compareAtPrice == null && value.discount == null)).toBe(true);
  });

  it('does not promote descriptive multi-value groups to purchase options', () => {
    const { options, attributes } = mapStorefrontPdpAttributesAndOptions(
      [
        pav(1, 20, 'اطلاعات ایمنی', 'نگهداری دور از حرارت'),
        pav(2, 20, 'اطلاعات ایمنی', 'دور از دسترس کودکان'),
        pav(3, 7, 'سایز', 'S', -1, 50),
        pav(4, 7, 'سایز', 'M', -1, 50),
      ],
      10000,
    );
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe('سایز');
    expect(attributes.some((a) => a.name === 'اطلاعات ایمنی')).toBe(true);
    expect(attributes.find((a) => a.name === 'اطلاعات ایمنی')?.value).toContain(
      'نگهداری دور از حرارت',
    );
  });

  it('allows a single silent multi-value group as purchase option', () => {
    const { options } = mapStorefrontPdpAttributesAndOptions(
      [pav(1, 7, 'سایز', 'S'), pav(2, 7, 'سایز', 'M')],
      10000,
    );
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe('سایز');
  });

  it('dedupes identical descriptive attribute rows', () => {
    const { attributes } = mapStorefrontPdpAttributesAndOptions(
      [pav(1, 8, 'جنس', 'پنبه'), pav(2, 9, 'جنس', 'پنبه')],
      10000,
    );
    expect(attributes).toHaveLength(1);
    expect(attributes[0].value).toBe('پنبه');
  });

  it('dedupes identical option labels into a descriptive attribute', () => {
    const { options, attributes } = mapStorefrontPdpAttributesAndOptions(
      [
        pav(
          1,
          218,
          'اطلاعات ایمنی محصول',
          'کلاس 4.3 مواد قابل اشتعال در تماس با آب',
        ),
        pav(
          2,
          218,
          'اطلاعات ایمنی محصول',
          'کلاس 4.3 مواد قابل اشتعال در تماس با آب',
        ),
        pav(3, 5, 'رنگ', 'نارنجی'),
      ],
      10000,
    );
    expect(options).toHaveLength(0);
    expect(
      attributes.filter((a) => a.name === 'اطلاعات ایمنی محصول'),
    ).toHaveLength(1);
    expect(
      attributes.find((a) => a.name === 'اطلاعات ایمنی محصول')?.value,
    ).toBe('کلاس 4.3 مواد قابل اشتعال در تماس با آب');
  });

  it('excludes مبدأ attribute from public contract', () => {
    const { options, attributes } = mapStorefrontPdpAttributesAndOptions(
      [pav(1, 99, 'مبدأ', 'Trendyol')],
      10000,
    );
    expect(options).toEqual([]);
    expect(attributes).toEqual([]);
  });
});

describe('storefront-pdp.availability', () => {
  it('marks unlimited stock as in_stock', () => {
    expect(
      resolveStorefrontPdpAvailability({ quantity: -1, isSellable: true }),
    ).toEqual({ status: 'in_stock', purchasable: true, quantity: null });
  });

  it('marks quantity 0 as out_of_stock', () => {
    expect(resolveStorefrontPdpAvailability({ quantity: 0 })).toEqual({
      status: 'out_of_stock',
      purchasable: false,
      quantity: 0,
    });
  });

  it('uses low_stock when finite and under threshold', () => {
    const result = resolveStorefrontPdpAvailability({
      quantity: STOREFRONT_PDP_LOW_STOCK_THRESHOLD,
    });
    expect(result.status).toBe('low_stock');
    expect(result.purchasable).toBe(true);
    expect(result.quantity).toBe(STOREFRONT_PDP_LOW_STOCK_THRESHOLD);
  });

  it('out_of_stock when all required options unavailable', () => {
    expect(
      resolveStorefrontPdpAvailability({
        quantity: -1,
        hasRequiredOptions: true,
        allOptionsUnavailable: true,
      }),
    ).toEqual({ status: 'out_of_stock', purchasable: false, quantity: 0 });
  });
});

describe('storefront-pdp.breadcrumb', () => {
  it('builds root→leaf trail and compacts deep chains', () => {
    const byId = new Map([
      [1, { id: 1, parentId: null, name: 'زنانه', status: 'active' }],
      [2, { id: 2, parentId: 1, name: 'پوشاک', status: 'active' }],
      [3, { id: 3, parentId: 2, name: 'شلوار', status: 'active' }],
      [4, { id: 4, parentId: 3, name: 'جین', status: 'active' }],
    ]);
    const trail = buildCanonicalBreadcrumbTrail(4, byId);
    expect(trail.map((t) => t.name)).toEqual([
      'زنانه',
      'پوشاک',
      'شلوار',
      'جین',
    ]);
    expect(compactBreadcrumbTrail(trail, 3).map((t) => t.name)).toEqual([
      'پوشاک',
      'شلوار',
      'جین',
    ]);
  });
});

describe('storefront-pdp.mapper pricing', () => {
  const base = {
    id: 10,
    name: 'Test Product',
    quantity: -1,
    isSellable: true,
    cover: { id: 1, pathFile: '/products/x.jpg' },
    brand: { name: 'Brand', sourceName: null },
    productGalleries: [],
    productDescriptions: [],
    productAttributeValues: [],
  };

  it('maps real sale with compareAt and discount', () => {
    expect(isRealSale(100, 80)).toBe(true);
    const mapped = mapStorefrontPdpProduct(
      { ...base, price: 100, discountedPrice: 80 },
      10,
      [],
    );
    expect(mapped.price).toBe(800);
    expect(mapped.compareAtPrice).toBe(1000);
    expect(mapped.discount).toBe(20);
  });

  it('suppresses stale external product and PAV discounts and blocks purchase', () => {
    const mapped = mapStorefrontPdpProduct({
      ...base, supplyType: 'external_source', sourceUrl: '/item/p-123',
      sourceAvailability: 'unknown', sourceSyncStatus: 'never_verified',
      availabilityLastConfirmedAt: null, price: 100, discountedPrice: 70,
      productAttributeValues: [],
    }, 10, []);
    expect(mapped.price).toBe(1000);
    expect(mapped.compareAtPrice).toBeNull();
    expect(mapped.discount).toBeNull();
    expect(mapped.availability.sourceVerificationRequired).toBe(true);
    expect(mapped.availability.purchasable).toBe(false);
    expect(mapped.sourceUrl).toBe('/item/p-123');
  });

  it('ignores equal discountedPrice (non-sale)', () => {
    expect(isRealSale(100, 100)).toBe(false);
    const mapped = mapStorefrontPdpProduct(
      { ...base, price: 100, discountedPrice: 100 },
      10,
      [],
    );
    expect(mapped.price).toBe(1000);
    expect(mapped.compareAtPrice).toBeNull();
    expect(mapped.discount).toBeNull();
  });

  it('ignores greater discountedPrice (non-sale)', () => {
    expect(isRealSale(100, 120)).toBe(false);
    expect(effectiveSellPrice(100, 120)).toBe(100);
    expect(visibleDiscountPercent(100, 120)).toBeNull();
    const mapped = mapStorefrontPdpProduct(
      { ...base, price: 100, discountedPrice: 120 },
      10,
      [],
    );
    expect(mapped.price).toBe(1000);
    expect(mapped.compareAtPrice).toBeNull();
  });

  it('does not leak source fields in public shape', () => {
    const mapped = mapStorefrontPdpProduct(
      { ...base, price: 50, discountedPrice: null },
      10,
      [{ id: 1, name: 'زنانه' }],
    );
    expect(mapped).not.toHaveProperty('source');
    expect(mapped).not.toHaveProperty('sourceId');
    expect(mapped).not.toHaveProperty('sourceGroupId');
    expect(mapped.breadcrumb).toEqual([{ id: 1, name: 'زنانه' }]);
  });
});
