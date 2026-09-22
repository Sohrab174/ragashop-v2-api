import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';
// import { SocksProxyAgent } from 'socks-proxy-agent';

@Injectable()
export class VatansmsService {
  private axios;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      baseURL: `https://api.vatansms.net`,
      timeout: 60000,
      // httpsAgent: new SocksProxyAgent({
      //   hostname: '127.0.0.1',
      //   port: '1080',
      // }),
    });
  }

  async getMainBalance() {
    try {
      const { data } = await this.axios.post('/api/v1/user/information', {
        api_id: this.config.sms.vatansmsApiId, // username
        api_key: this.config.sms.vatansmsApiKey, // password
      });
      return data?.data?.credit || 0;
    } catch (e) {
      console.log(e?.response?.data || 'Error SMS');
      return null;
    }
  }

  /**
   * *************************************************
   */
  async sendOTP(mobile, code) {
    await this._send(
      [mobile],
      `Verification Code: ${code}

This code is confidential.
RagaShop.co
`,
    );
  }

  /**
   * *************************************************
   */
  private async _send(mobiles = [], message: string) {
    try {
      const { data } = await this.axios.post('/api/v1/1toN', {
        api_id: this.config.sms.vatansmsApiId, // username
        api_key: this.config.sms.vatansmsApiKey, // password
        sender: 'RAGA MEDYA',
        message_type: 'normal',
        message_content_type: 'bilgi',
        phones: mobiles.map((mobile) => mobile.replace('+90', '')),
        message,
      });

      if (data?.status !== 'success') {
        return 'Error';
      }

      return data;
    } catch (e) {
      console.error('VatanSMS send failed', { mobiles });
      return null;
    }
  }
}
