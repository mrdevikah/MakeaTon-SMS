const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrShort = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
export const money = (n) => inr.format(Number(n) || 0);
export const moneyShort = (n) => inrShort.format(Number(n) || 0);
export const date = (s) => (s ? new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const today = () => new Date().toISOString().slice(0, 10);
export const periodLabel = (p, n = 1) => {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[p] || p;
  return n > 1 ? `every ${n} ${unit}s` : `per ${unit}`;
};
export const METHODS = { card: 'Card', bank_transfer: 'Bank transfer', upi: 'UPI', cash: 'Cash', cheque: 'Cheque', other: 'Other' };
export const titleCase = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
