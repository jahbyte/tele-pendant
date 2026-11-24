import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { VoiceListenButton } from './voice-listen-button';
import { renderWithProviders } from '../test/render';
import * as api from '../lib/api';

const socket = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));
vi.mock('@/lib/realtime', () => ({
  getRealtimeSocket: () => socket,
}));
vi.mock('../lib/realtime', () => ({
  getRealtimeSocket: () => socket,
}));

const toastMocks = vi.hoisted(() => ({
  ok: vi.fn(),
  err: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  toastOk: (...args: unknown[]) => toastMocks.ok(...args),
  toastErr: (...args: unknown[]) => toastMocks.err(...args),
}));

type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<unknown> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

describe('VoiceListenButton', () => {
  beforeEach(() => {
    socket.emit.mockClear();
    toastMocks.ok.mockClear();
    toastMocks.err.mockClear();
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    vi.spyOn(api, 'apiPost').mockResolvedValue({ ok: true, label: 'STOP' });
  });

  it('reports missing speech recognition', async () => {
    renderWithProviders(<VoiceListenButton />);
    const mic = screen.getByRole('button', { name: 'Listen' });
    const down = fireEvent.pointerDown(mic);
    expect(down).toBe(false);
    fireEvent.click(mic);
    await waitFor(() =>
      expect(toastMocks.err).toHaveBeenCalledWith(
        'SpeechRecognition not supported in this browser',
      ),
    );
  });

  it('ignores deadman release failures when listen ends', async () => {
    const instances: Rec[] = [];
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: Rec) {
      this.start = vi.fn();
      this.stop = vi.fn(() => this.onend?.());
      instances.push(this);
    }) as unknown as typeof window.SpeechRecognition;
    vi.spyOn(api, 'apiPost').mockImplementation(async (path) => {
      if (path === '/safety/deadman/release') throw new Error('release failed');
      return { ok: true };
    });
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    await waitFor(() => expect(instances[0]?.onend).toBeTruthy());
    instances[0]!.onend?.();
  });

  it('reuses an active deadman interval when listen is restarted', async () => {
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: {
      start: () => void;
      stop: () => void;
      onend: (() => void) | null;
    }) {
      this.start = vi.fn();
      this.stop = vi.fn();
      this.onend = null;
    }) as unknown as typeof window.SpeechRecognition;
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    fireEvent.click(screen.getByRole('button', { name: /Listening/ }));
    expect(socket.emit).toHaveBeenCalledWith('deadman.pulse');
  });

  it('runs speech recognition success and error paths', async () => {
    const instances: Rec[] = [];
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: Rec) {
      this.start = vi.fn();
      this.stop = vi.fn(() => this.onend?.());
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      instances.push(this);
    }) as unknown as typeof window.SpeechRecognition;

    const voiceQueue: Array<unknown | Error | string> = [
      { ok: true, label: 'OWVA up/down' },
      { ok: false, reason: 'deadman_required' },
      new Error('voice failed'),
      { ok: true, label: 'STOP', message: 'STOP commanded (STOP).' },
    ];
    const post = vi.spyOn(api, 'apiPost').mockImplementation(async (path) => {
      if (path !== '/media/voice') return { ok: true };
      const next = voiceQueue.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'string') throw next;
      return next as { ok: boolean };
    });
    const voiceCalls = () =>
      post.mock.calls.filter(([path]) => path === '/media/voice');

    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(socket.emit).toHaveBeenCalledWith('deadman.pulse');

    const instance = () => instances[instances.length - 1]!;

    // interim only — no send yet
    instance().onresult?.({
      results: [
        Object.assign([{ transcript: 'ow' }], { isFinal: false }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    expect(voiceCalls()).toHaveLength(0);

    // final owva up
    fireEvent.click(screen.getByRole('button', { name: /Listening|Listen/ }));
    await waitFor(() => expect(instances.length).toBeGreaterThan(0));
    instance().onresult?.({
      results: [
        Object.assign([{ transcript: 'owva up' }], {
          isFinal: true,
        }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() => expect(voiceCalls().length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(toastMocks.ok).toHaveBeenCalledWith('OWVA up/down'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instance().onresult?.({
      results: [
        Object.assign([{ transcript: 'owva up' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() =>
      expect(toastMocks.err).toHaveBeenCalledWith('deadman_required'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instance().onresult?.({
      results: [
        Object.assign([{ transcript: 'up' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() =>
      expect(toastMocks.err).toHaveBeenCalledWith('voice failed'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instance().onresult?.({
      results: [
        Object.assign([{ transcript: 'stop' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() =>
      expect(toastMocks.ok).toHaveBeenCalledWith('STOP commanded (STOP).'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instance().onerror?.({ error: 'aborted' });
    instance().onerror?.({ error: 'no-speech' });
    await waitFor(() => expect(toastMocks.err).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instance().onerror?.({ error: 'not-allowed' });
    await waitFor(() =>
      expect(toastMocks.err).toHaveBeenCalledWith(
        'Microphone error: not-allowed',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instance().onend?.();
    expect(socket.emit).toHaveBeenCalledWith('deadman.release');
  });

  it('extends deadman after timed voice then releases when the hold expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const instances: Rec[] = [];
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: Rec) {
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    }) as unknown as typeof window.SpeechRecognition;
    vi.spyOn(api, 'apiPost').mockResolvedValue({
      ok: true,
      label: 'OWVA up/down',
    });
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instances[0]!.onresult?.({
      results: [
        Object.assign([{ transcript: 'owva up' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() => expect(toastMocks.ok).toHaveBeenCalled());
    socket.emit.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(socket.emit).toHaveBeenCalledWith('deadman.release');
    vi.useRealTimers();
  });

  it('starts listen even when safety posts fail', async () => {
    vi.spyOn(api, 'apiPost').mockImplementation(async (path) => {
      if (path === '/safety/deadman/pulse') throw new Error('no pulse');
      if (path === '/safety/control/claim') throw new Error('no claim');
      return { ok: true };
    });
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: {
      start: () => void;
      stop: () => void;
    }) {
      this.start = vi.fn();
      this.stop = vi.fn();
    }) as unknown as typeof window.SpeechRecognition;
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(socket.emit).toHaveBeenCalledWith('deadman.pulse');
  });

  it('handles empty final transcript and the 8s listen timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const instances: Rec[] = [];
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: Rec) {
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    }) as unknown as typeof window.SpeechRecognition;
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));

    instances[0]!.onresult?.({
      results: [
        Object.assign([{ transcript: '   ' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() =>
      expect(toastMocks.err).toHaveBeenCalledWith('Nothing heard'),
    );

    toastMocks.err.mockClear();
    socket.emit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    await vi.advanceTimersByTimeAsync(8100);
    expect(instances[instances.length - 1]!.stop).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('deadman.release');
    vi.useRealTimers();
  });

  it('ignores a late result after a command was already sent', async () => {
    const instances: Rec[] = [];
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: Rec) {
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    }) as unknown as typeof window.SpeechRecognition;
    vi.spyOn(api, 'apiPost').mockResolvedValue({
      ok: true,
      label: 'Enable',
    });
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instances[0]!.onresult?.({
      results: [
        Object.assign([{ transcript: 'enable' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() => expect(toastMocks.ok).toHaveBeenCalledWith('Enable'));
    instances[0]!.onresult?.({
      results: [
        Object.assign([{ transcript: 'stop' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
  });

  it('toasts a non-Error voice failure', async () => {
    const instances: Rec[] = [];
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: Rec) {
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    }) as unknown as typeof window.SpeechRecognition;
    vi.spyOn(api, 'apiPost').mockImplementation(async (path) => {
      if (path === '/media/voice') return Promise.reject('boom');
      return { ok: true };
    });
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instances[0]!.onresult?.({
      results: [
        Object.assign([{ transcript: 'stop' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() => expect(toastMocks.err).toHaveBeenCalledWith('failed'));
  });

  it('falls back to transcript toast and skips holes in speech results', async () => {
    const instances: Rec[] = [];
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: Rec) {
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    }) as unknown as typeof window.SpeechRecognition;
    vi.spyOn(api, 'apiPost').mockImplementation(async (path) => {
      if (path === '/media/voice') return { ok: true };
      return { ok: true };
    });
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    const results = [] as unknown as ArrayLike<
      { transcript: string } & { isFinal?: boolean }
    > & { length: number };
    Object.assign(results, {
      length: 2,
      0: undefined,
      1: Object.assign([{ transcript: 'stop' }, { transcript: '' }], {
        isFinal: true,
      }),
    });
    instances[0]!.onresult?.({ results });
    await waitFor(() => expect(toastMocks.ok).toHaveBeenCalledWith('stop'));
  });

  it('uses webkit speech and reports missing reason', async () => {
    const instances: Rec[] = [];
    delete window.SpeechRecognition;
    window.webkitSpeechRecognition = vi.fn(function SpeechRecognition(
      this: Rec,
    ) {
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    }) as unknown as typeof window.webkitSpeechRecognition;
    vi.spyOn(api, 'apiPost').mockImplementation(async (path) => {
      if (path === '/media/voice') return { ok: false };
      return { ok: true };
    });
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instances[0]!.onresult?.({
      results: [
        Object.assign([{ transcript: 'xyz' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() =>
      expect(toastMocks.err).toHaveBeenCalledWith('not executed'),
    );
  });

  it('skips deadman release on the 8s timeout after a command was sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const instances: Rec[] = [];
    window.SpeechRecognition = vi.fn(function SpeechRecognition(this: Rec) {
      this.start = vi.fn();
      this.stop = vi.fn();
      instances.push(this);
    }) as unknown as typeof window.SpeechRecognition;
    vi.spyOn(api, 'apiPost').mockResolvedValue({
      ok: true,
      label: 'STOP',
      message: 'STOP commanded (STOP).',
    });
    renderWithProviders(<VoiceListenButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    instances[0]!.onresult?.({
      results: [
        Object.assign([{ transcript: 'stop' }], { isFinal: true }),
      ] as unknown as ArrayLike<{ transcript: string } & { isFinal?: boolean }>,
    });
    await waitFor(() => expect(toastMocks.ok).toHaveBeenCalled());
    socket.emit.mockClear();
    await vi.advanceTimersByTimeAsync(8100);
    expect(instances[0]!.stop).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
