import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';
import { removeSpace } from '../../utils';

@Injectable()
export class KavenegarService {
  private axios;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      baseURL: `https://api.kavenegar.com/v1/${this.config.sms.kavenegarKey}`,
    });
  }

  async sendOTP(mobile, code) {
    return await this._sendByTemplete('otp', mobile, [code]);
  }

  async notifyAdminToRenewal(mobile, adminName, daysLeft) {
    return await this._sendByTemplete('notifyAdminToShopRenewal', mobile, [
      adminName,
      daysLeft,
    ]);
  }

  async notifyAdminToNewOrder(
    mobile,
    customerName,
    customerMobile,
    finalAmount,
  ) {
    return await this._sendByTemplete('newOrder', mobile, [
      customerName,
      customerMobile,
      finalAmount,
    ]);
  }

  async send(mobile, message) {
    return await this._simpleSend(mobile, message);
  }

  private async _simpleSend(mobile, message) {
    const params = { receptor: mobile, message };

    try {
      const { data } = await this.axios.get('/sms/send.json', {
        params,
      });

      return data;
    } catch (e) {
      return null;
    }
  }

  private async _sendByTemplete(template, mobile, tokens = []) {
    const params = { template, receptor: mobile } as any;
    if (tokens[0]) params.token = removeSpace(tokens[0], '-');
    if (tokens[1]) params.token2 = removeSpace(tokens[1], '-');
    if (tokens[2]) params.token3 = removeSpace(tokens[2], '-');

    try {
      const { data } = await this.axios.get('/verify/lookup.json', {
        params,
      });

      return data?.entries?.[0];
    } catch (e) {
      console.log(e?.response?.data || 'Error SMS');
      return null;
    }
  }
}
