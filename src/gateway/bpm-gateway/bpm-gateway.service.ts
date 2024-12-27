import { Injectable } from '@nestjs/common';
import * as moment from 'jalali-moment';
import * as soap from 'soap';
import { ConfigurationService } from '../../config/configuration.service';

@Injectable()
export class BpmGatewayService {
  private client;
  private redirectUrl;

  constructor(private config: ConfigurationService) {
    if (this.config.app.nodeEnv === 'production') {
      soap
        .createClientAsync(
          'https://bpm.shaparak.ir/pgwchannel/services/pgw?wsdl',
        )
        .then((client) => {
          this.client = client;
        })
        .catch((e) => {
          console.log('BPM', e);
        });
    }

    this.redirectUrl = (token: string, mobile = '') =>
      `https://websitebezan.ir/bpm.php?token=${token}&mobile=${mobile}`;
  }

  /**
   * @param amount Amount on Toman
   */
  async paymentRequest(
    terminal: { terminalId; username; password },
    amount: number,
    mobile: string,
    randomToken: number,
    callbackUrl: string = null,
  ) {
    return new Promise((resolve, reject) => {
      const mobileNo = mobile ? `98${mobile.substring(1)}` : '';

      this.client.bpPayRequest(
        {
          terminalId: +terminal.terminalId,
          userName: terminal.username,
          userPassword: terminal.password,
          orderId: randomToken,
          payerId: 0,
          amount: amount * 10,
          localDate: moment().format('YYYYMMDD'),
          localTime: moment().format('HHmmss'),
          mobileNo,
          callBackUrl: callbackUrl || 'https://websitebezan.ir/bpm.php',
        },
        (err, result) => {
          if (err) {
            console.log('BPM paymentRequest', err);
            return reject(
              'در اتصال به درگاه مشکلی پیش آمد، لطفا مجدد تلاش نمایید',
            );
          }

          if (!result?.return || (result?.return || '').indexOf(',') === -1) {
            console.log(
              'BPM paymentRequest',
              bpmGatewayTranslateNumber?.[result?.return || ''] || result,
            );
            return reject(
              'در اتصال به درگاه مشکلی پیش آمد، لطفا مجدد تلاش نمایید',
            );
          }

          const [code, token] = (result?.return || '').split(',');
          if (code !== '0' || !token) {
            console.log(
              'BPM paymentRequest',
              bpmGatewayTranslateNumber?.[result?.return || ''] || result,
            );
            return reject(
              'در اتصال به درگاه مشکلی پیش آمد، لطفا مجدد تلاش نمایید',
            );
          }

          return resolve({
            payToken: token,
            payMobile: mobileNo,
            url: this.redirectUrl(token, mobileNo),
          });
        },
      );
    });
  }

  /**
   * ------------------------------
   */
  async paymentVerification(
    terminal: { terminalId; username; password },
    randomToken: number,
    referenceNumber: string,
  ) {
    return new Promise((resolve, reject) => {
      this.client.bpVerifyRequest(
        {
          terminalId: +terminal.terminalId,
          userName: terminal.username,
          userPassword: terminal.password,
          orderId: randomToken,
          saleOrderId: randomToken,
          saleReferenceId: referenceNumber,
        },
        async (err, result) => {
          if (err) {
            console.log('BPM paymentVerification', err);
            return reject('تاییدیه پرداخت با خطا مواجه شد');
          }

          if (+result?.return !== 0) {
            try {
              await this.paymentInquiry(terminal, randomToken, referenceNumber);
            } catch (e) {
              console.log(
                'BPM paymentVerification',
                bpmGatewayTranslateNumber?.[result?.return || ''] || result,
              );

              await this.paymentReverse(terminal, randomToken, referenceNumber);
              return reject(
                'تاییدیه پرداخت با خطا مواجه شد، مبلغ پرداختی از طرف بانک به کارت شما بازگشت داده خواهد شد',
              );
            }
          }

          try {
            await this.paymentSettle(terminal, randomToken, referenceNumber);
          } catch (e) {
            console.log(
              'BPM paymentVerification',
              bpmGatewayTranslateNumber?.[result?.return || ''] || result,
            );

            await this.paymentReverse(terminal, randomToken, referenceNumber);
            return reject(
              'تاییدیه پرداخت با خطا مواجه شد، مبلغ پرداختی از طرف بانک به حساب شما بازگشت داده خواهد شد',
            );
          }

          return resolve('پرداخت با موفقیت انجام شد');
        },
      );
    });
  }

  /**
   * ------------------------------
   */
  async paymentInquiry(
    terminal: { terminalId; username; password },
    randomToken: number,
    referenceNumber: string,
  ) {
    return new Promise((resolve, reject) => {
      this.client.bpInquiryRequest(
        {
          terminalId: +terminal.terminalId,
          userName: terminal.username,
          userPassword: terminal.password,
          orderId: randomToken,
          saleOrderId: randomToken,
          saleReferenceId: referenceNumber,
        },
        async (err, result) => {
          if (err) {
            console.log('BPM paymentInquiry', err);
            return reject(false);
          }

          if (+result?.return !== 0) {
            console.log(
              'BPM paymentInquiry',
              bpmGatewayTranslateNumber?.[result?.return || ''] || result,
            );
            return reject(false);
          }

          return resolve(true);
        },
      );
    });
  }

