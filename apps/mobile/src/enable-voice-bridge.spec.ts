import {
  beginVoiceKeepEnable,
  deferEnableRelease,
  endVoiceKeepEnable,
  voiceKeepsEnable,
} from './enable-voice-bridge';

describe('enable-voice-bridge', () => {
  afterEach(() => {
    endVoiceKeepEnable();
  });

  it('defers Enable release while Listen is keeping Enable', () => {
    const release = jest.fn();
    beginVoiceKeepEnable();
    expect(voiceKeepsEnable()).toBe(true);
    deferEnableRelease(release);
    expect(release).not.toHaveBeenCalled();
    endVoiceKeepEnable();
    expect(release).toHaveBeenCalledTimes(1);
    expect(voiceKeepsEnable()).toBe(false);
  });

  it('releases immediately when Listen is idle', () => {
    const release = jest.fn();
    deferEnableRelease(release);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
