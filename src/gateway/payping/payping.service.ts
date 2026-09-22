import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';
import {
  PaypingPaymentRequestError,
  buildPaypingPaymentRequestErrorFromAxios,
  buildPaypingVerificationErrorFromAxios,
} from './payping-verification-result';

@Injectable()
export class PaypingService {
  private axios;
  private redirectUrl;
  private sandboxMerchant;

  constructor(private config: ConfigurationService) {
    this.sandboxMerchant = 'O0F8s_4O7cMyTrs4-cqpd3qDWxsgXGndzwfKtLGXHBA';

    this.axios = axios.create({
      baseURL: 'http://195.177.255.138:1313/https://api.payping.ir/v2',
    });

    this.redirectUrl = (code: string) =>
      `https://ragaex.co/payping.php?token=${encodeURIComponent(code)}`;
  }

  getRedirectUrl(code: string): string {
    if (!code || typeof code !== 'string' || !/^[A-Za-z0-9_-]+$/.test(code)) {
      throw new PaypingPaymentRequestError({
        kind: 'payping_payment_request_error',
        providerResponseReceived: false,
        isTimeout: false,
        isNetworkError: false,
        message: 'توکن درگاه نامعتبر است',
      });
    }
    return this.redirectUrl(code);
  }

  /**
   * clientRefId = SP<transactionId> is used for traceability only.
   * PayPing idempotency is NOT assumed — callers must not blindly retry.
   */
  getClientRefId(transactionId: number): string {
    return `SP${transactionId}`;
  }

  /**
   * @param amount Amount on Toman
   */
  async paymentRequest(merchant, amount, transactionId, callbackUrl) {
    const payload = {
      clientRefId: this.getClientRefId(transactionId),
      Amount: Math.round(amount),
      Description: '',
      returnUrl: callbackUrl,
      payerIdentity: `raga-${Date.now()}`,
    };
    const headers = {
      Authorization: `Bearer ${
        this.config.gateway.mode === 'sandbox' ? this.sandboxMerchant : merchant
      }`,
    };

    try {
      const { data } = await this.axios.post('/pay', payload, { headers });

      if (!data?.code) {
        throw buildPaypingPaymentRequestErrorFromAxios({
          response: {
            status: 200,
            data: { Error: 'missing_authority_code' },
          },
          message: 'missing_authority_code',
        });
      }

      return {
        authority: data.code,
        url: this.redirectUrl(data.code),
        code: '',
        message: '',
      };
    } catch (e) {
      if (e instanceof PaypingPaymentRequestError) {
        throw e;
      }

      if (typeof e === 'string') {
        throw buildPaypingPaymentRequestErrorFromAxios({
          message: e,
          code: 'ERR_PAYPING_STRING',
        });
      }

      throw buildPaypingPaymentRequestErrorFromAxios(e);
    }
  }

  /**
   * @param amount Amount on Toman
   */
  async paymentVerification(merchant, referenceNumber, amount) {
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
      throw buildPaypingVerificationErrorFromAxios(e, referenceNumber);
    }
  }
}
