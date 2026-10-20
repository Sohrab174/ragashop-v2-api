import {
  HOME_MASTER_ALLOWED_FIELDS,
  assertHomeMasterBodyFields,
  homeMasterMulterLimitMessage,
  homeMasterMulterOptions,
} from './home-master-multer';
import { HOME_MASTER_MAX_BYTES } from './home-master-image';
import { HttpException } from '@nestjs/common';

describe('home-master-multer', () => {
  it('exposes the expected multipart field contract', () => {
    expect([...HOME_MASTER_ALLOWED_FIELDS]).toEqual([
      'profile',
      'focusDesktopX',
      'focusDesktopY',
      'focusMobileX',
      'focusMobileY',
    ]);
  });

  it('applies strict route-specific limits', () => {
    const opts = homeMasterMulterOptions();
    expect(opts.limits).toEqual({
      files: 1,
      fileSize: HOME_MASTER_MAX_BYTES,
      fields: 5,
      parts: 6,
      fieldNameSize: 32,
      fieldSize: 64,
    });
  });

  it('maps Multer limit codes to stable messages', () => {
    expect(homeMasterMulterLimitMessage('LIMIT_FIELD_COUNT')).toMatch(/فیلد/);
    expect(homeMasterMulterLimitMessage('LIMIT_PART_COUNT')).toMatch(/بخش/);
    expect(homeMasterMulterLimitMessage('LIMIT_FIELD_VALUE')).toMatch(/مقدار/);
    expect(homeMasterMulterLimitMessage('LIMIT_FILE_SIZE')).toMatch(/حجم/);
  });

  it('rejects unexpected body fields', () => {
    expect(() =>
      assertHomeMasterBodyFields({ profile: 'hero', evil: 'x' }),
    ).toThrow(HttpException);
    try {
      assertHomeMasterBodyFields({ profile: 'hero', evil: 'x' });
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(422);
    }
  });

  it('allows the documented focus and profile fields', () => {
    expect(() =>
      assertHomeMasterBodyFields({
        profile: 'category',
        focusDesktopX: '50',
        focusDesktopY: '20',
        focusMobileX: '40',
        focusMobileY: '60',
      }),
    ).not.toThrow();
  });

  it('rejects non-file field names in fileFilter', () => {
    const opts = homeMasterMulterOptions();
    const cb = jest.fn();
    opts.fileFilter(
      {} as any,
      { fieldname: 'other', mimetype: 'image/jpeg', originalname: 'a.jpg' } as any,
      cb,
    );
    expect(cb).toHaveBeenCalled();
    const err = cb.mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(422);
  });
});
