/**
 * Cross-process Product child mutation lock identity.
 * MUST remain byte-identical in ragashop-crawler copy.
 */
export function productChildMutationLockName(productId: number): string {
  return `ragashop_product_child_${productId}`;
}
