import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';

@Injectable()
export class PaypingService {
  private axios;
  private redirectUrl;
  private sandboxMerchant;

  constructor(private config: ConfigurationService) {
    this.sandboxMerchant = 'O0F8s_4O7cMyTrs4-cqpd3qDWxsgXGndzwfKtLGXHBA';

    this.axios = axios.create({
      baseURL: 'https://api.payping.ir/v2',
    });

    this.redirectUrl = 'https://api.payping.ir/v2/pay/gotoipg';
  }

  /**
   * @param amount Amount on Toman
   */
  async paymentRequest(merchant, amount, transactionId, callbackUrl) {
    try {
      const { data } = await this.axios.post(
        '/pay',
        {
          clientRefId: `SP${transactionId}`,
          Amount: Math.round(amount), // Toman
          Description: '',
          returnUrl: callbackUrl,
          payerIdentity: Date.now(),
        },
        {
          headers: {
            Authorization: `Bearer ${
              this.config.gateway.mode === 'sandbox'
                ? this.sandboxMerchant
                : merchant
            }`,
          },
        },
      );

      if (!data) {
        throw 'تراکنش ناموفق بود - شرح خطا: عدم وجود کد ارجاع';
      }

      return {
        authority: data.code,
        url: `${this.redirectUrl}/${data.code}`,
        code: '',
        message: '',
      };
    } catch (e) {
      console.log('PAYPING', e?.response?.data || e);
      throw typeof e === 'string'
        ? e
        : e?.response?.data?.Error ||
            'در اتصال به درگاه مشکلی پیش آمد، لطفا مجدد تلاش نمایید';
    }
  }

  /**
   * @param amount Amount on Toman
   */
  async paymentVerification(merchant, referenceNumber, amount) {
    if (!referenceNumber) {
      throw 'متاسفانه سامانه قادر به دریافت کد پیگیری نمی‌باشد! نتیجه درخواست';
    }

    try {
      await this.axios.post(
        '/pay/verify',
        {
          MerchantID:
            this.config.gateway.mode === 'sandbox'
              ? this.sandboxMerchant
              : merchant,
          amount: Math.round(amount),
          refId: referenceNumber,
        },
        {
          headers: {
            Authorization: `Bearer ${
              this.config.gateway.mode === 'sandbox'
                ? this.sandboxMerchant
                : merchant
            }`,
          },
        },
      );

      return 'پرداخت با موفقیت انجام شد';
    } catch (e) {
      console.log('PAYPING', e?.response?.data || e);
      throw e?.response?.data?.Error || 'تراکنش ناموفق بود';
    }
  }
}
