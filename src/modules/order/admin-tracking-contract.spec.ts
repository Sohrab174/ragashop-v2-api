import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Admin ↔ API tracking contract (SF-5).
 * Canonical field: postTrackingCode (entity + UpdateOrderStatusDto).
 */
describe('Admin order accept tracking contract', () => {
  it('OrderAcceptModal submits postTrackingCode (not trackingCode)', () => {
    const modalPath = join(
      __dirname,
      '../../../../ragashop-site/src/components/admin/order/orderView/OrderAcceptModal.js',
    );
    const source = readFileSync(modalPath, 'utf8');
    expect(source).toContain('postTrackingCode');
    expect(source).toContain('updateOrderStatus');
    // Must not send the legacy mismatched key in the API payload object.
    expect(/updateOrderStatus\([\s\S]*?trackingCode\s*:/.test(source)).toBe(
      false,
    );
    expect(/postTrackingCode\s*:/.test(source)).toBe(true);
  });

  it('API DTO and service persist postTrackingCode', () => {
    const dto = readFileSync(
      join(__dirname, 'dto/update-order-status.dto.ts'),
      'utf8',
    );
    const service = readFileSync(join(__dirname, 'order.service.ts'), 'utf8');
    const entity = readFileSync(
      join(__dirname, 'entities/order.entity.ts'),
      'utf8',
    );
    expect(dto).toContain('postTrackingCode');
    expect(service).toContain(
      'order.postTrackingCode = dto.postTrackingCode',
    );
    expect(entity).toContain('postTrackingCode');
  });
});
