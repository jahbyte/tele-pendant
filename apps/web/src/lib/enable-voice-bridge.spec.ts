import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginVoiceKeepEnable,
  deferEnableRelease,
  endVoiceKeepEnable,
  voiceKeepsEnable,
} from './enable-voice-bridge';

describe('enable-voice-bridge', () => {
  beforeEach(() => {
    endVoiceKeepEnable();
  });

  it('defers Enable release while Listen is active', () => {
    const release = vi.fn();
    beginVoiceKeepEnable();
    expect(voiceKeepsEnable()).toBe(true);
    deferEnableRelease(release);
    expect(release).not.toHaveBeenCalled();
    endVoiceKeepEnable();
    expect(voiceKeepsEnable()).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases immediately when Listen is not active', () => {
    const release = vi.fn();
    deferEnableRelease(release);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
