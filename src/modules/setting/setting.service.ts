import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingEntity } from './entities/setting.entity';

@Injectable()
export class SettingService {
  constructor(
    @InjectRepository(SettingEntity)
    private settingRepository: Repository<SettingEntity>,
  ) {}

  /**
   * -------------------------------------------------------
   * Get /settings/admin
   */
  async getByAdmin(select = null) {
    return await this.settingRepository.findOne({
      where: { id: 1 },
      ...(select && select),
    });
  }

  /**
   * -------------------------------------------------------
   * Get /settings
   */
  async get() {
    const setting = await this.settingRepository.findOne(1);

    return { ...setting, time: new Date() };
  }

  /**
   * -------------------------------------------------------
   * PUT /settings/admin
   */
  async update(dto: UpdateSettingDto) {
    return await this.settingRepository
      .createQueryBuilder()
      .update()
      .set(dto)
      .where({ id: 1 })
      .execute();
  }
}
