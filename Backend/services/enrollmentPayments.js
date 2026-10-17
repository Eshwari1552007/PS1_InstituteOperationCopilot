const crypto = require('node:crypto');

const MONEY_SCALE = 100;

function toMinorUnits(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const scaled = numeric * MONEY_SCALE;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-7 ? rounded : null;
}

function validateAdvance(amountValue, feeValue) {
  const fee = toMinorUnits(feeValue);
  const amount = toMinorUnits(amountValue);
  if (fee === null || fee <= 0) return { ok: false, error: 'This course has an invalid or zero fee.' };
  if (amount === null || amount <= 0) return { ok: false, error: 'Enter a valid positive payment amount.' };
  const minimum = Math.ceil(fee / 2);
  if (amount < minimum) return { ok: false, error: 'The advance payment must be at least 50% of the course fee.', minimum };
  if (amount > fee) return { ok: false, error: 'Payment cannot exceed the amount due.', minimum };
  return { ok: true, fee, amount, minimum, remaining: fee - amount };
}

function validateInstallmentRequest(amountValue, totalValue, paidValue, balanceValue) {
  const total = toMinorUnits(totalValue);
  const paid = toMinorUnits(paidValue);
  const balance = toMinorUnits(balanceValue);
  const amount = toMinorUnits(amountValue);
  if (total === null || total <= 0 || paid === null || balance === null || total - paid !== balance) {
    return { ok: false, code: 'FEE_RECORD_INVALID', error: 'The fee balance is inconsistent. Reconcile the fee record before requesting payment.' };
  }
  if (amount === null || amount <= 0) {
    return { ok: false, code: 'AMOUNT_INVALID', error: 'Enter a valid positive installment amount (up to two decimals).' };
  }
  if (amount > balance) {
    return { ok: false, code: 'AMOUNT_TOO_HIGH', error: 'The installment cannot exceed the remaining balance.' };
  }
  return { ok: true, total, paid, balance, amount };
}

function hasRecentAuthentication(authTime, nowSeconds = Date.now() / 1000, maxAgeSeconds = 300) {
  return Number.isFinite(Number(authTime)) && Number(authTime) <= nowSeconds && nowSeconds - Number(authTime) <= maxAgeSeconds;
}

function demoPaymentsAllowed(nodeEnv = process.env.NODE_ENV, enabled = process.env.ENABLE_DEMO_PAYMENTS) {
  return nodeEnv !== 'production' || enabled === 'true';
}

function paymentIdFor(uid, requestId) {
  return `demo_${crypto.createHash('sha256').update(`${uid}\0${requestId}`).digest('hex')}`;
}

module.exports = { toMinorUnits, validateAdvance, validateInstallmentRequest, paymentIdFor, hasRecentAuthentication, demoPaymentsAllowed };
