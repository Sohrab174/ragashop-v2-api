import { HttpException, HttpStatus } from '@nestjs/common';
import { diskStorage } from 'multer';
import { v4 as uuid } from 'uuid';
import * as path from 'path';
import { convertMimeToExt } from '../../utils/extension';
import { HOME_MASTER_MAX_BYTES } from './home-master-image';

/** Allowed non-file multipart field names for master upload. */
export const HOME_MASTER_ALLOWED_FIELDS = [
  'profile',
  'focusDesktopX',
  'focusDesktopY',
  'focusMobileX',
  'focusMobileY',
] as const;

export type HomeMasterAllowedField = (typeof HOME_MASTER_ALLOWED_FIELDS)[number];

const ALLOWED_FIELD_SET = new Set<string>(HOME_MASTER_ALLOWED_FIELDS);

/**
 * Route-specific Multer for POST /storefront/home/image/admin/master.
 * Does not change the legacy 1 MB home upload options.
 *
 * Contract: 1 file (`file`) + up to 5 short text fields.
 */
export function homeMasterMulterOptions() {
  return {
    limits: {
      files: 1,
      fileSize: HOME_MASTER_MAX_BYTES,
      /** profile + 4 focus fields */
      fields: HOME_MASTER_ALLOWED_FIELDS.length,
      /** 1 file + 5 fields */
      parts: HOME_MASTER_ALLOWED_FIELDS.length + 1,
      fieldNameSize: 32,
      /** Focus percents and profile names are tiny. */
      fieldSize: 64,
    },
    fileFilter: (req, file, callback) => {
      if (file.fieldname !== 'file') {
        callback(
          new HttpException(
            'فیلد فایل نامعتبر است',
            HttpStatus.UNPROCESSABLE_ENTITY,
          ),
          false,
        );
        return;
      }
      const ext = convertMimeToExt(file.mimetype);
      if (['jpg', 'jpeg', 'png', 'webp'].indexOf(ext) === -1) {
        callback(
          new HttpException(
            `t.It is not possible to upload a file with ${path
              .extname(file.originalname)
              .replace('.', '')
              .toUpperCase()} format!`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          ),
          false,
        );
        return;
      }
      callback(null, true);
    },
    storage: diskStorage({
      destination: './uploads/home',
      filename: (_req, file, callback) => {
        callback(null, `${uuid()}${path.extname(file.originalname)}`);
      },
    }),
  };
}

/**
 * Reject unexpected multipart text fields after Multer parses the body.
 * Call from the controller before processing.
 */
export function assertHomeMasterBodyFields(
  body: Record<string, unknown> | null | undefined,
): void {
  if (!body || typeof body !== 'object') return;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELD_SET.has(key)) {
      throw new HttpException(
        `فیلد غیرمجاز: ${key}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}

/** Map Multer limit errors to a stable 422 message. */
export function homeMasterMulterLimitMessage(code: string | undefined): string {
  switch (code) {
    case 'LIMIT_FILE_SIZE':
      return 'حجم تصویر اصلی بیش از حد مجاز است';
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return 'فقط یک فایل تصویر پذیرفته می‌شود';
    case 'LIMIT_FIELD_COUNT':
      return 'تعداد فیلدهای فرم بیش از حد مجاز است';
    case 'LIMIT_PART_COUNT':
      return 'تعداد بخش‌های درخواست بیش از حد مجاز است';
    case 'LIMIT_FIELD_VALUE':
      return 'مقدار یکی از فیلدهای فرم بیش از حد مجاز است';
    case 'LIMIT_FIELD_KEY':
      return 'نام فیلد فرم بیش از حد مجاز است';
    default:
      return 'درخواست آپلود نامعتبر است';
  }
}
