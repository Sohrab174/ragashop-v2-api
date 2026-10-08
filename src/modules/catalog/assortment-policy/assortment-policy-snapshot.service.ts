import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryAssortmentResolutionEntity } from './entities/category-assortment-resolution.entity';
import { AssortmentPolicyStateEntity } from './entities/assortment-policy-state.entity';
import {
  AssortmentPolicySnapshot,
  AssortmentPolicySnapshotRow,
} from './assortment-enforcement';
import { AssortmentPolicyStatus } from './assortment-policy.types';
import { AssortmentPolicyRecomputeService } from './assortment-policy.recompute.service';

/**
 * Internal versioned policy snapshot for crawler consumption.
 * Before serving, materializes any missing category resolutions via the
 * existing evaluator (no-op when the table is already complete).
 */
@Injectable()
export class AssortmentPolicySnapshotService {
  constructor(
    @InjectRepository(CategoryAssortmentResolutionEntity)
    private readonly resolutionRepository: Repository<CategoryAssortmentResolutionEntity>,
    @InjectRepository(AssortmentPolicyStateEntity)
    private readonly stateRepository: Repository<AssortmentPolicyStateEntity>,
    private readonly recomputeService: AssortmentPolicyRecomputeService,
  ) {}

  async getInternalSnapshot(options?: {
    provider?: string | null;
  }): Promise<AssortmentPolicySnapshot> {
    // Fill gaps for newly created source categories without requiring an
    // Admin apply. Cheap no-op when every category already has a row.
    await this.recomputeService.materializeMissingResolutions(
      'system:snapshot-materialize',
    );

    const state = await this.stateRepository.findOne({ where: { id: 1 } });
    const policyVersion = state?.policyVersion ?? 0;

    const rows = await this.resolutionRepository
      .createQueryBuilder('r')
      .select(['r.categoryId', 'r.status', 'r.reasonCode'])
      .orderBy('r.categoryId', 'ASC')
      .getMany();

    const resolutions: AssortmentPolicySnapshotRow[] = rows.map((r) => ({
      sourceCategoryId: Number(r.categoryId),
      status: r.status as AssortmentPolicyStatus,
      reasonCode: String(r.reasonCode || ''),
    }));

    return {
      policyVersion,
      generatedAt: new Date().toISOString(),
      provider: options?.provider ?? null,
      resolutions,
    };
  }

  async getStatusMap(): Promise<Map<number, string>> {
    const rows = await this.resolutionRepository
      .createQueryBuilder('r')
      .select(['r.categoryId', 'r.status'])
      .getMany();
    const map = new Map<number, string>();
    for (const r of rows) {
      map.set(Number(r.categoryId), String(r.status));
    }
    return map;
  }

  async getStatusForCategory(
    categoryId: number | null | undefined,
  ): Promise<string | null> {
    if (categoryId == null || !(Number(categoryId) > 0)) return null;
    const row = await this.resolutionRepository.findOne({
      where: { categoryId: Number(categoryId) },
      select: ['status'],
    });
    return row?.status ?? null;
  }
}
