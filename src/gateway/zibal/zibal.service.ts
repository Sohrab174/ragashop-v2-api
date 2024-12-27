import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';

@Injectable()
export class ZibalService {
  private axios;
  private baseURL;

  constructor(private config: ConfigurationService) {
    this.baseURL = 'https://gateway.zibal.ir';

    this.axios = axios.create({
      baseURL: this.baseURL,
    });
  }

  /**
   * @param amount Amount on Tomans
   */
  async paymentRequest(merchant, amount, callbackUrl, description = null) {
    const { data } = await this.axios.post('/v1/request', {
      merchant,
      amount: amount * 10, // Rials
      callbackUrl,
      description,
    });

    let message = '';
    switch (data.result) {
      case 100:
        message = 'با موفقیت تایید شد.';
        break;
      case 102:
        message = '{merchant} یافت نشد.';
        break;
      case 103:
        message = '{merchant} غیرفعال';
        break;
      case 104:
        message = '{merchant} نامعتبر';
        break;
      case 201:
        message = 'قبلا تایید شده.';
        break;
      case 105:
        message = '{amount} بایستی بزرگتر از 1,000 ریال باشد.';
        break;
      case 106:
        message = '{callbackUrl} نامعتبر می‌باشد. (شروع با http و یا https)';
        break;
    }

    if (data.result !== 100) {
      throw message;
    }

    return {
      code: data.result,
      message,
      authority: data.trackId,
      url: `${this.baseURL}/start/${data.trackId}`,
    };
  }

  /**
   * @param amount Amount on Rials
   */
  async paymentVerification(merchant, authority) {
    const { data } = await this.axios.post('/v1/verify', {
      merchant,
      trackId: parseInt(authority),
    });

    let message = '';
    switch (data.result) {
      case 100:
        message = 'با موفقیت تایید شد.';
        break;
      case 102:
        message = '{merchant} یافت نشد.';
        break;
      case 103:
        message = '{merchant} غیرفعال';
        break;
      case 104:
        message = '{merchant} نامعتبر';
        break;
      case 201:
        message = 'قبلا تایید شده.';
        break;
      case 202:
        message = 'سفارش پرداخت نشده یا ناموفق بوده است. ';
        break;
      case 203:
        message = '{trackId} نامعتبر می‌باشد.';
        break;
    }

    if (data.result !== 100) {
      throw message;
    }

    return {
      code: data.status,
      message,
      referenceNumber: data.refNumber,
    };
  }
}
