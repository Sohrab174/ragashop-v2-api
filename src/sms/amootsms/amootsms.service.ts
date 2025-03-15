import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';
import { removeSpace, dateTime } from '../../utils';

@Injectable()
export class AmootsmsService {
  private axios;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      // baseURL: `https://portal.amootsms.com/webservice2.asmx`,
      baseURL: `http://5.34.202.72:1070/https://portal.amootsms.com/webservice2.asmx`,
    });
  }

  async send(mobiles = [], message) {
    return await this._simpleSend(mobiles, message);
  }

  async sendOTP(mobile, code) {
    const params = {
      UserName: this.config.sms.amootsmsUsername,
      Password: this.config.sms.amootsmsPassword,
      Mobile: mobile,
      CodeLength: code.length,
      OptionalCode: code,
    };

    try {
      const { data } = await this.axios.get('/SendQuickOTP_REST', {
        params,
      });

      return data;
    } catch (e) {
      console.log(e?.response?.data || 'Error SMS');
      return false;
    }
  }

  // TODO:
  async notifyAdminToNewOrder(mobile, orderNumber, finalAmount) {
    return await this._sendByTemplete(1792, mobile, [orderNumber, finalAmount]);
  }

  private async _simpleSend(mobiles = [], message) {
    const params = {
      UserName: this.config.sms.amootsmsUsername,
      Password: this.config.sms.amootsmsPassword,
      // Mobile: mobile,
      SendDateTime: dateTime(),
      SMSMessageText: encodeURIComponent(message),
      LineNumber: 'public',
      Mobiles: mobiles.join(','),
    };

    try {
      const { data } = await this.axios.get('/SendSimple_REST', {
        params,
      });

      return data;
    } catch (e) {
      return false;
    }
  }

  private async _sendByTemplete(patternCodeID: number, mobile, patterns = []) {
    const patternValues = patterns.map((p) => removeSpace(p, '-'));

    const params = {
      UserName: this.config.sms.amootsmsUsername,
      Password: this.config.sms.amootsmsPassword,
      Mobile: mobile,
      PatternCodeID: patternCodeID,
      PatternValues: patternValues.join(','),
    };

    try {
      const { data } = await this.axios.get('/SendWithPattern_REST', {
        params,
      });

      return data;
    } catch (e) {
      console.log(e?.response?.data || 'Error SMS');
      return false;
    }
  }
}
