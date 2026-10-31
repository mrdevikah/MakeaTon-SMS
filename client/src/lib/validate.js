// Client-side mirrors of the server rules, for instant feedback. The server re-validates everything.
export const rules = {
  required: (v) => (v === undefined || v === null || String(v).trim() === '' ? 'Required' : null),
  email: (v) => (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()) ? 'Enter a valid email' : null),
  password: (v = '') => {
    if (v.length <= 8) return 'Must be more than 8 characters';
    if (!/[A-Z]/.test(v)) return 'Add an uppercase letter';
    if (!/[a-z]/.test(v)) return 'Add a lowercase letter';
    if (!/[^A-Za-z0-9]/.test(v)) return 'Add a special character';
    return null;
  },
  min: (n) => (v) => (v === '' || v === null || v === undefined || Number(v) < n ? `Must be at least ${n}` : null),
  max: (n) => (v) => (Number(v) > n ? `Must be at most ${n}` : null),
  positive: (v) => (!(Number(v) > 0) ? 'Must be greater than 0' : null),
};

/** validate({email: [rules.required, rules.email]}, values) → { email: 'msg' } */
export function check(spec, values) {
  const errs = {};
  for (const [k, fns] of Object.entries(spec)) {
    for (const fn of fns) { const m = fn(values[k], values); if (m) { errs[k] = m; break; } }
  }
  return errs;
}

export const passwordChecks = (v = '') => [
  { ok: v.length > 8, label: 'More than 8 characters' },
  { ok: /[A-Z]/.test(v), label: 'One uppercase letter' },
  { ok: /[a-z]/.test(v), label: 'One lowercase letter' },
  { ok: /[^A-Za-z0-9]/.test(v), label: 'One special character' },
];
