import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CallTicketState } from '@tca/contracts';
import { colors } from '../theme';

/**
 * The ticket, collapsed to one line until tapped.
 *
 * Collapsed is the default because the caller is on a call: the detail matters
 * when they want to check what the technician will receive, not continuously.
 */
export function DraftCard({ state }: { state: CallTicketState }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const { draft, ticket, failure, amending } = state;

  // The filed ticket carries the same fields plus a reference, so one card
  // serves both and the caller sees it become real rather than be replaced.
  const shown = ticket ?? draft;
  if (!shown) return null;

  return (
    <Pressable
      style={[styles.card, ticket ? styles.filed : null]}
      onPress={() => setOpen((value) => !value)}
      accessibilityRole="button"
      accessibilityLabel={open ? 'Collapse ticket details' : 'Expand ticket details'}
    >
      <View style={styles.header}>
        <Text style={[styles.badge, ticket ? styles.badgeFiled : null]}>
          {ticket ? ticket.providerTicketId : amending ? 'UPDATING' : 'DRAFT'}
        </Text>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </View>

      <Text
        style={[styles.title, amending ? styles.superseded : null]}
        numberOfLines={open ? undefined : 2}
      >
        {shown.title}
      </Text>
      <Text style={[styles.meta, amending ? styles.superseded : null]}>
        {shown.category} · {shown.priority}
        {shown.affectedAsset ? ` · ${shown.affectedAsset.label}` : ''}
      </Text>

      {/*
        The correction the caller just made, which takes the agent several turns
        to gather and re-propose. Without this line the card sits there showing
        the wording they corrected, which reads as the correction being ignored.
      */}
      {amending ? (
        <Text style={styles.amending}>Updating this with your correction…</Text>
      ) : null}

      {failure ? <Text style={styles.failure}>Could not file it: {failure}</Text> : null}

      {open ? (
        <View style={styles.details}>
          <Field label="What happened" value={shown.description} />
          {shown.affectedAsset ? (
            <Field
              label="Device"
              value={`${shown.affectedAsset.label}${
                shown.affectedAsset.identifier ? ` (${shown.affectedAsset.identifier})` : ''
              }`}
            />
          ) : null}
          <Field
            label="Impact"
            value={`${shown.impact.scope}${
              shown.impact.usersAffected ? ` · ${shown.impact.usersAffected} affected` : ''
            }${shown.impact.workBlocked ? ' · blocked' : ''}`}
          />
          {shown.troubleshootingTried.length > 0 ? (
            <Field label="Already tried" value={shown.troubleshootingTried.join('; ')} />
          ) : null}
          {ticket && ticket.comments.length > 0 ? (
            // Anything added after filing arrives as a comment, because a filed
            // ticket cannot be amended. It belongs on the card for the same
            // reason the draft does: the caller asked for it.
            <Field
              label="Added since"
              value={ticket.comments.map((comment) => comment.body).join('\n')}
            />
          ) : null}
          {ticket ? <Field label="Reported as" value={ticket.reporter.displayName} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  filed: { borderColor: colors.accent },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  badgeFiled: { color: colors.accent },
  chevron: { color: colors.muted, fontSize: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 13 },
  superseded: { opacity: 0.45 },
  amending: { color: colors.accent, fontSize: 13 },
  failure: { color: colors.danger, fontSize: 13 },
  details: { marginTop: 8, gap: 10 },
  field: { gap: 2 },
  fieldLabel: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  fieldValue: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
