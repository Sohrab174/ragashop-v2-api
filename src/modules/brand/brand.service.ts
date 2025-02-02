import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getConnection } from 'typeorm/globals';
import * as path from 'path';
import * as fs from 'fs';
import { ErrorService } from '../../error/error.service';
import {
  applyFiltersToBuilder,
  applySortingToBuilder,
  findCategoryParentsByChildId,
  paginationResult,
} from '../../utils';

import { getLastDisplayOrder } from '../../utils/last-display-order';
import { UserEntity } from '../user/entities/user.entity';
import {
  applyPathToThumbPath,
  generateThumbnail,
  squareSizeImage,
} from '../../utils/sharp';
import { BrandEntity } from './entities/brand.entity';

@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(BrandEntity)
    private brandRepository: Repository<BrandEntity>,

    private error: ErrorService,
  ) {}
}
