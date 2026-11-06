const DIGIT_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
] as const;

/**
 * Renders a ticket reference for a text-to-speech engine.
 *
 * TTS reads "SI-10432" as something like "sigh ten thousand four hundred and
 * thirty two", which a caller cannot write down. Spelling the letters and
 * reading digits individually is the only reliably transcribable form. The app
 * also shows the exact string on the ticket card, which is the real fix.
 */
export function formatTicketRefForSpeech(ref: string): string {
  const runs = ref.toUpperCase().match(/[A-Z]+|[0-9]+/g);
  if (!runs) return '';

  return runs
    .map((run) =>
      /^[0-9]+$/.test(run)
        ? run
            .split('')
            .map((d) => DIGIT_WORDS[Number(d)])
            .join(' ')
        : run.split('').join('-'),
    )
    .join(' ');
}
