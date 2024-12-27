import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration.service';
import * as moment from 'jalali-moment';

@Injectable()
export class DpoPayService {
  private axios;
  private redirectUrl;

  constructor(private config: ConfigurationService) {
    this.axios = axios.create({
      baseURL: 'https://secure.3gdirectpay.com/API/v6',
      headers: { 'Content-Type': 'application/xml' },
    });

    this.redirectUrl = (token) =>
      `https://secure.3gdirectpay.com/payv3.php?ID=${token}`;
  }

  /**
   * @param amount Amount on AED
   */
  async paymentRequest(
    merchant: string,
    serviceType: string,
    amount: number,
    unit = 'AED',
    callbackUrl: string,
    customer: { email: string; firstName: string; lastName: string },
  ) {
    const xmlData = `<?xml version="1.0" encoding="utf-8"?>
      <API3G>
        <CompanyToken>${merchant}</CompanyToken>
        <Request>createToken</Request>
        <Transaction>
          <PaymentAmount>${amount}</PaymentAmount>
          <PaymentCurrency>${unit}</PaymentCurrency>
          <CompanyRef>KDIEOM</CompanyRef>
          <RedirectURL>${callbackUrl}</RedirectURL>
          <BackURL>${callbackUrl}</BackURL>
          <CompanyRefUnique>0</CompanyRefUnique>
          <PTL>5</PTL>
          <customerEmail>${customer.email}</customerEmail>
          <customerFirstName>${customer.firstName}</customerFirstName>
          <customerLastName>${customer.lastName}</customerLastName>
        </Transaction>
        <Services>
          <Service>
            <ServiceType>${serviceType}</ServiceType>
            <ServiceDescription>Product purchase</ServiceDescription>
            <ServiceDate>${moment().format('YYYY/MM/DD HH:mm')}</ServiceDate>
          </Service>
        </Services>
      </API3G>`;

    try {
      const { data } = await this.axios.post('/', xmlData);
      const result: any = this._parseXMLResponse(data);

      if (result.Result !== '000') {
        throw result.ResultExplanation;
      }

      return {
        authority: result.TransToken,
        url: this.redirectUrl(result.TransToken),
        code: result.TransRef,
        message: result.ResultExplanation,
      };
    } catch (e) {
      console.log('DPO PAY', e?.response?.data || e);

      throw typeof e === 'string'
        ? e
        : e?.response?.data?.Error ||
            'There was a problem connecting to the support, please try again';
    }
  }

  /**
   * -----------------------------
   */
  async paymentVerification(merchant: string, trackingToken: string) {
    if (!trackingToken) {
      throw 'Unfortunately, the system is not able to receive the transaction token!';
    }

    const xmlData = `<?xml version="1.0" encoding="utf-8"?>
      <API3G>
        <CompanyToken>${merchant}</CompanyToken>
        <Request>verifyToken</Request>
        <TransactionToken>${trackingToken}</TransactionToken>
      </API3G>`;

    try {
      const { data } = await this.axios.post('/', xmlData);
      const result: any = this._parseXMLResponse(data);

      if (result.Result !== '000') {
        throw result.ResultExplanation;
      }

      return {
        message: result.ResultExplanation,
        referenceNumber: result?.TransactionApproval || result?.AccRef || '',
      };
    } catch (e) {
      console.log('DPO PAY', e?.response?.data || e);

      throw typeof e === 'string'
        ? e
        : e?.response?.data?.Error || 'The transaction was unsuccessful';
    }
  }

  /**
   * Helper function to manually parse the XML response
   */
  private _parseXMLResponse(xmlString) {
    const startTag = '<API3G>';
    const endTag = '</API3G>';
    const startIndex = xmlString.indexOf(startTag);
    const endIndex = xmlString.indexOf(endTag);

    if (startIndex === -1 || endIndex === -1) {
      throw new Error('Invalid XML response');
    }

    const xmlData = xmlString.substring(startIndex + startTag.length, endIndex); // Remove the starting <API3G> tag
    const result = {};

    const regex = /<(\w+)>(.*?)<\/\w+>/g;
    let match;

    while ((match = regex.exec(xmlData)) !== null) {
      const [, key, value] = match;
      result[key] = value;
    }

    return result;
  }
}
