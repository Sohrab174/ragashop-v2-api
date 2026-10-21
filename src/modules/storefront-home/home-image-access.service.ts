import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigurationService } from '../../config/configuration.service';
import { StorefrontHomeSectionEntity } from './entities/storefront-home-section.entity';
import { StorefrontHomeSectionInstanceEntity } from './entities/storefront-home-section-instance.entity';
import {
  appendHomeDraftAssetQuery,
  HOME_DRAFT_ASSET_TTL_SEC,
  signHomeDraftAssetToken,
  verifyHomeDraftAssetToken,
} from './home-draft-asset-access';
import { buildPublishedLiveHomePathSet } from './home-published-live-paths';
import { parseJsonObject, sanitizeHomeUploadPath } from './storefront-home.validate';

const ALLOWLIST_TTL_MS = 15_000;

@Injectable()
export class HomeImageAccessService {
  private publishedLive = new Set<string>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigurationService,
    @InjectRepository(StorefrontHomeSectionEntity)
    private readonly sectionRepo: Repository<StorefrontHomeSectionEntity>,
    @InjectRepository(StorefrontHomeSectionInstanceEntity)
    private readonly instanceRepo: Repository<StorefrontHomeSectionInstanceEntity>,
  ) {}

  /** Call after Admin publish / upsert so public allowlist picks up new paths. */
  invalidatePublishedAllowlist(): void {
    this.loadedAt = 0;
    this.publishedLive = new Set();
  }

  private draftSecret(): string {
    const dedicated = String(process.env.HOME_DRAFT_ASSET_SECRET || '').trim();
    if (dedicated) return dedicated;
    return String(this.config.auth?.secret || '').trim();
  }

  async refreshPublishedAllowlist(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.loadedAt < ALLOWLIST_TTL_MS && this.loadedAt > 0) {
      return;
    }
    if (this.loading) {
      await this.loading;
      return;
    }
    this.loading = (async () => {
      const [sections, instances] = await Promise.all([
        this.sectionRepo.find({ select: ['sectionKey', 'configJson'] }),
        this.instanceRepo.find({ select: ['instanceKey', 'configJson'] }),
      ]);
      this.publishedLive = buildPublishedLiveHomePathSet({
        sectionConfigs: sections.map((row) => ({
          config: parseJsonObject(row.configJson),
        })),
        instanceConfigs: instances.map((row) => ({
          config: parseJsonObject(row.configJson),
        })),
      });
      this.loadedAt = Date.now();
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async isPublishedLiveLogicalPath(logicalPath: string): Promise<boolean> {
    const safe = sanitizeHomeUploadPath(logicalPath);
    if (!safe) return false;
    await this.refreshPublishedAllowlist();
    return this.publishedLive.has(safe);
  }

  signDraftToken(
    logicalPath: string,
    ttlSec = HOME_DRAFT_ASSET_TTL_SEC,
  ): string {
    return signHomeDraftAssetToken(logicalPath, this.draftSecret(), ttlSec);
  }

  buildSignedStaticUrl(
    logicalPath: string | undefined | null,
    ttlSec = HOME_DRAFT_ASSET_TTL_SEC,
  ): string | null {
    const safe = sanitizeHomeUploadPath(logicalPath ?? undefined);
    if (!safe) return null;
    const base = (this.config.app.apiBaseUrl || '').replace(/\/$/, '');
    const withoutSlash = safe.replace(/^\//, '');
    const [folder, ...rest] = withoutSlash.split('/');
    const filename = rest.join('/');
    if (!folder || !filename) return null;
    const absolute = `${base}/static/${folder}/${filename}`;
    try {
      const token = this.signDraftToken(safe, ttlSec);
      return appendHomeDraftAssetQuery(absolute, token);
    } catch {
      return null;
    }
  }

  buildPublicStaticUrl(
    logicalPath: string | undefined | null,
  ): string | null {
    const safe = sanitizeHomeUploadPath(logicalPath ?? undefined);
    if (!safe) return null;
    const base = (this.config.app.apiBaseUrl || '').replace(/\/$/, '');
    const withoutSlash = safe.replace(/^\//, '');
    const [folder, ...rest] = withoutSlash.split('/');
    const filename = rest.join('/');
    if (!folder || !filename) return null;
    return `${base}/static/${folder}/${filename}`;
  }

  /**
   * Authorize GET /static/home/:filename.
   * Published live assets: public.
   * Unpublished: require a valid path-bound expiring `hda` token (not filename secrecy).
   */
  async authorizeHomeStaticFilename(
    filename: string,
    draftToken?: string,
  ): Promise<'public' | 'signed' | 'deny'> {
    const safeName = String(filename || '');
    if (
      !/^[a-zA-Z0-9._-]+$/.test(safeName) ||
      safeName.includes('..') ||
      safeName.includes('/') ||
      safeName.includes('\\')
    ) {
      return 'deny';
    }
    const logical = `/home/${safeName}`;
    if (await this.isPublishedLiveLogicalPath(logical)) {
      return 'public';
    }
    const claims = verifyHomeDraftAssetToken(
      String(draftToken || ''),
      this.draftSecret(),
      logical,
    );
    return claims ? 'signed' : 'deny';
  }
}
