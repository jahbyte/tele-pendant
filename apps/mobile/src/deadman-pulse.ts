import type { Socket } from 'socket.io-client';

export type DeadmanPulseSnapshot = {
  deadmanActive?: boolean;
};

/**
 * Emit deadman.pulse and wait for the server ack so HTTP activate cannot beat
 * the WS pulse on slow Wi-Fi (~30ms races).
 */
export function emitDeadmanPulseAck(
  sock: Socket | null | undefined,
  timeoutMs = 1500,
): Promise<DeadmanPulseSnapshot | null> {
  return new Promise((resolve) => {
    if (!sock) {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (value: DeadmanPulseSnapshot | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      sock.emit('deadman.pulse', (snap: DeadmanPulseSnapshot) => {
        done(snap ?? null);
      });
    } catch {
      done(null);
    }
  });
}
