import { resolveCustomerByMobileDuplicates } from './customer-identity-resolver';
import { CustomerEntity, CustomerStatus } from './entities/customer.entity';

function customer(
  id: number,
  status: CustomerStatus,
  isDeleted = false,
): CustomerEntity {
  const row = new CustomerEntity();
  row.id = id;
  row.status = status;
  row.isDeleted = isDeleted;
  row.mobile = '+989123456789';
  return row;
}

describe('resolveCustomerByMobileDuplicates', () => {
  it('prefers single active account', () => {
    const result = resolveCustomerByMobileDuplicates([
      customer(1, CustomerStatus.inactive),
      customer(2, CustomerStatus.active),
    ]);
    expect(result.ambiguous).toBe(false);
    expect(result.customer?.id).toBe(2);
  });

  it('flags multiple active duplicates as ambiguous', () => {
    const result = resolveCustomerByMobileDuplicates([
      customer(1, CustomerStatus.active),
      customer(2, CustomerStatus.active),
    ]);
    expect(result.ambiguous).toBe(true);
    expect(result.customer).toBeNull();
  });

  it('flags multiple inactive duplicates as ambiguous', () => {
    const result = resolveCustomerByMobileDuplicates([
      customer(5, CustomerStatus.inactive),
      customer(3, CustomerStatus.inactive),
    ]);
    expect(result.ambiguous).toBe(true);
    expect(result.customer).toBeNull();
  });
});
