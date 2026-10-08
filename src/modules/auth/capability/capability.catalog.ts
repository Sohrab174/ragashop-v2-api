/**
 * Canonical Admin/Employee capability catalog (ADMIN-RBAC-1).
 * Stored as varchar(64) rows in `user_capability`. Do not scatter literals.
 */

export enum UserCapabilityName {
  // Orders
  order_read = 'order.read',
  order_prepare = 'order.prepare',
  order_ship = 'order.ship',
  order_tracking = 'order.tracking',
  order_reject = 'order.reject',

  // Payments / receipts
  payment_submission_read = 'payment_submission.read',
  payment_submission_review = 'payment_submission.review',
  payment_submission_approve = 'payment_submission.approve',
  /** Independent from review/claim — reject receipt without approve power. */
  payment_submission_reject = 'payment_submission.reject',
  bank_destination_manage = 'bank_destination.manage',

  // Products
  product_read = 'product.read',
  product_write = 'product.write',
  product_price = 'product.price',
  product_inventory = 'product.inventory',
  product_disable = 'product.disable',

  // Categories
  category_read = 'category.read',
  category_manage = 'category.manage',

  // Brands (UI future; reserved)
  brand_read = 'brand.read',
  brand_manage = 'brand.manage',

  // Storefront home
  storefront_home_read = 'storefront.home.read',
  storefront_home_manage = 'storefront.home.manage',

  // Customers
  customer_read = 'customer.read',
  customer_write = 'customer.write',

  // Support — manage implies read+reply for backward compatibility
  support_read = 'support.read',
  support_reply = 'support.reply',
  support_manage = 'support.manage',

  // Finance (reports UI future)
  finance_reports_read = 'finance.reports.read',

  // Employees
  employee_read = 'employee.read',
  employee_manage = 'employee.manage',
  employee_permissions = 'employee.permissions',

  // Settings
  settings_read = 'settings.read',
  settings_write = 'settings.write',
  settings_fx_refresh = 'settings.fx_refresh',
}

/** All assignable capability string values. */
export const ALL_USER_CAPABILITIES: readonly string[] = Object.values(
  UserCapabilityName,
);

const CAPABILITY_SET = new Set<string>(ALL_USER_CAPABILITIES);

export function isKnownCapability(code: string): boolean {
  return CAPABILITY_SET.has(code);
}

/**
 * Capabilities that satisfy a required check (aliases / supersets).
 * `support.manage` continues to grant full support access.
 */
export function capabilitySatisfiers(required: string): string[] {
  if (required === UserCapabilityName.support_read) {
    return [
      UserCapabilityName.support_read,
      UserCapabilityName.support_manage,
    ];
  }
  if (required === UserCapabilityName.support_reply) {
    return [
      UserCapabilityName.support_reply,
      UserCapabilityName.support_manage,
    ];
  }
  return [required];
}
