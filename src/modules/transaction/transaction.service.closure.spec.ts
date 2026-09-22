import {
  buildPaypingVerificationErrorFromAxios,
  PaypingVerificationError,
} from '../../gateway/payping/payping-verification-result';
import { classifyPaypingVerificationError } from '../../gateway/payping/payping-verification.classifier';
import { TransactionStatus } from './entities/transaction.entity';

describe('TransactionService closure behaviors (unit)', () => {
  describe('PayPing structured classification', () => {
    it('timeout with Persian failure text remains uncertain', () => {
      const err = buildPaypingVerificationErrorFromAxios({
        code: 'ETIMEDOUT',
        message: 'تراکنش ناموفق بود',
      });
      expect(classifyPaypingVerificationError(err)).toBe('uncertain');
    });

    it('provider body with ناموفق but no documented code remains uncertain', () => {
      const err = buildPaypingVerificationErrorFromAxios({
        response: { status: 400, data: { Error: 'تراکنش ناموفق بود' } },
      });
      expect(classifyPaypingVerificationError(err)).not.toBe(
        'definitive_failure',
      );
    });
  });

  describe('provider_paid_superseded semantics', () => {
    it('uses dedicated status distinct from superseded', () => {
      expect(TransactionStatus.provider_paid_superseded).toBe(
        'provider_paid_superseded',
      );
      expect(TransactionStatus.provider_paid_superseded).not.toBe(
        TransactionStatus.superseded,
      );
    });
  });

  describe('structured error serialization', () => {
    it('preserves transport metadata on PaypingVerificationError', () => {
      const err = new PaypingVerificationError({
        kind: 'payping_verification_error',
        providerResponseReceived: false,
        axiosCode: 'ECONNABORTED',
        isTimeout: true,
        isNetworkError: true,
        message: 'timeout',
      });

      expect(err.details.providerResponseReceived).toBe(false);
      expect(err.details.axiosCode).toBe('ECONNABORTED');
    });
  });
});
