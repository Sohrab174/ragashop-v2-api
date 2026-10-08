import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * FULFILLMENT-1: Admin order-detail UI must follow backend transition policy
 * and must not silently fall back to the broken REACT_APP_TYPE non-shop branch.
 */
describe('Admin fulfillment UI contract (FULFILLMENT-1)', () => {
  const orderViewDir = join(
    __dirname,
    '../../../../ragashop-site/src/components/admin/order/orderView',
  );

  const orderView = readFileSync(join(orderViewDir, 'OrderView.js'), 'utf8');
  const actions = readFileSync(
    join(orderViewDir, 'fulfillmentActions.js'),
    'utf8',
  );
  const summary = readFileSync(join(orderViewDir, 'OrderSummary.js'), 'utf8');
  const modal = readFileSync(join(orderViewDir, 'OrderAcceptModal.js'), 'utf8');
  const rejectModal = readFileSync(
    join(orderViewDir, 'OrderRejectModal.js'),
    'utf8',
  );

  it('uses getOrderFulfillmentUiActions instead of REACT_APP_TYPE shop branching', () => {
    expect(orderView).toContain('getOrderFulfillmentUiActions');
    expect(orderView).toContain("onUpdateStatus('accepted')");
    expect(orderView).toContain('setOpenAcceptModal(true)');
    expect(orderView).toContain("onUpdateStatus('delivered')");
    // Live fulfillment buttons must not be gated by REACT_APP_TYPE.
    expect(orderView).not.toMatch(
      /REACT_APP_TYPE\s*===\s*['"]shop['"]\s*\?\s*\(/,
    );
    expect(orderView).not.toContain("onUpdateStatus('paid')");
    expect(orderView).not.toMatch(
      /status\s*===\s*['"]pending['"][\s\S]{0,160}onUpdateStatus\(['"]accepted['"]\)/,
    );
  });

  it('policy helper encodes paid→accepted/ship and blocks unpaid fulfillment', () => {
    expect(actions).toContain("canPrepare: s === 'paid'");
    expect(actions).toContain("canDeliver: s === 'sent'");
    const shippableBlock = actions.match(
      /const SHIPPABLE = new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(shippableBlock).toBeTruthy();
    const shippableBody = shippableBlock![1];
    expect(shippableBody).toContain("'paid'");
    expect(shippableBody).toContain("'accepted'");
    expect(shippableBody).not.toContain("'pending'");
    expect(actions).not.toMatch(/canPrepare:\s*s\s*===\s*'pending'/);
  });

  it('OrderSummary shows postTrackingCode and preparing label for accepted', () => {
    expect(summary).toContain('postTrackingCode');
    expect(summary).toContain('کد رهگیری');
    expect(summary).toContain('در حال آماده‌سازی');
  });

  it('OrderAcceptModal still ships with status sent + postTrackingCode only', () => {
    expect(modal).toContain("status: 'sent'");
    expect(modal).toContain('postTrackingCode');
    expect(modal).not.toMatch(/sourceTrackingCode\s*:/);
    expect(/updateOrderStatus\([\s\S]*?trackingCode\s*:/.test(modal)).toBe(
      false,
    );
  });

  it('J — paid-order reject requires strong Persian warning, reason, confirmation', () => {
    expect(actions).toMatch(/requiresPaidRejectSafety/);
    expect(actions).toMatch(/PAID_REJECT_SAFETY/);
    expect(orderView).toMatch(/orderStatus=\{data\?\.status\}/);
    expect(rejectModal).toMatch(/requiresPaidRejectSafety/);
    expect(rejectModal).toContain('پرداخت این سفارش قبلاً ثبت شده است');
    expect(rejectModal).toContain(
      'وجه به‌صورت خودکار به مشتری بازگردانده نمی‌شود',
    );
    expect(rejectModal).toContain(
      'برگشت مالی یا موجودی به‌صورت خودکار انجام نمی‌شود',
    );
    expect(rejectModal).toMatch(/confirmNoAutoRefund/);
    expect(rejectModal).toMatch(
      /paidReject[\s\S]*?required\('برای رد سفارش پرداخت‌شده/,
    );
  });

  it('K — pending rejection keeps optional reason (no paid-safety requirement)', () => {
    expect(rejectModal).toMatch(
      /paidReject[\s\S]*\?[\s\S]*required[\s\S]*:[\s\S]*Yup\.string\(\)/,
    );
    expect(rejectModal).toContain("status: 'rejected'");
  });

  it('L — fulfillment action contract statuses remain unchanged', () => {
    expect(actions).toContain("['pending', 'paid', 'accepted']");
    expect(actions).toContain("canPrepare: s === 'paid'");
    expect(actions).toContain("canDeliver: s === 'sent'");
    expect(actions).toContain("onUpdateStatus('paid')");
    expect(actions).toContain("onUpdateStatus('pending')");
  });
});
