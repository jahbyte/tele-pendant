import { useCallback, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { apiPost } from '@/lib/api';
import { HelpTip } from '@/lib/tour';
import { getRealtimeSocket } from '@/lib/realtime';
import { useT } from '@/lib/i18n';
import { toastErr, toastOk } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  beginVoiceKeepEnable,
  endVoiceKeepEnable,
} from '@/lib/enable-voice-bridge';

/** Keep deadman pulsed through a short timed voice jog (matches API VOICE_JOG_MS). */
const VOICE_DEADMAN_HOLD_MS = 2500;
const VOICE_DEADMAN_PULSE_MS = 400;

type SpeechAlt = { transcript: string };
type SpeechResult = ArrayLike<SpeechAlt> & { isFinal?: boolean };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

/**
 * Header mic: stay on Operator, hold Enable, then Listen.
 * Pulses deadman while active so timed P03A21 voice jogs can run.
 */
export function VoiceListenButton() {
  const { t } = useT();
  const [listening, setListening] = useState(false);
  const deadmanPulseRef = useRef<number | null>(null);
  const deadmanHoldUntilRef = useRef(0);

  const pulseDeadman = useCallback(() => {
    void Promise.resolve(apiPost('/safety/control/claim')).catch(
      () => undefined,
    );
    getRealtimeSocket().emit('deadman.pulse');
    void Promise.resolve(apiPost('/safety/deadman/pulse')).catch(
      () => undefined,
    );
  }, []);

  const releaseDeadman = useCallback(() => {
    getRealtimeSocket().emit('deadman.release');
    void apiPost('/safety/deadman/release').catch(() => undefined);
  }, []);

  const stopDeadmanHold = useCallback(() => {
    window.clearInterval(deadmanPulseRef.current ?? undefined);
    deadmanPulseRef.current = null;
    deadmanHoldUntilRef.current = 0;
    releaseDeadman();
  }, [releaseDeadman]);

  const startDeadmanHold = useCallback(
    (durationMs?: number) => {
      pulseDeadman();
      if (durationMs != null) {
        deadmanHoldUntilRef.current = Date.now() + durationMs;
      } else {
        deadmanHoldUntilRef.current = 0;
      }
      if (deadmanPulseRef.current != null) return;
      deadmanPulseRef.current = window.setInterval(() => {
        if (
          deadmanHoldUntilRef.current > 0 &&
          Date.now() >= deadmanHoldUntilRef.current
        ) {
          stopDeadmanHold();
          return;
        }
        pulseDeadman();
      }, VOICE_DEADMAN_PULSE_MS);
    },
    [pulseDeadman, stopDeadmanHold],
  );

  async function runVoice(
    transcript: string,
    alternatives: string[] = [],
  ): Promise<boolean> {
    try {
      const res = await apiPost<{
        ok: boolean;
        label?: string;
        message?: string;
        reason?: string;
      }>('/media/voice', { transcript, alternatives });
      if (res.ok) {
        const motion = /up\/down|down\/up|backw|wire feed|flux flap/i.test(
          res.label ?? '',
        );
        if (motion) startDeadmanHold(VOICE_DEADMAN_HOLD_MS);
        else stopDeadmanHold();
        toastOk(res.message ?? res.label ?? transcript);
        return true;
      }
      stopDeadmanHold();
      toastErr(res.reason ?? 'not executed');
      return false;
    } catch (err) {
      stopDeadmanHold();
      toastErr(err instanceof Error ? err.message : 'failed');
      return false;
    }
  }

  function startVoice() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      endVoiceKeepEnable();
      toastErr('SpeechRecognition not supported in this browser');
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognition.lang = 'en-US';
    let sent = false;
    let listenTimer: number | null = null;
    const clearListenTimer = () => {
      if (listenTimer == null) return;
      window.clearTimeout(listenTimer);
      listenTimer = null;
    };
    const done = () => {
      clearListenTimer();
      endVoiceKeepEnable();
      setListening(false);
    };
    startDeadmanHold();
    recognition.onresult = (event) => {
      const phrases: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const alts = event.results[i];
        if (!alts) continue;
        for (let j = 0; j < alts.length; j++) {
          const text = alts[j]?.transcript?.trim();
          if (text) phrases.push(text);
        }
      }
      const heard = phrases[phrases.length - 1] ?? '';
      const last = event.results[event.results.length - 1];
      if (sent) return;
      if (last?.isFinal === false) return;
      if (!heard) {
        sent = true;
        recognition.stop();
        stopDeadmanHold();
        done();
        toastErr(t('nothingHeard'));
        return;
      }
      sent = true;
      void runVoice(heard, phrases).finally(() => {
        recognition.stop();
        done();
      });
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      sent = true;
      stopDeadmanHold();
      done();
      toastErr(
        event.error === 'no-speech'
          ? t('nothingHeard')
          : `Microphone error: ${event.error}`,
      );
    };
    recognition.onend = () => {
      if (!sent) {
        sent = true;
        stopDeadmanHold();
        done();
        toastErr(t('nothingHeard'));
        return;
      }
      clearListenTimer();
      setListening(false);
    };
    setListening(true);
    recognition.start();
    listenTimer = window.setTimeout(() => {
      listenTimer = null;
      recognition.stop();
      if (sent) return;
      sent = true;
      stopDeadmanHold();
      done();
      toastErr(t('nothingHeard'));
    }, 8000);
  }

  return (
    <HelpTip id="tour.header.voice">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('shrink-0', listening && 'text-primary')}
        aria-label={listening ? 'Listening…' : 'Listen'}
        title={
          listening
            ? 'Listening…'
            : 'Listen — hold Enable on Operator, then speak'
        }
        loading={listening}
        // pointerdown so Listen starts before Enable sees mouseup (one pointer).
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          beginVoiceKeepEnable();
          startVoice();
        }}
      >
        <Mic className="size-4" />
      </Button>
    </HelpTip>
  );
}
