import { z } from 'zod';

/** Identity fields the agent already has, and must therefore never ask for. */
export const NeverAsk = z.enum([
  'name',
  'email',
  'department',
  'location',
  'employee_id',
  'phone',
]);
export type NeverAsk = z.infer<typeof NeverAsk>;

/**
 * Patterns that mean "the agent asked for something it already had".
 *
 * Deliberately matched against interrogative phrasing rather than bare
 * keywords: the agent is *supposed* to say the caller's name and may confirm
 * their department back to them. "Hi Priya" and "I have you as Priya Raman in
 * Finance" must both pass, while "what's your name" must not.
 *
 * This is a deterministic stand-in for a judge, so it will miss an unusual
 * phrasing. That is an acceptable trade: a false negative here is one escaped
 * case, whereas depending on a judge for a hard-fail metric makes the
 * per-push suite non-deterministic.
 */
const IDENTITY_PATTERNS: Record<NeverAsk, RegExp[]> = {
  name: [
    /\b(what|may i (have|take|ask)|can i (have|take|get)|could i (have|take|get))\b[^?]{0,40}\byour\s+(full\s+)?name\b/i,
    /\bwho\s+am\s+i\s+(speaking|talking)\s+(to|with)\b/i,
    /\bwhat('s| is)\s+your\s+name\b/i,
    /\byour\s+name,?\s+please\b/i,
  ],
  email: [
    /\b(what|which|confirm|remind me of)\b[^?]{0,40}\byour\s+e-?mail\b/i,
    /\bwhat('s| is)\s+your\s+e-?mail\b/i,
    /\be-?mail\s+address\s+should\s+i\s+use\b/i,
  ],
  department: [
    /\b(what|which)\b[^?]{0,40}\b(department|team|business unit)\b[^?]{0,40}\b(are|do)\s+you\b/i,
    /\bwhich\s+(department|team)\s+are\s+you\s+in\b/i,
    /\bwhat\s+(department|team)\s+(are|do)\s+you\b/i,
  ],
  location: [
    /\b(what|which|where)\b[^?]{0,40}\b(office|site|building|floor|location)\b[^?]{0,30}\b(are|do)\s+you\b/i,
    /\bwhich\s+(office|site|building|floor)\b[^?]{0,20}\b(are|from)\b/i,
    /\bwhere\s+are\s+you\s+(based|located|calling\s+from)\b/i,
    /\bwhat\s+floor\s+are\s+you\s+on\b/i,
  ],
  employee_id: [
    /\b(employee|staff|payroll|personnel)\s+(id|number|reference)\b/i,
  ],
  phone: [
    /\b(what|which|best)\b[^?]{0,40}\b(phone|telephone|mobile|contact)\s+number\b/i,
    /\bnumber\s+to\s+reach\s+you\b/i,
  ],
};

/** Which identity fields, if any, the agent asked the caller to supply. */
export function asksForIdentity(text: string): NeverAsk[] {
  const asked: NeverAsk[] = [];

  for (const [field, patterns] of Object.entries(IDENTITY_PATTERNS)) {
    if (patterns.some((p) => p.test(text))) asked.push(field as NeverAsk);
  }
  return asked;
}

