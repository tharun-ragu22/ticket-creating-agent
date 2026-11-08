import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the API lives, from the app's point of view.
 *
 * Device networking only affects this: transport is LiveKit Cloud, so the room
 * is reachable from anywhere, but 127.0.0.1 means the phone itself. An Android
 * emulator reaches the host at 10.0.2.2; a physical device needs the machine's
 * LAN address, which is why this is overridable.
 */
export function apiBaseUrl(): string {
  const configured =
    (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
    process.env['EXPO_PUBLIC_API_BASE_URL'];

  if (configured) return configured;

  // Fall back to the host that served the bundle, which is correct for a
  // physical device on the same network as the dev machine.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:8080`;

  return Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://127.0.0.1:8080';
}
