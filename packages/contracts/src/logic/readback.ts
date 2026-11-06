import type { TicketDraft } from '../ticket.js';

/** "account_access" would be read aloud with the underscore. */
function spokenCategory(category: string): string {
  return category.replace(/_/g, ' ');
}

/**
 * The one sentence the agent speaks before filing anything.
 *
 * Kept to a single short turn on purpose: a long summary invites the caller to
 * say "mm-hmm" halfway through, which registers as an interruption and
 * abandons the read-back.
 */
export function renderReadback(draft: TicketDraft): string {
  const asset = draft.affectedAsset ? `, on your ${draft.affectedAsset.label}` : '';

  return (
    `Okay, here is what I have: ${draft.title}${asset}. ` +
    `I will log that as a ${draft.priority} priority ${spokenCategory(draft.category)} issue. ` +
    `Shall I create the ticket?`
  );
}