  /**
   * ------------------------------
   */
  async paymentReverse(
    terminal: { terminalId; username; password },
    randomToken: number,
    referenceNumber: string,
  ) {
    return new Promise((resolve, reject) => {
      this.client.bpReversalRequest(
        {
          terminalId: +terminal.terminalId,
          userName: terminal.username,
          userPassword: terminal.password,
          orderId: randomToken,
          saleOrderId: randomToken,
          saleReferenceId: referenceNumber,
        },
        async (err, result) => {
          if (err) {
            console.log('BPM paymentReverse', err);
            return reject(false);
          }

          if (+result?.return !== 0) {
            console.log(
              'BPM paymentReverse',
              bpmGatewayTranslateNumber?.[result?.return || ''] || result,
            );
            return reject(false);
          }

          return resolve(true);
        },
      );
    });
  }

  /**
   * ------------------------------
   */
  async paymentSettle(
    terminal: { terminalId; username; password },
    randomToken: number,
    referenceNumber: string,
  ) {
    return new Promise((resolve, reject) => {
      this.client.bpSettleRequest(
        {
          terminalId: +terminal.terminalId,
          userName: terminal.username,
          userPassword: terminal.password,
          orderId: randomToken,
          saleOrderId: randomToken,
          saleReferenceId: referenceNumber,
        },
        async (err, result) => {
          if (err) {
            console.log('BPM paymentSettle', err);
            return reject(false);
          }

          if (+result?.return !== 0 && +result?.return !== 45) {
            console.log(
              'BPM paymentSettle',
              bpmGatewayTranslateNumber?.[result?.return || ''] || result,
            );
            return reject(false);
          }

          return resolve(true);
        },
      );
    });
  }
}

/**
 * -------------------------------------------
 */
export const bpmGatewayTranslateNumber = {
  0: 'تراکنش با موفقیت انجام شد',
  11: 'شماره کارت نامعتبر است',
  12: 'موجودی کافی نیست',
  13: 'رمز نادرست است',
  14: 'تعداد دفعات وارد کردن رمز بیش از حد مجاز است',
  15: 'کارت نامعتبر است',
  16: 'دفعات برداشت وجه بیش از حد مجاز است',
  17: 'کاربر از انجام تراکنش منصرف شده است',
  18: 'تاریخ انقضای کارت گذشته است',
  19: 'مبلغ برداشت وجه بیش از حد مجاز است',
  21: 'پذیرنده نامعتبر است',
  23: 'خطای امنیتی رخ داده است',
  24: 'اطلاعات کاربری پذیرنده نامعتبر است',
  25: 'مبلغ نامعتبر است',
  31: 'پاسخ نامعتبر است',
  32: 'فرمت اطلاعات وارد شده صحیح نمی باشد',
  33: 'حساب نامعتبر است',
  34: 'خطای سیستمی',
  35: 'تاریخ نامعتبر است',
  41: 'شماره درخواست تکراری است',
  42: 'تراکنش Sale يافت نشد',
  43: 'قبلا درخواست Verify داده شده است',
  44: 'درخواست Verfiy يافت نشد',
  45: 'تراکنش Settle شده است',
  46: 'تراکنش Settle نشده است',
  47: 'تراکنش Settle يافت نشد',
  48: 'تراکنش Reverse شده است',
  51: 'تراکنش تکراری است',
  54: 'تراکنش مرجع موجود نیست',
  55: 'تراکنش نامعتبر است',
  61: 'خطا در واريز',
  62: 'مسیر بازگشت به سايت در دامنه ثبت شده برای پذيرنده قرار ندارد.',
  98: 'سقف استفاده از رمز ايستا به پايان رسیده است.',
  111: 'صادر کننده کارت نامعتبر است',
  112: 'خطای سوییچ صادر کننده کارت',
  113: 'پاسخی از صادر کننده کارت دریافت نشد',
  114: 'دارنده کارت مجاز به انجام این تراکنش نیست',
  412: 'شناسه قبض نادرست است',
  413: 'شناسه پرداخت نادرست است',
  414: 'سازمان صادر کننده قبض نامعتبر است',
  415: 'زمان جلسه کاری به پايان رسیده است',
  416: 'خطا در ثبت اطلاعات',
  417: 'شناسه پرداخت کننده نامعتبر است',
  418: 'اشکال در تعريف اطلاعات مشتری',
  419: 'تعداد دفعات ورود اطلاعات از حد مجاز گذشته است',
  421: 'IP نامعتبر است',
  995: 'تعلق کارت بانکي به مشتری احراز نشد',
};
