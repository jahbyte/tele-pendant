/**
 * Split pendant drawing labels so the axis prefix and the action each get a line.
 * Keeps "OWVA, OWCA, OWCVA Move Home Position" readable on a narrow phone cell.
 */
export function pendantLegendLines(label: string): string[] {
  const trimmed = label.trim();
  const match = trimmed.match(
    /^(OWVA(?:\s*,\s*OWCA(?:\s*,\s*OWCVA)?|\/OWCA(?:\/OWCVA)?))\s+(.+)$/i,
  );
  if (match?.[1] && match[2]) {
    return [match[1].replace(/\s*,\s*/g, ', '), match[2]];
  }
  return [trimmed];
}

/** Parse "… close/open" style labels into rocker side captions. */
export function parseSelectorSideLabels(label: string): {
  sideA: string;
  sideB: string;
} {
  const trimmed = label.trim();
  const slash = trimmed.lastIndexOf('/');
  if (slash > 0 && slash < trimmed.length - 1) {
    const before = trimmed.slice(0, slash).trim();
    const sideB = trimmed.slice(slash + 1).trim() || 'B';
    const space = before.lastIndexOf(' ');
    const sideA = (space >= 0 ? before.slice(space + 1) : before).trim() || 'A';
    return { sideA, sideB };
  }
  return { sideA: 'A', sideB: 'B' };
}

/**
 * Hold-to-run cells (release clears coils). Latch selectors keep the last side
 * until the opposite side or an explicit center clear.
 */
export function cellUsesHoldToRun(cell: {
  style: string;
  isMotion: boolean;
}): boolean {
  if (cell.style === 'selector' && !cell.isMotion) return false;
  return (
    cell.isMotion ||
    cell.style === 'enable' ||
    cell.style === 'pushbutton' ||
    cell.style === 'selector'
  );
}

/** STOP stays available without the control lease. */
export function isOperatorStopCell(cell: {
  style?: string;
  label?: string;
  requiresSafeAction?: boolean;
}): boolean {
  return (
    cell.requiresSafeAction === true ||
    cell.style === 'estop' ||
    (cell.label ?? '').trim().toUpperCase() === 'STOP'
  );
}

/**
 * Every operator write requires exclusive control, except STOP and lamps.
 * Motion still also needs deadman; that check stays on the server.
 */
export function cellRequiresControlLease(cell: {
  isMotion: boolean;
  style?: string;
  label?: string;
  requiresSafeAction?: boolean;
}): boolean {
  if (cell.style === 'lamp') return false;
  if (isOperatorStopCell(cell)) return false;
  return true;
}

/** Deadman pulses only while a motion cell is held. Enable must not pulse it. */
export function cellPulsesDeadman(cell: { isMotion: boolean }): boolean {
  return cell.isMotion;
}

/**
 * Short jog taps (under the touch press delay) must still leave the coil ON
 * long enough for the axis to move before activate(false).
 */
export const MIN_JOG_PULSE_MS = 200;

/**
 * Non-motion pushbuttons (Teach, Seam, …) use a command-hold pulse watchdog so a
 * lost activate(false) cannot leave the coil ON. Enable has its own watchdog.
 */
export function cellUsesCommandHoldWatchdog(cell: {
  style: string;
  isMotion: boolean;
}): boolean {
  return !cell.isMotion && cell.style === 'pushbutton';
}
