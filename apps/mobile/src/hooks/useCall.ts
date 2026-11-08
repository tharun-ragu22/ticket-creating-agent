import { useCallback, useEffect, useRef, useState } from 'react';
import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { fetchConnectionDetails, type ApiSession, type ConnectionDetails } from '../lib/connection';

export type CallPhase = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export interface CallController {
  phase: CallPhase;
  credentials: ConnectionDetails | null;
  error: string | null;
  start: () => Promise<void>;
  end: () => Promise<void>;
  /** Handed to LiveKitRoom's onConnected. */
  onConnected: () => void;
  /** Handed to LiveKitRoom's onError. */
  onError: (error: Error) => void;
}

export interface CallDependencies {
  fetchDetails?: (session: ApiSession) => Promise<ConnectionDetails>;
}

/**
 * The call's lifecycle, kept out of the screen.
 *
 * Wrapping the SDK here is deliberate: @livekit/react-native's hook surface
 * moves between minor versions — the useSession/useSessionMessages pair the
 * plan was written against no longer exists in 3.1.0 — so the screen talks to
 * this interface and an SDK change is a one-file fix.
 */
export function useCall(
  session: ApiSession | null,
  deps: CallDependencies = {},
): CallController {
  const fetchDetails = deps.fetchDetails ?? ((s: ApiSession) => fetchConnectionDetails(s));

  const [phase, setPhase] = useState<CallPhase>('idle');
  const [credentials, setCredentials] = useState<ConnectionDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A ref, not state: double-tapping Call would otherwise mint two tokens and
  // create two rooms, and the second room's agent would talk to nobody.
  const starting = useRef(false);
  const audioOpen = useRef(false);

  const closeAudio = useCallback(async () => {
    if (!audioOpen.current) return;
    audioOpen.current = false;
    // Not stopping leaves the whole app routed to the earpiece afterwards,
    // which outlives the screen.
    await AudioSession.stopAudioSession().catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    if (starting.current || phase === 'connecting' || phase === 'live') return;
    starting.current = true;

    setError(null);

    try {
      if (!session) throw new Error('Sign in before starting a call.');

      // Configure before opening: on Android the communication preset is what
      // routes to the earpiece with echo cancellation, and applying it after
      // the session has opened means the first seconds play out loud.
      await AudioSession.configureAudio({
        android: { audioTypeOptions: AndroidAudioTypePresets.communication },
        ios: { defaultOutput: 'earpiece' },
      });
      await AudioSession.startAudioSession();
      audioOpen.current = true;

      // Fetched per call, never cached: the agent is dispatched when the room
      // is created, so a reused token joins a room no agent will join.
      setCredentials(await fetchDetails(session));
      setPhase('connecting');
    } catch (cause) {
      await closeAudio();
      setCredentials(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase('error');
    } finally {
      starting.current = false;
    }
  }, [closeAudio, fetchDetails, phase, session]);

  const end = useCallback(async () => {
    await closeAudio();
    // Dropping the credentials is what unmounts LiveKitRoom and disconnects.
    setCredentials(null);
    setPhase('ended');
  }, [closeAudio]);

  const onConnected = useCallback(() => setPhase('live'), []);

  const onError = useCallback(
    (cause: Error) => {
      void closeAudio();
      setError(cause.message);
      setPhase('error');
    },
    [closeAudio],
  );

  // Backgrounding, a crash in a child, or navigating away all land here.
  useEffect(() => () => void closeAudio(), [closeAudio]);

  return { phase, credentials, error, start, end, onConnected, onError };
}
