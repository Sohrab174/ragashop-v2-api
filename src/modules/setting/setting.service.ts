import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingEntity } from './entities/setting.entity';
import { retryOperation } from '../../utils';
import axios from 'axios';

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
  async get(select = null) {
    const setting = await this.settingRepository.findOne({
      where: { id: 1 },
      ...(select && { select }),
    });

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

  /**
   * -------------------------------------------------------
   */
  async getTryToRial() {
    const res = await retryOperation(
      async () => {
        try {
          const { data } = await axios.get('https://call1.tgju.org/ajax.json');

          return +(data?.current?.price_try?.p || '').replace(/\,/g, '');
        } catch (e) {
          return null;
        }
      },
      3,
      0,
      5000,
    );

    if (res.result && res.result > 0) {
      console.log('new exchange TRY/IRR', new Date(), res.result);

      await this.settingRepository
        .createQueryBuilder()
        .update()
        .set({ tryToRial: res.result })
        .where({ id: 1 })
        .execute();
    }
  }
}
