import { z } from 'zod';

export const MAX_TRANSACTIONS_PER_EVENT = 500;

// Amounts arrive as decimal strings ("-12.34"), never floats, so no cent is lost
// to binary rounding (0.1 + 0.2 !== 0.3).
const amount = z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'amount must be a decimal string like "-12.34"');

const transaction = z.object({
  id: z.string().min(1).max(128),
  amount,
  currency: z.string().length(3).toUpperCase(),
  posted_at: z.iso.datetime({ offset: true }),
  description: z.string().min(1).max(500),
});

export const webhookPayload = z.object({
  event_id: z.string().min(1).max(128),
  institution: z.string().min(1).max(100),
  account_id: z.string().min(1).max(128),
  transactions: z.array(transaction).min(1).max(MAX_TRANSACTIONS_PER_EVENT),
});

// "-12.34" -> -1234, "5" -> 500, "-0.5" -> -50. Pure string math, no floats.
export function toCents(decimal) {
  const negative = decimal.startsWith('-');
  const [whole, frac = ''] = (negative ? decimal.slice(1) : decimal).split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}
