export enum SupportCategory {
  order = 'order',
  payment = 'payment',
  shipping = 'shipping',
  product = 'product',
  account = 'account',
  other = 'other',
}

export enum SupportStatus {
  open = 'OPEN',
  waitingForCustomer = 'WAITING_FOR_CUSTOMER',
  waitingForSupport = 'WAITING_FOR_SUPPORT',
  resolved = 'RESOLVED',
}

export enum SupportSenderType {
  customer = 'CUSTOMER',
  staff = 'STAFF',
}

export const SUPPORT_SUBJECT_MAX = 120;
export const SUPPORT_MESSAGE_MAX = 4000;

export const SUPPORT_CATEGORIES: Array<{ code: SupportCategory; label: string }> =
  [
    { code: SupportCategory.order, label: 'سفارش' },
    { code: SupportCategory.payment, label: 'پرداخت' },
    { code: SupportCategory.shipping, label: 'ارسال' },
    { code: SupportCategory.product, label: 'محصول' },
    { code: SupportCategory.account, label: 'حساب کاربری' },
    { code: SupportCategory.other, label: 'سایر' },
  ];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  [SupportStatus.open]: 'باز',
  [SupportStatus.waitingForCustomer]: 'در انتظار پاسخ شما',
  [SupportStatus.waitingForSupport]: 'در انتظار پشتیبانی',
  [SupportStatus.resolved]: 'بسته شده',
};

export function supportCategoryLabel(code: string): string {
  return (
    SUPPORT_CATEGORIES.find((item) => item.code === code)?.label || 'سایر'
  );
}

export function supportStatusLabel(code: string): string {
  return SUPPORT_STATUS_LABELS[code as SupportStatus] || code;
}

export function isSupportCategory(value: string): value is SupportCategory {
  return SUPPORT_CATEGORIES.some((item) => item.code === value);
}

export function isSupportStatus(value: string): value is SupportStatus {
  return Object.values(SupportStatus).includes(value as SupportStatus);
}
