export type TransactionAmountType = 'DEPOSIT' | 'WITHDRAWAL' | 'WALVE' | 'BONUS';

export type TransactionAmountsInput = {
  type: TransactionAmountType;
  amount: number;
  bonus: number;
  walve: number;
  tips: number;
};

export type TransactionAmounts = {
  vendorTransfer: number;
  bankDelta: number;
  gameDelta: number;
  displayTotal: number;
};

export const getTransactionAmounts = (input: TransactionAmountsInput): TransactionAmounts => {
  const amount = Number(input.amount || 0);
  const bonus = Number(input.bonus || 0);
  const walve = Number(input.walve || 0);
  const tips = Number(input.tips || 0);

  if (input.type === 'DEPOSIT') {
    const total = amount + bonus;
    return { vendorTransfer: total, bankDelta: amount, gameDelta: -total, displayTotal: total };
  }

  if (input.type === 'BONUS') {
    const total = bonus;
    return { vendorTransfer: total, bankDelta: 0, gameDelta: -total, displayTotal: total };
  }

  if (input.type === 'WITHDRAWAL') {
    const total = amount + walve + tips;
    return { vendorTransfer: total, bankDelta: -amount, gameDelta: total, displayTotal: total };
  }

  const total = walve;
  return { vendorTransfer: total, bankDelta: 0, gameDelta: total, displayTotal: total };
};
