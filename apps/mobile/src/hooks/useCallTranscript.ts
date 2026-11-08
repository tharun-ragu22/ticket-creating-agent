import { useMemo } from 'react';
import { useLocalParticipant, useTrackTranscription, useVoiceAssistant } from '@livekit/react-native';
import { Track } from 'livekit-client';

export interface TranscriptLine {
  id: string;
  speaker: 'caller' | 'agent';
  text: string;
  firstReceivedTime: number;
}

/**
 * Both sides of the conversation, in the order they were said.
 *
 * Sorted by when each segment first arrived rather than when it was last
 * updated: a segment is revised as more audio is transcribed, and sorting on
 * the latest edit makes finished lines jump below newer ones mid-call.
 */
export function useCallTranscript(): TranscriptLine[] {
  const { agentTranscriptions } = useVoiceAssistant();
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const callerTranscriptions = useTrackTranscription(
    microphoneTrack
      ? { publication: microphoneTrack, source: Track.Source.Microphone, participant: localParticipant }
      : undefined,
  );

  return useMemo(() => {
    const lines: TranscriptLine[] = [
      ...(agentTranscriptions ?? []).map((segment) => line(segment, 'agent')),
      ...(callerTranscriptions?.segments ?? []).map((segment) => line(segment, 'caller')),
    ];

    return lines
      .filter((entry) => entry.text.trim().length > 0)
      .sort((a, b) => a.firstReceivedTime - b.firstReceivedTime);
  }, [agentTranscriptions, callerTranscriptions?.segments]);
}

function line(
  segment: { id: string; text: string; firstReceivedTime?: number },
  speaker: 'caller' | 'agent',
): TranscriptLine {
  return {
    id: `${speaker}:${segment.id}`,
    speaker,
    text: segment.text,
    firstReceivedTime: segment.firstReceivedTime ?? 0,
  };
}
