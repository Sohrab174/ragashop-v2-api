import {
  buildPaypingVerificationErrorFromAxios,
  PaypingVerificationError,
} from './payping-verification-result';
import { classifyPaypingVerificationError } from './payping-verification.classifier';

describe('classifyPaypingVerificationError (structured)', () => {
  it('maps transport timeout to uncertain even when message contains ناموفق', () => {
    const err = buildPaypingVerificationErrorFromAxios({
      code: 'ETIMEDOUT',
      message: 'تراکنش ناموفق بود',
    });

    expect(classifyPaypingVerificationError(err)).toBe('uncertain');
  });

  it('maps no provider response to uncertain', () => {
    const err = buildPaypingVerificationErrorFromAxios({
      code: 'ECONNRESET',
      message: 'network error',
    });

    expect(classifyPaypingVerificationError(err)).toBe('uncertain');
  });

  it('maps unknown provider response body to uncertain (not definitive_failure)', () => {
    const err = buildPaypingVerificationErrorFromAxios({
      response: {
        status: 400,
        data: { Error: 'تراکنش ناموفق بود' },
      },
      message: 'Request failed with status code 400',
    });

    expect(classifyPaypingVerificationError(err)).toBe('uncertain');
  });

  it('does not classify plain localized strings', () => {
    expect(classifyPaypingVerificationError('تراکنش ناموفق بود')).toBe(
      'uncertain',
    );
  });

  it('classifies structured PaypingVerificationError instances', () => {
    const err = new PaypingVerificationError({
      kind: 'payping_verification_error',
      providerResponseReceived: false,
      isTimeout: true,
      isNetworkError: true,
      axiosCode: 'ETIMEDOUT',
      message: 'timeout',
    });

    expect(classifyPaypingVerificationError(err)).toBe('uncertain');
  });
});
