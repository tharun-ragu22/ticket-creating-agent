import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BarVisualizer,
  useLocalParticipant,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/react-native';
import { DraftCard } from './DraftCard';
import { TranscriptList } from './TranscriptList';
import { useCallTranscript } from '../hooks/useCallTranscript';
import { useTicketEvents } from '../hooks/useTicketEvents';
import { colors } from '../theme';

/**
 * Everything inside a connected room.
 *
 * Separate from the screen because every hook here needs RoomContext, which
 * only exists below LiveKitRoom.
 */
export function CallSurface({ onEnd }: { onEnd: () => void }): React.JSX.Element {
  const room = useRoomContext();
  const { state, audioTrack } = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const ticket = useTicketEvents(room as never);
  const lines = useCallTranscript();
  const elapsed = useElapsed();

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <BarVisualizer
          state={state}
          barCount={5}
          {...(audioTrack ? { trackRef: audioTrack } : {})}
          options={{ barColor: colors.accent, barWidth: 10, barBorderRadius: 5, minHeight: 0.1 }}
          style={styles.visualizer}
        />
        <Text style={styles.who}>IT Service Desk</Text>
        <Text style={styles.status}>
          {formatElapsed(elapsed)} · {describe(state)}
        </Text>
      </View>

      {/*
        No agent participant has joined, and the room itself is healthy — which
        looks identical to a slow connection and is almost always a worker that
        is not running. The room name is here so it can be matched against the
        worker's log line for the job.
      */}
      {state === 'disconnected' && elapsed >= AGENT_JOIN_GRACE_SECONDS ? (
        <Text style={styles.micWarning}>
          No agent has joined {room.name} after {elapsed}s. Start the worker with
          {'\n'}pnpm --filter @tca/agent dev
        </Text>
      ) : null}

      <DraftCard state={ticket} />

      {/*
        The mic can be denied after the room connects, and the symptom is a
        transcript that never fills while everything else looks healthy.
      */}
      {isMicrophoneEnabled === false ? (
        <Text style={styles.micWarning}>
          Your microphone is off — the agent cannot hear you.
        </Text>
      ) : null}

      <TranscriptList lines={lines} />

      <View style={styles.controls}>
        <Pressable
          style={styles.secondary}
          onPress={() => void localParticipant?.setMicrophoneEnabled(isMicrophoneEnabled === false)}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryLabel}>
            {isMicrophoneEnabled === false ? 'Unmute' : 'Mute'}
          </Text>
        </Pressable>
        <Pressable style={styles.hangUp} onPress={onEnd} accessibilityRole="button">
          <Text style={styles.hangUpLabel}>End call</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Seconds since the surface mounted, which is when the room connected. */
function useElapsed(): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    // Wall-clock difference rather than a counter, because JS timers throttle
    // in the background and a counter would under-report after a return.
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, []);

  return seconds;
}

const formatElapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * How long to wait before saying the agent is missing.
 *
 * Dispatch plus the worker's prewarm is a second or two on a warm machine and
 * longer on a cold one, so this is generous enough never to cry wolf.
 */
const AGENT_JOIN_GRACE_SECONDS = 8;

/**
 * The agent's state in words.
 *
 * `disconnected` is called out separately rather than folded into a default
 * branch: useVoiceAssistant's legacy lifecycle is disconnected → connecting →
 * initializing → listening, so a room with no agent in it never leaves the
 * first state, and labelling that "connecting" sends you looking at the
 * network when the worker is simply not running.
 */
function describe(state: string): string {
  switch (state) {
    case 'speaking':
      return 'speaking';
    case 'thinking':
      return 'thinking';
    case 'listening':
    case 'pre-connect-buffering':
      return 'listening';
    case 'initializing':
    case 'idle':
      return 'agent starting';
    case 'connecting':
      return 'connecting';
    case 'failed':
      return 'the agent failed to join';
    default:
      return 'waiting for the agent';
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: 16 },
  stage: { alignItems: 'center', gap: 8, paddingTop: 12 },
  visualizer: { height: 72, width: 140 },
  who: { color: colors.text, fontSize: 17, fontWeight: '600' },
  status: { color: colors.muted, fontSize: 13 },
  micWarning: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  controls: { flexDirection: 'row', gap: 12, paddingBottom: 8 },
  secondary: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hangUp: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: colors.danger,
  },
  hangUpLabel: { color: '#0b0d10', fontSize: 15, fontWeight: '700' },
});
