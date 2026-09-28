import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';
import { removeSpace, dateTime } from '../../utils';

/**
 * AmootSMS REST replies carry `Status: "Success"` on accepted sends.
 * Anything else (error status, empty/unparseable body) is a failed send.
 */
export function isAmootSuccessResponse(data: unknown): boolean {
  let body = data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  if (!body || typeof body !== 'object') {
    return false;
  }
  const record = body as Record<string, unknown>;
  const status = record.Status ?? record.status;
  return (
    typeof status === 'string' && status.trim().toLowerCase() === 'success'
  );
}

@Injectable()
export class AmootsmsService {
  private axios;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      // baseURL: `https://portal.amootsms.com/webservice2.asmx`,
      // baseURL: `http://188.121.113.58:1070/https://portal.amootsms.com`,
      baseURL: `https://portal.amootsms.com`,
      timeout: 20000,
    });
  }

  async send(mobiles = [], message) {
    return await this._simpleSend(mobiles, message);
  }

  /** Resolves true only when the provider confirms the OTP was accepted. */
  async sendOTP(mobile: string, code: string): Promise<boolean> {
    const params = {
      UserName: this.config.sms.amootsmsUsername,
      Password: this.config.sms.amootsmsPassword,
      Mobile: mobile,
      CodeLength: code.length,
      OptionalCode: code,
    };

    // Do not log credentials, OTP codes, or raw provider bodies.
    try {
      const { data } = await this.axios.get(
        '/webservice2.asmx/SendQuickOTP_REST',
        {
          params,
        },
      );

      if (!isAmootSuccessResponse(data)) {
        console.error('AmootSMS OTP send rejected by provider');
        return false;
      }
      return true;
    } catch (e) {
      console.error('AmootSMS OTP send failed');
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
