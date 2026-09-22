import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { ErrorService } from '../../error/error.service';
import { PrivateReceiptObjectEntity } from './entities/private-receipt-object.entity';
import {
  RECEIPT_ALLOWED_MIME_TYPES,
  RECEIPT_MAX_BYTES,
} from './manual-payment.types';
import { detectReceiptMimeFromBuffer } from './utils/receipt-content-validation';

export { detectReceiptMimeFromBuffer } from './utils/receipt-content-validation';

@Injectable()
export class PrivateReceiptStorageService {
  private readonly rootDir: string;

  constructor(
    @InjectRepository(PrivateReceiptObjectEntity)
    private readonly receiptRepository: Repository<PrivateReceiptObjectEntity>,
    private readonly error: ErrorService,
  ) {
    this.rootDir = path.resolve(process.cwd(), 'private-receipts');
  }

  getRootDir(): string {
    return this.rootDir;
  }

  assertAllowedMime(mimeType: string): void {
    const normalized = (mimeType || '').toLowerCase().trim();
    if (
      !(RECEIPT_ALLOWED_MIME_TYPES as readonly string[]).includes(normalized)
    ) {
      this.error.unprocessableEntity([
        'فرمت فایل رسید مجاز نیست (jpg/png/webp/pdf)',
      ]);
    }
  }

  assertSizeLimit(sizeBytes: number): void {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      this.error.unprocessableEntity(['فایل رسید خالی است']);
    }
    if (sizeBytes > RECEIPT_MAX_BYTES) {
      this.error.unprocessableEntity(['حجم فایل رسید بیش از حد مجاز است']);
    }
  }

  /**
   * Persist buffer under ./private-receipts with UUID storage key.
   * MIME is taken only after structural content validation (declared ignored).
   */
  async storeBuffer(params: {
    buffer: Buffer;
    originalFilename: string;
    mimeType?: string;
    customerId: number;
  }): Promise<PrivateReceiptObjectEntity> {
    this.assertSizeLimit(params.buffer.length);

    const detected = await detectReceiptMimeFromBuffer(params.buffer);
    if (!detected) {
      this.error.unprocessableEntity([
        'فرمت فایل رسید مجاز نیست (jpg/png/webp/pdf)',
      ]);
    }
    this.assertAllowedMime(detected);

    const safeName = path.basename(params.originalFilename || 'receipt');
    const objectKey = uuid();
    const ext = this.extensionForMime(detected);
    const storageKey = `${objectKey}${ext}`;
    const absolutePath = this.resolveSafePath(storageKey);

    await fs.promises.mkdir(this.rootDir, { recursive: true });
    await fs.promises.writeFile(absolutePath, params.buffer, { flag: 'wx' });

    const sha256 = crypto
      .createHash('sha256')
      .update(params.buffer)
      .digest('hex');

    try {
      const { identifiers } = await this.receiptRepository
        .createQueryBuilder()
        .insert()
        .values({
          objectKey,
          storageKey,
          originalFilename: safeName.slice(0, 255),
          mimeType: detected,
          sizeBytes: params.buffer.length,
          sha256,
          customerId: params.customerId,
          createdAt: new Date(),
        })
        .execute();

      const id = identifiers[0].id;
      return this.receiptRepository.findOne({ where: { id } });
    } catch (err) {
      await this.deleteOrphanFile(storageKey);
      throw err;
    }
  }

  async getByObjectKey(
    objectKey: string,
  ): Promise<PrivateReceiptObjectEntity | null> {
    return this.receiptRepository.findOne({ where: { objectKey } });
  }

  async getById(id: number): Promise<PrivateReceiptObjectEntity | null> {
    return this.receiptRepository.findOne({ where: { id } });
  }

  resolveSafePath(storageKey: string): string {
    const base = path.basename(storageKey);
    if (base !== storageKey || storageKey.includes('..')) {
      this.error.unprocessableEntity(['مسیر فایل نامعتبر است']);
    }
    const absolute = path.resolve(this.rootDir, base);
    if (
      !absolute.startsWith(this.rootDir + path.sep) &&
      absolute !== this.rootDir
    ) {
      this.error.unprocessableEntity(['مسیر فایل نامعتبر است']);
    }
    return absolute;
  }

  async openReadStream(storageKey: string): Promise<fs.ReadStream> {
    const absolute = this.resolveSafePath(storageKey);
    await fs.promises.access(absolute, fs.constants.R_OK);
    return fs.createReadStream(absolute);
  }

  async deleteOrphanFile(storageKey: string): Promise<void> {
    try {
      const absolute = this.resolveSafePath(storageKey);
      await fs.promises.unlink(absolute);
    } catch {
      // best-effort orphan cleanup
    }
  }

  /** Delete file + DB receipt row after a failed submission TX. */
  async deleteOrphanReceipt(receipt: {
    id?: number;
    storageKey: string;
  }): Promise<void> {
    await this.deleteOrphanFile(receipt.storageKey);
    if (receipt.id != null) {
      try {
        await this.receiptRepository.delete({ id: receipt.id });
      } catch {
        // best-effort
      }
    }
  }

  private extensionForMime(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'application/pdf':
        return '.pdf';
      default:
        return '';
    }
  }
}
