import { beforeEach, describe, expect, it, vi } from 'vitest';

const disconnect = vi.fn();
const ioMock = vi.fn(() => ({ id: 'sock', disconnect }));

vi.mock('socket.io-client', () => ({
  io: ((...args: unknown[]) =>
    ioMock(...(args as Parameters<typeof ioMock>))) as typeof ioMock,
}));

describe('getRealtimeSocket', () => {
  beforeEach(() => {
    ioMock.mockClear();
    disconnect.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('controlClientId', 'test-client');
    vi.resetModules();
  });

  it('creates a singleton socket with the access token (TP-37)', async () => {
    localStorage.setItem('accessToken', 'tok-1');
    const { getRealtimeSocket } = await import('./realtime');
    const a = getRealtimeSocket();
    const b = getRealtimeSocket();
    expect(a).toBe(b);
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledWith(
      '/realtime',
      expect.objectContaining({
        path: '/socket.io',
        withCredentials: true,
        auth: { token: 'tok-1', controlClientId: 'test-client' },
      }),
    );
  });

  it('reconnects when the access token changes', async () => {
    localStorage.setItem('accessToken', 'tok-1');
    const mod = await import('./realtime');
    mod.getRealtimeSocket();
    localStorage.setItem('accessToken', 'tok-2');
    mod.getRealtimeSocket();
    expect(disconnect).toHaveBeenCalled();
    expect(ioMock).toHaveBeenCalledTimes(2);
    expect(ioMock).toHaveBeenLastCalledWith(
      '/realtime',
      expect.objectContaining({
        auth: { token: 'tok-2', controlClientId: 'test-client' },
      }),
    );
  });

  it('connects without token when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'controlClientId') return 'test-client';
      throw new Error('blocked');
    });
    const { getRealtimeSocket, resetRealtimeSocket } =
      await import('./realtime');
    resetRealtimeSocket();
    getRealtimeSocket();
    expect(ioMock).toHaveBeenCalledWith(
      '/realtime',
      expect.objectContaining({
        auth: { controlClientId: expect.any(String) },
      }),
    );
  });

  it('waits for deadman.pulse ack and times out when none arrives', async () => {
    vi.useFakeTimers();
    const { emitDeadmanPulseAck } = await import('./realtime');
    const emit = vi.fn((event: string, cb?: (snap: unknown) => void) => {
      if (event === 'deadman.pulse' && cb) {
        cb({ deadmanActive: true });
        cb({ deadmanActive: true }); // second ack ignored after settle
      }
    });
    await expect(emitDeadmanPulseAck({ emit } as never, 1000)).resolves.toEqual(
      { deadmanActive: true },
    );

    const nullAck = vi.fn((event: string, cb?: (snap: unknown) => void) => {
      if (event === 'deadman.pulse' && cb) cb(undefined);
    });
    await expect(
      emitDeadmanPulseAck({ emit: nullAck } as never, 1000),
    ).resolves.toBeNull();

    const hang = vi.fn();
    const pending = emitDeadmanPulseAck({ emit: hang } as never, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeNull();

    const boom = vi.fn(() => {
      throw new Error('emit failed');
    });
    await expect(
      emitDeadmanPulseAck({ emit: boom } as never, 500),
    ).resolves.toBeNull();
    vi.useRealTimers();
  });
});
