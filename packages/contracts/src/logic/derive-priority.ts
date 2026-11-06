import type { Impact, TicketCategory, TicketPriority } from '../ticket.js';

/**
 * Priority is derived from impact, never asked.
 *
 * Callers asked to self-assign priority produce unusable data — everything
 * becomes urgent. Note the signature: there is no "caller urgency" parameter,
 * so insistence on the phone cannot reach this decision (eval case EV-PRI-06).
 */
export function derivePriority(impact: Impact, category: TicketCategory): TicketPriority {
  // A possible security incident outranks everything else, including a caller
  // who is not blocked and sounds relaxed about it.
  if (category === 'security') return 'urgent';

  // Anything beyond a single team is an outage, blocked or not.
  if (impact.scope === 'site' || impact.scope === 'company') return 'urgent';

  if (impact.workBlocked) return impact.scope === 'self' ? 'normal' : 'high';

  return 'low';
}
