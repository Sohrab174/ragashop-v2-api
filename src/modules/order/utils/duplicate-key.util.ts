export function isMysqlDuplicateKeyError(err: any): boolean {
  return err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
}

export function isOrderNumberUniqueViolation(err: any): boolean {
  if (!isMysqlDuplicateKeyError(err)) {
    return false;
  }

  const sqlMessage = String(err?.sqlMessage || err?.message || '');
  return sqlMessage.includes('uq_order_number');
}
