import { z } from 'zod';
import { badRequest } from './util.js';

// Spec: "more than 8 characters" with 1 uppercase, 1 lowercase, 1 special character.
export const password = z.string()
  .min(9, 'Password must be more than 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[^A-Za-z0-9]/, 'Password needs a special character');

export const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')), 'Invalid date');
const money = z.coerce.number().finite().min(0).max(1e10);
const optDate = isoDate.nullable().optional();
const flag = z.coerce.boolean();

export const schemas = {
  login: z.object({ email, password: z.string().min(1, 'Password is required') }),
  forgot: z.object({ email }),
  reset: z.object({ token: z.string().min(20), password }),
  signup: z.object({ name: z.string().trim().min(2).max(120), email, password }),
  changePassword: z.object({ currentPassword: z.string().min(1), newPassword: password }),

  user: z.object({
    name: z.string().trim().min(2).max(120), email, password,
    role: z.enum(['admin', 'staff', 'customer']),
    customer_id: z.coerce.number().int().positive().nullable().optional(),
  }),
  userUpdate: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(['admin', 'staff', 'customer']).optional(),
    active: flag.optional(),
  }),

  customer: z.object({
    name: z.string().trim().min(2).max(160), email,
    phone: z.string().trim().max(30).regex(/^[0-9+\-() ]*$/, 'Invalid phone').optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    create_login: flag.optional(),
    password: password.optional(),
  }).refine((v) => !v.create_login || v.password, { message: 'Password required to create a login', path: ['password'] }),

  tax: z.object({
    name: z.string().trim().min(1).max(80),
    rate: z.coerce.number().min(0).max(100),
    product_type: z.enum(['service', 'software', 'goods']).nullable().optional(),
    is_default: flag.optional(),
    active: flag.optional(),
  }),

  product: z.object({
    name: z.string().trim().min(1).max(160),
    type: z.enum(['service', 'software', 'goods']),
    sales_price: money, cost_price: money.default(0),
    notes: z.string().max(2000).optional().nullable(),
    tax_id: z.coerce.number().int().positive().nullable().optional(),
    active: flag.optional(),
    attributes: z.array(z.object({
      name: z.string().trim().min(1).max(80),
      values: z.array(z.object({
        value: z.string().trim().min(1).max(80),
        extra_price: z.coerce.number().finite().min(-1e9).max(1e9).default(0),
      })).min(1, 'Each attribute needs at least one value'),
    })).default([]),
  }),

  plan: z.object({
    name: z.string().trim().min(1).max(120),
    billing_period: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval_count: z.coerce.number().int().min(1).max(365).default(1),
    min_quantity: z.coerce.number().int().min(1).max(100000).default(1),
    duration_cycles: z.coerce.number().int().min(1).max(10000).nullable().optional(),
    available_from: optDate, available_to: optDate,
    auto_close: flag.default(true), closable: flag.default(true),
    pausable: flag.default(false), renewable: flag.default(false),
    active: flag.optional(),
  }).refine((p) => !p.available_from || !p.available_to || p.available_from <= p.available_to,
    { message: 'Availability end must be after start', path: ['available_to'] }),

  template: z.object({
    name: z.string().trim().min(1).max(120),
    validity_days: z.coerce.number().int().min(1).max(365),
    plan_id: z.coerce.number().int().positive().nullable().optional(),
    payment_terms_days: z.coerce.number().int().min(0).max(365).default(15),
    notes: z.string().max(2000).optional().nullable(),
    lines: z.array(z.object({
      product_id: z.coerce.number().int().positive(),
      quantity: z.coerce.number().int().min(1).max(100000),
      variant_value_ids: z.array(z.coerce.number().int().positive()).default([]),
    })).default([]),
  }),

  subscription: z.object({
    customer_id: z.coerce.number().int().positive(),
    plan_id: z.coerce.number().int().positive(),
    template_id: z.coerce.number().int().positive().nullable().optional(),
    start_date: isoDate,
    expiry_date: optDate,
    payment_terms_days: z.coerce.number().int().min(0).max(365).default(15),
    notes: z.string().max(2000).optional().nullable(),
    lines: z.array(z.object({
      product_id: z.coerce.number().int().positive(),
      quantity: z.coerce.number().int().min(1).max(100000),
      variant_value_ids: z.array(z.coerce.number().int().positive()).default([]),
      unit_price: money.optional(),
    })).min(1, 'Add at least one line item'),
  }).refine((s) => !s.expiry_date || s.expiry_date > s.start_date,
    { message: 'Expiry must be after start date', path: ['expiry_date'] }),

  discount: z.object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(['percent', 'fixed']),
    value: z.coerce.number().positive().max(1e9),
    min_amount: money.default(0),
    min_quantity: z.coerce.number().int().min(0).default(0),
    start_date: optDate, end_date: optDate,
    max_uses: z.coerce.number().int().min(1).nullable().optional(),
    product_id: z.coerce.number().int().positive().nullable().optional(),
    active: flag.optional(),
  }).refine((d) => d.type !== 'percent' || d.value <= 100, { message: 'Percent cannot exceed 100', path: ['value'] })
    .refine((d) => !d.start_date || !d.end_date || d.start_date <= d.end_date, { message: 'End must be after start', path: ['end_date'] }),

  payment: z.object({
    invoice_id: z.coerce.number().int().positive(),
    method: z.enum(['card', 'bank_transfer', 'cash', 'upi', 'cheque', 'other']),
    date: isoDate,
    amount: z.coerce.number().positive().max(1e10),
    notes: z.string().max(1000).optional().nullable(),
  }),
};

/** Parse body against a schema; throws a 400 with per-field messages. */
export function validate(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const fields = {};
    for (const i of r.error.issues) {
      const k = i.path.join('.') || '_';
      if (!fields[k]) fields[k] = i.message;
    }
    throw badRequest('Validation failed', fields);
  }
  return r.data;
}
