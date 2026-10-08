import { isReferralAwardsEnabled } from './referral-launch.gate';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('referral launch gate (ADMIN-V2-0)', () => {
  it('fails closed unless REFERRAL_AWARDS_ENABLED is explicitly true/1', () => {
    expect(isReferralAwardsEnabled({})).toBe(false);
    expect(isReferralAwardsEnabled({ REFERRAL_AWARDS_ENABLED: '' })).toBe(
      false,
    );
    expect(isReferralAwardsEnabled({ REFERRAL_AWARDS_ENABLED: 'false' })).toBe(
      false,
    );
    expect(isReferralAwardsEnabled({ REFERRAL_AWARDS_ENABLED: '0' })).toBe(
      false,
    );
    expect(isReferralAwardsEnabled({ REFERRAL_AWARDS_ENABLED: 'yes' })).toBe(
      false,
    );
    expect(isReferralAwardsEnabled({ REFERRAL_AWARDS_ENABLED: 'true' })).toBe(
      true,
    );
    expect(isReferralAwardsEnabled({ REFERRAL_AWARDS_ENABLED: '1' })).toBe(
      true,
    );
    expect(isReferralAwardsEnabled({ REFERRAL_AWARDS_ENABLED: ' TRUE ' })).toBe(
      true,
    );
  });

  it('order finalization referral path is gated before any award write', () => {
    const orderService = readFileSync(
      join(__dirname, '../order/order.service.ts'),
      'utf8',
    );
    const applyBlock = orderService.match(
      /async applyReferralRewardsAtomic\([\s\S]*?^  async /m,
    );
    expect(applyBlock?.[0] || orderService).toMatch(
      /if\s*\(\s*!isReferralAwardsEnabled\(\)\s*\)\s*\{\s*return;/,
    );
    expect(orderService).toMatch(
      /newly_paid[\s\S]*?recognizeCogsFromOrderItemSnapshots[\s\S]*?applyReferralRewardsAtomic/,
    );
  });

  it('signup invite credits are also gated (fail closed)', () => {
    const customerService = readFileSync(
      join(__dirname, '../customer/customer.service.ts'),
      'utf8',
    );
    expect(customerService).toMatch(
      /if\s*\(\s*isReferralAwardsEnabled\(\)\s*\)\s*\{[\s\S]*?invitedByReferrerCredit/,
    );
  });
});
