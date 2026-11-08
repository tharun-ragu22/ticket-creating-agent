// registerGlobals() must run before anything imports livekit-client, which
// expo-router/entry transitively does. Order here is load-bearing: swap these
// two lines and WebRTC is undefined at connect time, with no useful error.
import { registerGlobals } from '@livekit/react-native';

registerGlobals();

import 'expo-router/entry';
