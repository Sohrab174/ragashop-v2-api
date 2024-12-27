import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ConfigurationService } from '../../config/configuration.service';

@Injectable()
export class SpotplayerService {
  private axios;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      baseURL: 'https://panel.spotplayer.ir',
      timeout: 60000,
      headers: {
        $LEVEL: -1,
      },
    });
  }

  /**
   * -----------------------------------------
   */
  async generateLicense(
    apiToken: string,
    courseId: string,
    customer: string,
    watermark: string,
  ) {
    try {
      const { data } = await this.axios.post(
        '/license/edit/',
        {
          // test: true,
          course: [courseId],
          name: customer,
          watermark: { texts: [{ text: watermark }] },
        },
        {
          headers: {
            $API: apiToken,
          },
        },
      );

      return data;
    } catch (e) {
      console.log('SPOTPLAYER', e?.response?.data || e);
      throw typeof e === 'string'
        ? e
        : e?.response?.data?.Error || 'در ساخت لایسنس خطایی رخ داده است!';
    }
  }
}
