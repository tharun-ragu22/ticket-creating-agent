import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LiveKitRoom } from '@livekit/react-native';
import { CallSurface } from '../src/components/CallSurface';
import { useCall } from '../src/hooks/useCall';
import { apiBaseUrl } from '../src/lib/config';
import { signInDemo, type DemoSession } from '../src/lib/connection';
import { colors } from '../src/theme';

/**
 * One screen, one button.
 *
 * The caller is already signed in, so there is nothing to fill in and nobody
 * to identify: tap, talk, done. The sign-in here is the demo stand-in for the
 * app's real session.
 */
export default function CallScreen(): React.JSX.Element {
  const baseUrl = apiBaseUrl();
  const [account, setAccount] = useState<DemoSession | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    signInDemo(baseUrl, 'priya')
      .then(setAccount)
      .catch((cause: unknown) =>
        setSignInError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [baseUrl]);

  const call = useCall(
    account ? { baseUrl, accessToken: account.accessToken } : null,
  );

  const connected = call.credentials !== null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        {connected ? (
          <LiveKitRoom
            serverUrl={call.credentials?.serverUrl}
            token={call.credentials?.token}
            connect
            audio
            video={false}
            onConnected={call.onConnected}
            onError={call.onError}
            onDisconnected={() => void call.end()}
          >
            <CallSurface onEnd={() => void call.end()} />
          </LiveKitRoom>
        ) : (
          <Idle
            name={account?.displayName ?? null}
            phase={call.phase}
            error={call.error ?? signInError}
            onStart={() => void call.start()}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function Idle({
  name,
  phase,
  error,
  onStart,
}: {
  name: string | null;
  phase: string;
  error: string | null;
  onStart: () => void;
}): React.JSX.Element {
  const busy = phase === 'connecting';

  return (
    <View style={styles.idle}>
      <View style={styles.greeting}>
        <Text style={styles.hello}>{name ? `Hi ${name.split(' ')[0]}` : 'Synergy IT'}</Text>
        <Text style={styles.sub}>
          {phase === 'ended'
            ? 'Call ended. Your ticket is with the service desk.'
            : 'Tap to call the IT desk and describe the problem out loud.'}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.callButton, (busy || !name) && styles.callButtonDisabled]}
        onPress={onStart}
        disabled={busy || !name}
        accessibilityRole="button"
        accessibilityLabel="Call the IT desk"
      >
        {busy ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={styles.callLabel}>Call IT</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: 16 },
  idle: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 28 },
  greeting: { alignItems: 'center', gap: 10 },
  hello: { color: colors.text, fontSize: 30, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 15, textAlign: 'center', maxWidth: 280, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', maxWidth: 300 },
  callButton: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callButtonDisabled: { opacity: 0.4 },
  callLabel: { color: colors.background, fontSize: 20, fontWeight: '700' },
});
