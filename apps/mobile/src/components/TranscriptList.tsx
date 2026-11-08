import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import type { TranscriptLine } from '../hooks/useCallTranscript';
import { colors } from '../theme';

/** The conversation so far, pinned to the newest line. */
export function TranscriptList({ lines }: { lines: TranscriptLine[] }): React.JSX.Element {
  const scroller = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    // Without this the caller is left reading the top of the call while the
    // agent is three turns further on.
    scroller.current?.scrollToEnd({ animated: true });
  }, [lines.length]);

  return (
    <ScrollView
      ref={scroller}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {lines.map((line) => (
        <View key={line.id} style={styles.line}>
          <Text style={[styles.speaker, line.speaker === 'agent' ? styles.agent : styles.caller]}>
            {line.speaker === 'agent' ? 'IT desk' : 'You'}
          </Text>
          <Text style={styles.text}>{line.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: 14, paddingVertical: 8 },
  line: { gap: 2 },
  speaker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  agent: { color: colors.accent },
  caller: { color: colors.muted },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
});
