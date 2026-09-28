import { readFileSync } from 'fs';
import { join } from 'path';

describe('ACCOUNT-1 order snapshot immutability', () => {
  const modulesRoot = join(__dirname, '..');

  it('order delivery is stored on the order row and has no addressId link', () => {
    const orderEntity = readFileSync(
      join(modulesRoot, 'order', 'entities', 'order.entity.ts'),
      'utf8',
    );
    expect(orderEntity).not.toMatch(/addressId/);
    expect(orderEntity).toMatch(/name: 'firstName'/);
    expect(orderEntity).toMatch(/name: 'address'/);
    expect(orderEntity).toMatch(/name: 'phone'/);
  });

  it('checkout copies delivery fields onto the order at create time', () => {
    const checkout = readFileSync(
      join(modulesRoot, 'checkout', 'checkout.service.ts'),
      'utf8',
    );
    expect(checkout).toMatch(/address:\s*delivery\.address/);
    expect(checkout).toMatch(/firstName:\s*delivery\.firstName/);
    expect(checkout).toMatch(/phone:\s*delivery\.phone/);
    expect(checkout).toMatch(/postalCode:\s*delivery\.postalCode/);
    expect(checkout).toMatch(/latitude:\s*delivery\.latitude/);
    expect(checkout).toMatch(/longitude:\s*delivery\.longitude/);
    expect(checkout).not.toMatch(/addressId/);
  });

  it('order entity stores immutable latitude/longitude snapshot columns', () => {
    const orderEntity = readFileSync(
      join(modulesRoot, 'order', 'entities', 'order.entity.ts'),
      'utf8',
    );
    expect(orderEntity).toMatch(/name: 'latitude'/);
    expect(orderEntity).toMatch(/name: 'longitude'/);
    expect(orderEntity).toMatch(/name: 'postalCode'/);
    expect(orderEntity).toMatch(/GeoCoordinateTransformer/);
  });

  it('order reads never join the mutable address table', () => {
    for (const file of [
      join(modulesRoot, 'order', 'order.service.ts'),
      join(modulesRoot, 'checkout', 'checkout.service.ts'),
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/AddressEntity/);
      expect(source).not.toMatch(/join(AndSelect)?\(\s*'order\.address'/i);
    }
  });

  it('address writes never touch the order repository', () => {
    const addressService = readFileSync(
      join(modulesRoot, 'address', 'address.service.ts'),
      'utf8',
    );
    expect(addressService).not.toMatch(/orderRepository/);
    expect(addressService).not.toMatch(/OrderEntity/);
    expect(addressService).toMatch(/isDeleted = true/);
  });

  it('address routes take the customer from the JWT guard', () => {
    const controller = readFileSync(
      join(modulesRoot, 'address', 'address.controller.ts'),
      'utf8',
    );
    expect(controller).toMatch(/@UseGuards\(CustomerJwtAuthGuard\)/);
    expect(controller).toMatch(/listForCustomer\(customer\.id\)/);
    expect(controller).toMatch(/this\.addressService\.add\(dto, customer\.id\)/);
    expect(controller).toMatch(/this\.addressService\.update\(dto, customer\.id\)/);
    expect(controller).not.toMatch(/customerId:\s*dto/);
  });
});
