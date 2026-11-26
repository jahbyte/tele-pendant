import { emitDeadmanPulseAck } from './deadman-pulse';

describe('emitDeadmanPulseAck', () => {
  it('resolves null without a socket', async () => {
    await expect(emitDeadmanPulseAck(null)).resolves.toBeNull();
  });

  it('resolves the server ack snapshot', async () => {
    const emit = jest.fn((event: string, cb?: (snap: unknown) => void) => {
      if (event === 'deadman.pulse' && cb) {
        cb({ deadmanActive: true });
      }
    });
    await expect(emitDeadmanPulseAck({ emit } as never, 1000)).resolves.toEqual(
      { deadmanActive: true },
    );
  });

  it('times out when the server never acks', async () => {
    jest.useFakeTimers();
    const pending = emitDeadmanPulseAck({ emit: jest.fn() } as never, 400);
    await jest.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBeNull();
    jest.useRealTimers();
  });
});
