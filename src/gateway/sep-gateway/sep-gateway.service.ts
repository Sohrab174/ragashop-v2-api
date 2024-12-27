import axios from 'axios';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SepGatewayService {
  private axios;
  private redirectUrl;

  constructor() {
    this.axios = axios.create({
      baseURL: 'https://sep.shaparak.ir',
    });

    // https://sep.shaparak.ir/OnlinePG/SendToken?token=
    this.redirectUrl = (token: string) =>
      `https://websitebezan.ir/sep.php?token=${token}`;
  }

  /**
   * @param amount Amount on Toman
   */
  async paymentRequest(
    terminalId: string,
    amount: number,
    mobile: string,
    randomToken: string,
    callbackUrl: string = null,
  ) {
    try {
      // /onlinepg/onlinepg
      const { data } = await this.axios.post('/sep/request', {
        action: 'token',
        TerminalId: terminalId,
        Amount: amount * 10,
        ResNum: randomToken,
        CellNumber: mobile,
        RedirectUrl: callbackUrl || 'https://websitebezan.ir/sep.php',
      });

      if (data.status === -1) {
        throw (
          data.errorDesc ||
          'در اتصال به درگاه مشکلی پیش آمد، لطفا مجدد تلاش نمایید'
        );
      }

      return {
        payToken: data.token,
        url: this.redirectUrl(data.token),
      };
    } catch (e) {
      console.log('SEP', e?.response?.data || e);
      throw typeof e === 'string'
        ? e
        : e?.response?.data?.Error ||
            'در اتصال به درگاه مشکلی پیش آمد، لطفا مجدد تلاش نمایید';
    }
  }

  /**
   * ------------------------------
   */
  async paymentVerification(terminalId: string, referenceNumber: string) {
    try {
      // /verifyTxnRandomSessionkey/ipg/VerifyTransaction
      const { data } = await this.axios.post('/sep/verify', {
        TerminalNumber: terminalId,
        RefNum: referenceNumber,
      });

      if (!data?.Success) {
        throw data?.ResultDescription || 'تاییدیه پرداخت با خطا مواجه شد';
      }

      // "RRN": "22898592358",
      // "RefNum": "GmshtyjwKSvy2DVuwWF1epdNY5jv8JtD3mkxSrc+H/",
      // "MaskedPan": "639346****7828",
      // "HashedPan": "1cc61eb346f95a0860fbd7d8a3f200947b6ecde5db35d0563c762262d542a8d7",
      // "TerminalNumber": 14050860,
      // "OrginalAmount": 100000,
      // "AffectiveAmount": 100000,
      // "StraceDate": "2024-03-07 00:10:48",
      // "StraceNo": "599043"

      return data.TransactionDetail;
    } catch (e) {
      console.log('SEP', e?.response?.data || e);
      throw typeof e === 'string'
        ? e
        : e?.response?.data?.Error || 'تاییدیه پرداخت با خطا مواجه شد';
    }
  }
}

/**
 * -------------------------------------------
 */
export const sepGatewayTranslateNumber = {
  // CanceledByUser
  1: 'کاربر انصراف داده است',
  // OK
  2: 'پرداخت با موفقیت انجام شد',
  // Failed
  3: 'پرداخت انجام نشد.',
  // SessionIsNull
  4: 'کاربر در بازه زمانی تعیین شده پاسخی ارسال نکرده است.',
  // InvalidParameters
  5: 'پارامترهای ارسالی نامعتبر است.',
  // MerchantIpAddressIsInvalid
  8: 'آدرس سرور پذیرنده نامعتبر است )در پرداخت های بر پایه توکن(',
  // TokenNotFound
  10: 'توکن ارسال شده یافت نشد.',
  // TokenRequired
  11: 'با این شماره ترمینال فقط تراکنش های توکنی قابل پرداخت هستند.',
  // TerminalNotFound
  12: 'شماره ترمینال ارسال شده یافت نشد.',
};
