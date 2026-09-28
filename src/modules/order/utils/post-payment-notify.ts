export interface PostPaymentNotifier {
  sendPostPaymentNotifications(orderId: number): Promise<void> | void;
}

/**
 * Post-payment notifications run after finalization has committed. A sync
 * throw or rejection here must never change the payment result.
 */
export async function notifyPostPaymentBestEffort(
  notifier: PostPaymentNotifier | null | undefined,
  orderId: number,
): Promise<void> {
  try {
    await notifier?.sendPostPaymentNotifications(orderId);
  } catch {
    console.error('Post-payment notification failed', { orderId });
  }
}
