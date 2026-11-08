import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AudioSession } from '@livekit/react-native';
import { useCall } from '../src/hooks/useCall';

const SESSION = { baseUrl: 'http://127.0.0.1:8080', accessToken: 'app-jwt' };

const DETAILS = {
  serverUrl: 'wss://p.livekit.cloud',
  token: 'jwt.for.priya',
  roomName: 'call-priya-abc123',
};

const audio = AudioSession as unknown as {
  startAudioSession: jest.Mock;
  stopAudioSession: jest.Mock;
  configureAudio: jest.Mock;
};

beforeEach(() => {
  // mockReset rather than mockClear: one test installs an order-recording
  // implementation, and it must not leak. Re-stubbing the resolved value is
  // then required, because a bare reset returns undefined and useCall does
  // `AudioSession.stopAudioSession().catch(...)` on the result.
  for (const mock of [audio.startAudioSession, audio.stopAudioSession, audio.configureAudio]) {
    mock.mockReset();
    mock.mockResolvedValue(undefined);
  }
});

describe('useCall', () => {
  it('starts idle, with nothing connected', async () => {
    const { result } = await renderHook(() => useCall(SESSION, { fetchDetails: async () => DETAILS }));

    expect(result.current.phase).toBe('idle');
    expect(result.current.credentials).toBeNull();
  });

  it('fetches credentials and opens the audio session when the call starts', async () => {
    const { result } = await renderHook(() => useCall(SESSION, { fetchDetails: async () => DETAILS }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.phase).toBe('connecting');
    expect(result.current.credentials).toEqual(DETAILS);
    expect(audio.startAudioSession).toHaveBeenCalledTimes(1);
  });

  /**
   * Audio routing is configured before the session opens, not after: on
   * Android the communication mode is what puts the call on the earpiece with
   * echo cancellation, and applying it late means the first seconds come out
   * of the speakerphone.
   */
  it('configures communication-mode audio before opening the session', async () => {
    const order: string[] = [];
    audio.configureAudio.mockImplementation(async () => void order.push('configure'));
    audio.startAudioSession.mockImplementation(async () => void order.push('start'));

    const { result } = await renderHook(() => useCall(SESSION, { fetchDetails: async () => DETAILS }));
    await act(async () => {
      await result.current.start();
    });

    expect(order).toEqual(['configure', 'start']);
  });

  it('goes live once the room reports it connected', async () => {
    const { result } = await renderHook(() => useCall(SESSION, { fetchDetails: async () => DETAILS }));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      result.current.onConnected();
    });

    expect(result.current.phase).toBe('live');
  });

  /**
   * The failure mode the plan calls out: skip the stop and the whole app stays
   * stuck in earpiece mode afterwards. It must happen on the error path too,
   * not only on a clean hang-up.
   */
  it('closes the audio session when connecting fails', async () => {
    const { result } = await renderHook(() =>
      useCall(SESSION, {
        fetchDetails: async () => {
          throw new Error('API unreachable');
        },
      }),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/API unreachable/);
    expect(audio.stopAudioSession).toHaveBeenCalledTimes(1);
  });

  it('closes the audio session and drops the credentials when the call ends', async () => {
    const { result } = await renderHook(() => useCall(SESSION, { fetchDetails: async () => DETAILS }));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.end();
    });

    expect(result.current.phase).toBe('ended');
    expect(result.current.credentials).toBeNull();
    expect(audio.stopAudioSession).toHaveBeenCalledTimes(1);
  });

  it('closes the audio session if the screen unmounts mid-call', async () => {
    const { result, unmount } = await renderHook(() =>
      useCall(SESSION, { fetchDetails: async () => DETAILS }),
    );
    await act(async () => {
      await result.current.start();
    });

    await unmount();

    await waitFor(() => expect(audio.stopAudioSession).toHaveBeenCalled());
  });

  /** Double-tapping Call must not mint two tokens or open two rooms. */
  it('ignores a second start while one is already in flight', async () => {
    let calls = 0;
    const { result } = await renderHook(() =>
      useCall(SESSION, {
        fetchDetails: async () => {
          calls += 1;
          return DETAILS;
        },
      }),
    );

    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()]);
    });

    expect(calls).toBe(1);
  });

  it('mints fresh credentials for a second call rather than reusing the room', async () => {
    const rooms: string[] = [];
    let n = 0;
    const { result } = await renderHook(() =>
      useCall(SESSION, {
        fetchDetails: async () => {
          n += 1;
          const details = { ...DETAILS, roomName: `call-priya-${n}` };
          rooms.push(details.roomName);
          return details;
        },
      }),
    );

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.end();
    });
    await act(async () => {
      await result.current.start();
    });

    expect(rooms).toEqual(['call-priya-1', 'call-priya-2']);
  });

  it('cannot start without a signed-in session', async () => {
    const { result } = await renderHook(() => useCall(null, { fetchDetails: async () => DETAILS }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/sign in/i);
  });
});
