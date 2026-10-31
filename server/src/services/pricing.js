import { q } from '../db.js';
import { badRequest, round2 } from '../lib/util.js';

/**
 * Resolve a catalogue line: base sales price + extra price of each selected
 * variant value (e.g. Brand = Odoo adds 560). Validates that values belong to
 * the product and that at most one value is chosen per attribute.
 */
export function resolveProductLine(productId, variantValueIds = []) {
  const product = q.get('SELECT * FROM products WHERE id = ?', productId);
  if (!product) throw badRequest(`Product ${productId} does not exist`);
  if (!product.active) throw badRequest(`Product "${product.name}" is archived`);

  const ids = [...new Set(variantValueIds.map(Number))];
  let extra = 0;
  const labels = [];
  if (ids.length) {
    const rows = q.all(
      `SELECT v.id, v.value, v.extra_price, a.id AS attribute_id, a.name AS attribute, a.product_id
       FROM attribute_values v JOIN product_attributes a ON a.id = v.attribute_id
       WHERE v.id IN (${ids.map(() => '?').join(',')})`, ...ids);
    if (rows.length !== ids.length || rows.some((r) => r.product_id !== product.id))
      throw badRequest(`Invalid variant selection for "${product.name}"`);
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.attribute_id)) throw badRequest(`Choose only one ${r.attribute} for "${product.name}"`);
      seen.add(r.attribute_id);
      extra += r.extra_price;
      labels.push(`${r.attribute}: ${r.value}`);
    }
  }
  return {
    product,
    unit_price: round2(product.sales_price + extra),
    description: labels.length ? `${product.name} (${labels.join(', ')})` : product.name,
    variant_value_ids: ids,
  };
}

/** Tax rule resolution: explicit product tax → rule for product type → default rule. */
export function resolveTax(product) {
  if (product.tax_id) {
    const t = q.get('SELECT * FROM taxes WHERE id = ? AND active = 1', product.tax_id);
    if (t) return t;
  }
  return q.get('SELECT * FROM taxes WHERE active = 1 AND product_type = ? ORDER BY id LIMIT 1', product.type)
    || q.get('SELECT * FROM taxes WHERE active = 1 AND is_default = 1 ORDER BY id LIMIT 1')
    || null;
}

/** Discount rules that are live on `date` and still have usage left. */
function liveDiscounts(date) {
  return q.all(
    `SELECT * FROM discounts WHERE active = 1
       AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?)
       AND (max_uses IS NULL OR used_count < max_uses)
     ORDER BY id`, date, date);
}

/**
 * Price a set of lines: per-line tax, auto-applied discount lines, totals.
 * lines: [{ product_id, description, quantity, unit_price, tax_rate, tax_id }]
 * Discounts are pre-tax; the tax on discounted value is reversed on the
 * discount line so totals are exact.
 */
export function priceLines(lines, date, { discounts } = {}) {
  const priced = lines.map((l) => {
    const amount = round2(l.quantity * l.unit_price);
    return { ...l, amount, tax_amount: round2(amount * l.tax_rate / 100) };
  });
  const subtotal = round2(priced.reduce((s, l) => s + l.amount, 0));
  const discountLines = [];
  let remaining = subtotal;

  for (const d of discounts ?? liveDiscounts(date)) {
    const scope = d.product_id ? priced.filter((l) => l.product_id === d.product_id) : priced;
    if (!scope.length) continue;
    const base = round2(scope.reduce((s, l) => s + l.amount, 0));
    const qty = scope.reduce((s, l) => s + l.quantity, 0);
    if (base <= 0 || base < d.min_amount || qty < d.min_quantity) continue;
    let amt = d.type === 'percent' ? round2(base * d.value / 100) : Math.min(d.value, base);
    amt = round2(Math.min(amt, remaining));
    if (amt <= 0) continue;
    remaining = round2(remaining - amt);
    // Reverse tax on the discounted share, allocated proportionally across scope lines.
    const taxReversal = round2(scope.reduce((s, l) => s + (l.amount / base) * amt * l.tax_rate / 100, 0));
    discountLines.push({
      discount_id: d.id,
      description: `Discount: ${d.name}${d.type === 'percent' ? ` (${d.value}%)` : ''}`,
      quantity: 1, unit_price: -amt, amount: -amt,
      tax_rate: amt ? round2(taxReversal / amt * 100) : 0,
      tax_amount: -taxReversal,
    });
  }

  const discount_total = round2(subtotal - remaining);
  const tax_total = round2([...priced, ...discountLines].reduce((s, l) => s + l.tax_amount, 0));
  return { lines: priced, discountLines, subtotal, discount_total, tax_total, total: round2(subtotal - discount_total + tax_total) };
}

/** Load a subscription's lines with *current* tax rules applied. */
export function subscriptionLinesForPricing(subscriptionId) {
  return q.all(
    `SELECT sl.*, p.type AS product_type, p.tax_id AS product_tax_id FROM subscription_lines sl
     JOIN products p ON p.id = sl.product_id WHERE sl.subscription_id = ? ORDER BY sl.id`, subscriptionId,
  ).map((l) => {
    const tax = resolveTax({ tax_id: l.product_tax_id, type: l.product_type });
    return { product_id: l.product_id, description: l.description, quantity: l.quantity,
      unit_price: l.unit_price, tax_id: tax?.id ?? null, tax_rate: tax?.rate ?? 0, tax_name: tax?.name ?? null };
  });
}
