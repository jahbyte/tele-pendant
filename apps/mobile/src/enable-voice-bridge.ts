/**
 * Lets Operator keep Enable asserted while the header mic runs Listen.
 * One finger can lift from Enable onto the mic; without this, pressOut drops Enable.
 */

let keepEnable = false;
let deferredRelease: (() => void) | null = null;

export function voiceKeepsEnable(): boolean {
  return keepEnable;
}

export function beginVoiceKeepEnable(): void {
  keepEnable = true;
  deferredRelease = null;
}

/** Queue Enable release until Listen ends, or release immediately if idle. */
export function deferEnableRelease(release: () => void): void {
  if (keepEnable) {
    deferredRelease = release;
    return;
  }
  release();
}

export function endVoiceKeepEnable(): void {
  keepEnable = false;
  const release = deferredRelease;
  deferredRelease = null;
  release?.();
}
