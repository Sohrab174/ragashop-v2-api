import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';

@Injectable()
export class ZarinpalService {
  private axios;
  private redirectUrl;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      baseURL:
        // soap: https://www.zarinpal.com/pg/services/WebGate/wsdl
        // rest: https://www.zarinpal.com/pg/rest/WebGate
        this.config.gateway.mode === 'sandbox'
          ? 'https://sandbox.zarinpal.com/pg/rest/WebGate'
          : 'https://api.zarinpal.com/pg/v4/payment',
    });

    this.redirectUrl =
      this.config.gateway.mode === 'sandbox'
        ? 'https://sandbox.zarinpal.com/pg/StartPay'
        : 'https://www.zarinpal.com/pg/StartPay';
  }

  /**
   * @param amount Amount on Toman
   */
  async paymentRequest(
    merchant: string,
    amount: number,
    mobile: string,
    callbackURL = null,
    description = '',
  ) {
    try {
      // soap: PaymentRequest()
      // rest: /PaymentRequest.json
      const { data } = await this.axios.post('/request.json', {
        // MerchantID: merchant,
        // Amount: amount, // Toman
        // CallbackURL: callbackURL || 'https://7solution.ir/zarinpal.php',
        // Description: description || 'پرداخت',
        // Email: email,
        // Mobile: mobile,
        merchant_id: merchant,
        amount: amount * 10, // Rial
        currency: 'IRR',
        description: description || 'پرداخت',
        callback_url: callbackURL || 'https://7solution.ir/zarinpal.php',
        metadata: { mobile },
      });

      // if (data.Status !== 100) {
      //   throw 'اتصال به درگاه برقرار نشد، لطفا مجدد تلاش کنید';
      // }
      if (data.data.code !== 100) {
        console.log('ZARINPAL', data);
        throw 'اتصال به درگاه برقرار نشد، لطفا مجدد تلاش کنید';
      }

      return {
        code: data.data.code,
        // code: data.Status,
        message: '',
        // payToken: data.Authority,
        payToken: data.data.authority,
        url: `${this.redirectUrl}/${data.Authority}`,
      };
    } catch (e) {
      console.log('ZARINPAL', e?.response?.data || e);
      throw typeof e === 'string'
        ? e
        : e?.response?.data?.Error ||
            'در اتصال به درگاه مشکلی پیش آمد، لطفا مجدد تلاش نمایید';
    }
  }

  /**
   * @param amount Amount on Toman
   */
  async paymentVerification(
    merchant: string,
    authority: string,
    amount: number,
  ) {
    try {
      // soap: PaymentVerification
      // rest: PaymentVerification.json
      const { data } = await this.axios.post('/verify.json', {
        // MerchantID: merchant,
        // Amount: amount,
        // Authority: authority,
        merchant_id: merchant,
        amount: amount * 10,
        currency: 'IRR',
        authority,
      });

      if (data.data.code !== 100 && data.data.code != 101) {
        console.log('ZARINPAL', data);
        throw 'تاییدیه پرداخت با خطا مواجه شد';
      }

      // return {
      //   code: data.Status,
      //   message: '',
      //   referenceNumber: data.RefID,
      // };
      return {
        code: data.data.code,
        message: data.data.message,
        maskedCardNumber: data.data.card_pan,
        hashedCardNumber: data.data.card_hash,
        referenceNumber: data.data.ref_id,
      };
    } catch (e) {
      console.log('ZARINPAL', e?.response?.data || e);
      throw typeof e === 'string'
        ? e
        : e?.response?.data?.Error || 'تاییدیه پرداخت با خطا مواجه شد';
    }
  }
}
