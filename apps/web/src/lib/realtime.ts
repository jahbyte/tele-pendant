import { io, Socket } from 'socket.io-client';
import { getControlClientId } from './control-client-id';

let socket: Socket | null = null;
let socketToken: string | null = null;
let socketClientId: string | null = null;

function readAccessToken(): string | null {
  try {
    return localStorage.getItem('accessToken');
  } catch {
    return null;
  }
}

/** Drop the cached socket so the next call reconnects with a fresh token. */
export function resetRealtimeSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socketToken = null;
  socketClientId = null;
}

export function getRealtimeSocket(): Socket {
  const token = readAccessToken();
  const controlClientId = getControlClientId();
  if (socket && (socketToken !== token || socketClientId !== controlClientId)) {
    resetRealtimeSocket();
  }
  if (!socket) {
    socketToken = token;
    socketClientId = controlClientId;
    socket = io('/realtime', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      auth: token ? { token, controlClientId } : { controlClientId },
    });
  }
  return socket;
}

export type DeadmanPulseSnapshot = {
  deadmanActive?: boolean;
};

/**
 * Emit deadman.pulse and wait for the server ack so HTTP activate cannot beat
 * the WS pulse on slow Wi-Fi (~30ms races).
 */
export function emitDeadmanPulseAck(
  sock: Socket,
  timeoutMs = 1500,
): Promise<DeadmanPulseSnapshot | null> {
  return new Promise((resolve) => {
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
