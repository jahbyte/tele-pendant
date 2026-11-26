const FILLERS = new Set([
  'please',
  'go',
  'the',
  'a',
  'to',
  'crane',
  'and',
  'hey',
  'ok',
  'okay',
  'now',
  'do',
]);

/** Spoken negation — refuse the command rather than invert it. */
const NEGATION_WORDS = new Set(['not', 'never', 'dont', 'no']);

/** Allowlisted cell label plus optional selector rocker side. */
export type VoiceMatch = {
  label: string;
  /** Selector: a = primary, b = secondary. */
  direction?: 'a' | 'b';
};

const BACK_WORDS = new Set(['back', 'backward', 'backwards', 'backw']);
const FWD_WORDS = new Set(['forward', 'forwards', 'forw', 'fwd', 'fore']);
const CLOSE_WORDS = new Set(['close', 'closed']);
const OPEN_WORDS = new Set(['open', 'opened']);

function normalize(transcript: string): string[] {
  return (
    transcript
      .toLowerCase()
      // don't / won't → do not / wo not so negation is a real token
      .replace(/n't\b/g, ' not')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 0)
  );
}

function spoken(tokens: string[]): string[] {
  return tokens.filter((token) => !FILLERS.has(token));
}

function hasNegation(tokens: string[]): boolean {
  return tokens.some((token) => NEGATION_WORDS.has(token));
}

function withoutNegation(tokens: string[]): string[] {
  return tokens.filter((token) => !NEGATION_WORDS.has(token));
}

function has(tokens: string[], word: string): boolean {
  return tokens.includes(word);
}

function hasAny(tokens: string[], words: Set<string>): boolean {
  return tokens.some((token) => words.has(token));
}

function includesPhrase(tokens: string[], phrase: string[]): boolean {
  for (let i = 0; i <= tokens.length - phrase.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function directionUpDown(tokens: string[]): 'a' | 'b' | null {
  const up = has(tokens, 'up');
  const down = has(tokens, 'down');
  if (up && !down) return 'a';
  if (down && !up) return 'b';
  return null;
}

/**
 * True when the transcript contains negation and would otherwise map to a
 * command (e.g. "do not open owff"). Used so the API can refuse clearly
 * instead of falling through to a positive speech alternative.
 */
export function isNegatedVoiceCommand(transcript: string): boolean {
  const tokens = normalize(transcript);
  if (tokens.length === 0 || !hasNegation(tokens)) return false;
  return matchTokens(withoutNegation(tokens)) !== null;
}

/**
 * Map a speech transcript to a P03A21 pendant cell label.
 * Bare up/down (and legacy hoist) drive OWVA; trolley aliases drive OWHA.
 * Negated phrases ("do not…", "never…") never match — they are refused.
 */
export function matchVoiceCommand(transcript: string): VoiceMatch | null {
  const tokens = normalize(transcript);
  if (tokens.length === 0) return null;
  if (hasNegation(tokens)) return null;
  return matchTokens(tokens);
}

function matchTokens(tokens: string[]): VoiceMatch | null {
  if (tokens.length === 0) return null;

  if (tokens.some((token) => token === 'stop' || token === 'stopped')) {
    return { label: 'STOP' };
  }

  const words = spoken(tokens);
  if (words.length === 0) return null;

  if (has(words, 'enable')) {
    return { label: 'Enable' };
  }

  if (has(words, 'buttons')) {
    return { label: 'Buttons active' };
  }

  if (has(words, 'pipe')) {
    return { label: 'Teach Pipe Middle Position' };
  }

  if (includesPhrase(words, ['teach', 'welding']) || has(words, 'weld')) {
    return { label: 'OWVA/OWCA Teach Welding Position' };
  }

  if (has(words, 'laser') || includesPhrase(words, ['teach', 'seam'])) {
    return { label: 'Teach Seam Tracking Laser' };
  }

  if (has(words, 'seam')) {
    return { label: 'Seam Tracking on/off' };
  }

  if (has(words, 'home')) {
    return { label: 'OWVA, OWCA, OWCVA Move Home Position' };
  }

  if (has(words, 'height')) {
    return { label: 'OWVA Height Reg. on/off' };
  }

  if (has(words, 'axis')) {
    return { label: 'Axis fast/slowly' };
  }

  if (
    includesPhrase(words, ['move', 'welding']) ||
    includesPhrase(words, ['welding', 'position'])
  ) {
    return { label: 'OWVA, OWCA, OWCVA Move Welding Posit.' };
  }

  // Flux flap aliases — operators say the plant name, not only "owff".
  if (has(words, 'owff') || has(words, 'flux') || has(words, 'flap')) {
    if (hasAny(words, CLOSE_WORDS) && !hasAny(words, OPEN_WORDS)) {
      return { label: 'OWFF Welding Flux Flap close/open', direction: 'a' };
    }
    if (hasAny(words, OPEN_WORDS) && !hasAny(words, CLOSE_WORDS)) {
      return { label: 'OWFF Welding Flux Flap close/open', direction: 'b' };
    }
    return null;
  }

  if (has(words, 'owwac')) {
    const dir = directionUpDown(words);
    return dir ? { label: 'OWWAC Wire Feed AC up/down', direction: dir } : null;
  }

  if (has(words, 'owwdc')) {
    const dir = directionUpDown(words);
    return dir ? { label: 'OWWDC Wire Feed DC up/down', direction: dir } : null;
  }

  if (has(words, 'owcva')) {
    if (has(words, 'down') && !has(words, 'up')) {
      return { label: 'OWCVA down/up', direction: 'a' };
    }
    if (has(words, 'up') && !has(words, 'down')) {
      return { label: 'OWCVA down/up', direction: 'b' };
    }
    return null;
  }

  if (has(words, 'owva') || has(words, 'hoist')) {
    const dir = directionUpDown(words);
    return dir ? { label: 'OWVA up/down', direction: dir } : null;
  }

  if (has(words, 'owha') || has(words, 'trolley') || has(words, 'trolly')) {
    if (has(words, 'left') || hasAny(words, BACK_WORDS)) {
      return { label: 'OWHA backw./forw.', direction: 'a' };
    }
    if (has(words, 'right') || hasAny(words, FWD_WORDS)) {
      return { label: 'OWHA backw./forw.', direction: 'b' };
    }
    return null;
  }

  if (has(words, 'owca')) {
    if (hasAny(words, BACK_WORDS) || has(words, 'left')) {
      return { label: 'OWCA backw./forw.', direction: 'a' };
    }
    if (hasAny(words, FWD_WORDS) || has(words, 'right')) {
      return { label: 'OWCA backw./forw.', direction: 'b' };
    }
    return null;
  }

  const bare = directionUpDown(words);
  if (bare) {
    return { label: 'OWVA up/down', direction: bare };
  }

  return null;
}
