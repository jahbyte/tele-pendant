import { isNegatedVoiceCommand, matchVoiceCommand } from './voice-match';

describe('matchVoiceCommand', () => {
  it("refuses do not / never / don't instead of running the command", () => {
    expect(matchVoiceCommand('do not open owff')).toBeNull();
    expect(matchVoiceCommand('do not open the flux flap')).toBeNull();
    expect(matchVoiceCommand('never open owff')).toBeNull();
    expect(matchVoiceCommand("don't hoist up")).toBeNull();
    expect(matchVoiceCommand('dont enable')).toBeNull();
    expect(matchVoiceCommand('never enable')).toBeNull();
    expect(matchVoiceCommand('do not stop')).toBeNull();
    expect(matchVoiceCommand('no hoist up')).toBeNull();

    expect(isNegatedVoiceCommand('do not open the flux flap')).toBe(true);
    expect(isNegatedVoiceCommand('never open owff')).toBe(true);
    expect(isNegatedVoiceCommand("don't hoist up")).toBe(true);
    expect(isNegatedVoiceCommand('owff open')).toBe(false);
    expect(isNegatedVoiceCommand('I do not know')).toBe(false);
    // Negation alone / filler-only after strip is not an allowlisted command.
    expect(isNegatedVoiceCommand('never')).toBe(false);
    expect(isNegatedVoiceCommand('not')).toBe(false);
    expect(matchVoiceCommand('please okay now')).toBeNull();
  });

  it('maps stop and enable', () => {
    expect(matchVoiceCommand('stop')).toEqual({ label: 'STOP' });
    expect(matchVoiceCommand('please stop')).toEqual({ label: 'STOP' });
    expect(matchVoiceCommand('emergency stop')).toEqual({ label: 'STOP' });
    expect(matchVoiceCommand('stopped')).toEqual({ label: 'STOP' });
    expect(matchVoiceCommand('up stop')).toEqual({ label: 'STOP' });
    expect(matchVoiceCommand('enable')).toEqual({ label: 'Enable' });
  });

  it('maps P03A21 pushbuttons', () => {
    expect(matchVoiceCommand('buttons active')).toEqual({
      label: 'Buttons active',
    });
    expect(matchVoiceCommand('teach pipe')).toEqual({
      label: 'Teach Pipe Middle Position',
    });
    expect(matchVoiceCommand('teach welding')).toEqual({
      label: 'OWVA/OWCA Teach Welding Position',
    });
    expect(matchVoiceCommand('weld')).toEqual({
      label: 'OWVA/OWCA Teach Welding Position',
    });
    expect(matchVoiceCommand('teach seam')).toEqual({
      label: 'Teach Seam Tracking Laser',
    });
    expect(matchVoiceCommand('laser')).toEqual({
      label: 'Teach Seam Tracking Laser',
    });
    expect(matchVoiceCommand('seam tracking')).toEqual({
      label: 'Seam Tracking on/off',
    });
    expect(matchVoiceCommand('move home')).toEqual({
      label: 'OWVA, OWCA, OWCVA Move Home Position',
    });
    expect(matchVoiceCommand('height reg')).toEqual({
      label: 'OWVA Height Reg. on/off',
    });
    expect(matchVoiceCommand('axis fast')).toEqual({
      label: 'Axis fast/slowly',
    });
    expect(matchVoiceCommand('move welding')).toEqual({
      label: 'OWVA, OWCA, OWCVA Move Welding Posit.',
    });
    expect(matchVoiceCommand('welding position')).toEqual({
      label: 'OWVA, OWCA, OWCVA Move Welding Posit.',
    });
  });

  it('maps selector rockers with direction', () => {
    expect(matchVoiceCommand('owva up')).toEqual({
      label: 'OWVA up/down',
      direction: 'a',
    });
    expect(matchVoiceCommand('owva down')).toEqual({
      label: 'OWVA up/down',
      direction: 'b',
    });
    expect(matchVoiceCommand('up')).toEqual({
      label: 'OWVA up/down',
      direction: 'a',
    });
    expect(matchVoiceCommand('DOWN')).toEqual({
      label: 'OWVA up/down',
      direction: 'b',
    });
    expect(matchVoiceCommand('please hoist up now')).toEqual({
      label: 'OWVA up/down',
      direction: 'a',
    });
    expect(matchVoiceCommand('owcva down')).toEqual({
      label: 'OWCVA down/up',
      direction: 'a',
    });
    expect(matchVoiceCommand('owcva up')).toEqual({
      label: 'OWCVA down/up',
      direction: 'b',
    });
    expect(matchVoiceCommand('owha back')).toEqual({
      label: 'OWHA backw./forw.',
      direction: 'a',
    });
    expect(matchVoiceCommand('owha forward')).toEqual({
      label: 'OWHA backw./forw.',
      direction: 'b',
    });
    expect(matchVoiceCommand('trolley left')).toEqual({
      label: 'OWHA backw./forw.',
      direction: 'a',
    });
    expect(matchVoiceCommand('trolley right')).toEqual({
      label: 'OWHA backw./forw.',
      direction: 'b',
    });
    expect(matchVoiceCommand('trolly left')).toEqual({
      label: 'OWHA backw./forw.',
      direction: 'a',
    });
    expect(matchVoiceCommand('owca back')).toEqual({
      label: 'OWCA backw./forw.',
      direction: 'a',
    });
    expect(matchVoiceCommand('owca forward')).toEqual({
      label: 'OWCA backw./forw.',
      direction: 'b',
    });
    expect(matchVoiceCommand('owca right')).toEqual({
      label: 'OWCA backw./forw.',
      direction: 'b',
    });
    expect(matchVoiceCommand('owca left')).toEqual({
      label: 'OWCA backw./forw.',
      direction: 'a',
    });
    expect(matchVoiceCommand('owff close')).toEqual({
      label: 'OWFF Welding Flux Flap close/open',
      direction: 'a',
    });
    expect(matchVoiceCommand('owff closed')).toEqual({
      label: 'OWFF Welding Flux Flap close/open',
      direction: 'a',
    });
    expect(matchVoiceCommand('owff open')).toEqual({
      label: 'OWFF Welding Flux Flap close/open',
      direction: 'b',
    });
    expect(matchVoiceCommand('open the flux flap')).toEqual({
      label: 'OWFF Welding Flux Flap close/open',
      direction: 'b',
    });
    expect(matchVoiceCommand('close flap')).toEqual({
      label: 'OWFF Welding Flux Flap close/open',
      direction: 'a',
    });
    expect(matchVoiceCommand('owff opened')).toEqual({
      label: 'OWFF Welding Flux Flap close/open',
      direction: 'b',
    });
    expect(matchVoiceCommand('owwac up')).toEqual({
      label: 'OWWAC Wire Feed AC up/down',
      direction: 'a',
    });
    expect(matchVoiceCommand('owwac down')).toEqual({
      label: 'OWWAC Wire Feed AC up/down',
      direction: 'b',
    });
    expect(matchVoiceCommand('owwdc up')).toEqual({
      label: 'OWWDC Wire Feed DC up/down',
      direction: 'a',
    });
    expect(matchVoiceCommand('owwdc down')).toEqual({
      label: 'OWWDC Wire Feed DC up/down',
      direction: 'b',
    });
    expect(matchVoiceCommand('raise up')).toEqual({
      label: 'OWVA up/down',
      direction: 'a',
    });
  });

  it('ignores unknown or incomplete speech', () => {
    expect(matchVoiceCommand('dance party')).toBeNull();
    expect(matchVoiceCommand('   ')).toBeNull();
    expect(matchVoiceCommand('xyzzy')).toBeNull();
    expect(matchVoiceCommand('owva')).toBeNull();
    expect(matchVoiceCommand('hoist')).toBeNull();
    expect(matchVoiceCommand('trolley')).toBeNull();
    expect(matchVoiceCommand('owha')).toBeNull();
    expect(matchVoiceCommand('owca')).toBeNull();
    expect(matchVoiceCommand('owff')).toBeNull();
    expect(matchVoiceCommand('owff close open')).toBeNull();
    expect(matchVoiceCommand('owwac')).toBeNull();
    expect(matchVoiceCommand('owwdc')).toBeNull();
    expect(matchVoiceCommand('owcva')).toBeNull();
    expect(matchVoiceCommand('owcva up down')).toBeNull();
    expect(matchVoiceCommand('up down')).toBeNull();
  });
});
