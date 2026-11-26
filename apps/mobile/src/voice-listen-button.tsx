import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { Mic } from 'lucide-react-native';
import { apiPost } from './api';
import {
  beginVoiceKeepEnable,
  endVoiceKeepEnable,
} from './enable-voice-bridge';
import { useLocale } from './locale';
import { HelpTip } from './tour';
import { showErrorAlert, showErrorFrom } from './ui';

/** Keep deadman pulsed through a short timed voice jog (matches API VOICE_JOG_MS). */
const VOICE_DEADMAN_HOLD_MS = 2500;
const VOICE_DEADMAN_PULSE_MS = 400;

/**
 * Header mic: stay on Operator, hold Enable, then Listen.
 * Pulses deadman while active so timed P03A21 voice jogs can run.
 */
export function VoiceListenButton({
  token,
  dark,
}: {
  token: string;
  dark: boolean;
}) {
  const { t } = useLocale();
  const [listening, setListening] = useState(false);
  const deadmanPulseRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadmanHoldUntilRef = useRef(0);
  const listenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);

  const releaseDeadman = useCallback(() => {
    void apiPost('/safety/deadman/release', undefined, token).catch(
      () => undefined,
    );
  }, [token]);

  const stopDeadmanHold = useCallback(() => {
    if (deadmanPulseRef.current) {
      clearInterval(deadmanPulseRef.current);
    }
    deadmanPulseRef.current = null;
    deadmanHoldUntilRef.current = 0;
    releaseDeadman();
  }, [releaseDeadman]);

  const startDeadmanHold = useCallback(
    (durationMs?: number) => {
      void apiPost('/safety/control/claim', undefined, token).catch(
        () => undefined,
      );
      void apiPost('/safety/deadman/pulse', undefined, token).catch(
        () => undefined,
      );
      if (durationMs != null) {
        deadmanHoldUntilRef.current = Date.now() + durationMs;
      } else {
        deadmanHoldUntilRef.current = 0;
      }
      if (deadmanPulseRef.current) return;
      deadmanPulseRef.current = setInterval(() => {
        if (
          deadmanHoldUntilRef.current > 0 &&
          Date.now() >= deadmanHoldUntilRef.current
        ) {
          stopDeadmanHold();
          return;
        }
        void apiPost('/safety/deadman/pulse', undefined, token).catch(
          () => undefined,
        );
      }, VOICE_DEADMAN_PULSE_MS);
    },
    [stopDeadmanHold, token],
  );

  const finishListen = useCallback(() => {
    if (listenTimeoutRef.current) {
      clearTimeout(listenTimeoutRef.current);
      listenTimeoutRef.current = null;
    }
    busyRef.current = false;
    setListening(false);
    endVoiceKeepEnable();
  }, []);

  useEffect(() => {
    return () => {
      if (deadmanPulseRef.current) clearInterval(deadmanPulseRef.current);
      if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current);
      endVoiceKeepEnable();
    };
  }, []);

  async function runVoice(transcript: string): Promise<void> {
    try {
      const res = await apiPost<{
        ok: boolean;
        label?: string;
        message?: string;
        reason?: string;
      }>('/media/voice', { transcript }, token);
      if (res.ok) {
        const motion = /up\/down|down\/up|backw|wire feed|flux flap/i.test(
          res.label ?? '',
        );
        if (motion) startDeadmanHold(VOICE_DEADMAN_HOLD_MS);
        else stopDeadmanHold();
        return;
      }
      stopDeadmanHold();
      showErrorAlert(res.reason ?? 'not executed', 'Voice command');
    } catch (err) {
      stopDeadmanHold();
      showErrorFrom(err, 'Voice command failed', 'Listen');
    }
  }

  async function startVoice() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const speech = (await import('expo-speech-recognition')) as {
        ExpoSpeechRecognitionModule: {
          requestPermissionsAsync: () => Promise<{ granted: boolean }>;
          start: (options: { lang: string; interimResults: boolean }) => void;
          stop: () => void;
          addListener: (
            event: 'result',
            listener: (event: {
              results?: Array<{ transcript?: string }>;
            }) => void,
          ) => { remove: () => void };
        };
      };
      const recognition = speech.ExpoSpeechRecognitionModule;
      const permission = await recognition.requestPermissionsAsync();
      if (!permission.granted) {
        stopDeadmanHold();
        finishListen();
        showErrorAlert('Microphone permission denied.', 'Listen');
        return;
      }
      let sent = false;
      startDeadmanHold();
      setListening(true);
      const sub = recognition.addListener('result', (event) => {
        if (sent) return;
        sent = true;
        const transcript = event.results?.[0]?.transcript?.trim() ?? '';
        sub.remove();
        recognition.stop();
        if (transcript) {
          void runVoice(transcript).finally(() => {
            finishListen();
          });
        } else {
          stopDeadmanHold();
          finishListen();
          showErrorAlert(t('nothingHeard'), 'Listen');
        }
      });
      recognition.start({ lang: 'en-US', interimResults: false });
      listenTimeoutRef.current = setTimeout(() => {
        if (sent) return;
        sent = true;
        sub.remove();
        recognition.stop();
        stopDeadmanHold();
        finishListen();
        showErrorAlert(t('nothingHeard'), 'Listen');
      }, 8000);
    } catch {
      stopDeadmanHold();
      finishListen();
      showErrorAlert(
        'Listen needs a local debug build (npx expo run:android).',
        'Listen',
      );
    }
  }

  const icon = dark ? '#E8EEF4' : '#0F1419';
  const active = listening ? '#3D9CFD' : icon;

  return (
    <HelpTip id="tour.header.voice">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Listening…' : t('listen')}
        className="h-9 w-9 items-center justify-center"
        onPressIn={() => {
          beginVoiceKeepEnable();
          void startVoice();
        }}
      >
        <Mic size={18} color={active} />
      </Pressable>
    </HelpTip>
  );
}
