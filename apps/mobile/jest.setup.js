/* eslint-env node */
// @livekit/react-native's entry calls into native modules at import time, so
// the hooks are stubbed per-test instead. This file only silences the noise
// that jest-expo cannot avoid.
jest.mock('@livekit/react-native', () => ({
  registerGlobals: jest.fn(),
  AudioSession: {
    startAudioSession: jest.fn().mockResolvedValue(undefined),
    stopAudioSession: jest.fn().mockResolvedValue(undefined),
    configureAudio: jest.fn().mockResolvedValue(undefined),
  },
  AndroidAudioTypePresets: { communication: {} },
  LiveKitRoom: ({ children }) => children,
  BarVisualizer: () => null,
  useVoiceAssistant: jest.fn(() => ({ state: 'listening', audioTrack: undefined })),
  useRoomContext: jest.fn(() => undefined),
  useLocalParticipant: jest.fn(() => ({ localParticipant: undefined })),
  useConnectionState: jest.fn(() => 'disconnected'),
  useTrackTranscription: jest.fn(() => ({ segments: [] })),
}));
