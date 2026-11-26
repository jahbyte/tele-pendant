import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { UserRole } from '../../users/enums/user-role.enum';

describe('MediaService', () => {
  const codes = {
    count: jest.fn().mockResolvedValue(1),
    find: jest.fn().mockResolvedValue([{ code: 'TP-OPS' }]),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn((x) => x),
    create: jest.fn((x) => x),
    remove: jest.fn(),
  };
  const p03Cells = [
    {
      id: 'owva',
      label: 'OWVA up/down',
      style: 'selector',
      isMotion: true,
      requiresSafeAction: false,
    },
    {
      id: 'owha',
      label: 'OWHA backw./forw.',
      style: 'selector',
      isMotion: true,
      requiresSafeAction: false,
    },
    {
      id: 'stop',
      label: 'STOP',
      style: 'estop',
      isMotion: false,
      requiresSafeAction: true,
    },
    {
      id: 'enable',
      label: 'Enable',
      style: 'enable',
      isMotion: false,
      requiresSafeAction: false,
    },
    {
      id: 'seam',
      label: 'Seam Tracking on/off',
      style: 'pushbutton',
      isMotion: false,
      requiresSafeAction: false,
    },
    {
      id: 'teach-pipe',
      label: 'Teach Pipe Middle Position',
      style: 'pushbutton',
      isMotion: false,
      requiresSafeAction: false,
    },
    {
      id: 'axis',
      label: 'Axis fast/slowly',
      style: 'pushbutton',
      isMotion: false,
      requiresSafeAction: false,
    },
  ];
  const hmiService = {
    getLayout: jest.fn().mockResolvedValue({ cells: p03Cells }),
    activateCell: jest.fn().mockResolvedValue({ ok: true }),
  };
  const safetyState = {
    pulseDeadman: jest.fn(),
    releaseDeadman: jest.fn(),
    allowTimedMediaMotion: jest.fn().mockResolvedValue(true),
    canIssueMotion: jest.fn().mockReturnValue(true),
    isEnableHeld: jest.fn().mockReturnValue(false),
  };
  const auditService = { write: jest.fn().mockResolvedValue({}) };

  let service: MediaService;
  const prevRtsp = process.env.CAMERA_RTSP_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    codes.count.mockResolvedValue(1);
    hmiService.getLayout.mockResolvedValue({ cells: p03Cells });
    safetyState.allowTimedMediaMotion.mockResolvedValue(true);
    safetyState.canIssueMotion.mockReturnValue(true);
    safetyState.isEnableHeld.mockReturnValue(false);
    service = new MediaService(
      codes as never,
      hmiService as never,
      safetyState as never,
      auditService as never,
    );
  });

  afterEach(() => {
    const timer = (service as unknown as { voicePulse: NodeJS.Timeout | null })
      .voicePulse;
    if (timer) clearInterval(timer);
    jest.useRealTimers();
  });

  afterAll(() => {
    if (prevRtsp === undefined) delete process.env.CAMERA_RTSP_URL;
    else process.env.CAMERA_RTSP_URL = prevRtsp;
  });

  it('seeds QR codes when empty and retargets legacy crane seed', async () => {
    codes.findOne.mockResolvedValue(null);
    await service.onModuleInit();
    expect(codes.save).not.toHaveBeenCalled();

    codes.count.mockResolvedValue(0);
    await service.onModuleInit();
    expect(codes.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'TP-P03A21',
          label: 'P03A21 Operator',
        }),
        expect.objectContaining({ code: 'TP-OPS' }),
      ]),
    );

    codes.count.mockResolvedValue(1);
    codes.save.mockClear();
    codes.remove.mockClear();
    const legacy = {
      code: 'TP-CRANE-DEMO-01',
      label: 'Demo crane bay A',
      routeHint: null as string | null,
      notes: 'old',
    };
    codes.findOne.mockResolvedValueOnce(legacy).mockResolvedValueOnce(null);
    await service.onModuleInit();
    expect(codes.save).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TP-P03A21',
        label: 'P03A21 Operator',
        routeHint: '/operator',
      }),
    );

    codes.save.mockClear();
    codes.findOne
      .mockResolvedValueOnce({ ...legacy, routeHint: '/operator' })
      .mockResolvedValueOnce({ code: 'TP-P03A21' });
    await service.onModuleInit();
    expect(codes.remove).toHaveBeenCalled();
    expect(codes.save).not.toHaveBeenCalled();
  });

  it('creates, updates, and deletes scan codes', async () => {
    codes.findOneBy.mockResolvedValue(null);
    codes.findOne.mockResolvedValue(null);
    const created = await service.saveCode({
      code: 'NEW-1',
      label: 'New bay',
      routeHint: '/operator',
    });
    expect(created.code).toBe('NEW-1');
    expect(codes.save).toHaveBeenCalled();

    codes.findOneBy.mockResolvedValue({ id: 'id-1', code: 'OLD' });
    codes.findOne.mockResolvedValue(null);
    await service.saveCode({
      id: 'id-1',
      code: 'OLD',
      label: 'Updated',
    });
    expect(codes.save).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Updated' }),
    );

    codes.findOneBy.mockResolvedValue(null);
    await expect(
      service.saveCode({ id: 'missing-id', code: 'X', label: 'Y' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    codes.findOneBy.mockResolvedValue({ id: 'id-1', code: 'OLD' });
    codes.findOne.mockResolvedValue({ id: 'other-id', code: 'DUP' });
    await expect(
      service.saveCode({ id: 'id-1', code: 'DUP', label: 'Y' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.saveCode({ code: '', label: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.saveCode({ code: 'X', label: 'Y', routeHint: 'no-slash' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    codes.findOneBy.mockResolvedValue({ id: 'id-1' });
    await service.deleteCode('id-1');
    expect(codes.remove).toHaveBeenCalled();
    codes.findOneBy.mockResolvedValue(null);
    await expect(service.deleteCode('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolves known codes and lists them', async () => {
    codes.findOne.mockResolvedValue({ code: 'TP-P03A21' });
    await expect(service.resolveCode('  TP-P03A21  ')).resolves.toEqual(
      expect.objectContaining({ code: 'TP-P03A21' }),
    );
    codes.findOne.mockResolvedValue(null);
    await expect(service.resolveCode('NOPE')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.listCodes()).toHaveLength(1);
  });

  it('rejects a voice command that has no device id', async () => {
    const result = await service.voiceCommand('stop', {
      role: UserRole.OPERATOR,
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'device_required' }),
    );
    expect(hmiService.activateCell).not.toHaveBeenCalled();
  });

  it('runs STOP before another phrase in the same request', async () => {
    const result = await service.voiceCommand('hoist up', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
      alternatives: ['stop'],
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: true, label: 'STOP', transcript: 'stop' }),
    );
  });

  it('keeps the first motion phrase when a later phrase is also motion', async () => {
    const result = await service.voiceCommand('owva up', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
      alternatives: ['owva down'],
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: true, label: 'OWVA up/down' }),
    );
    expect(hmiService.activateCell).toHaveBeenCalledWith(
      'owva',
      true,
      expect.objectContaining({ direction: 'a' }),
    );
  });

  it('rejects unknown voice commands', async () => {
    const result = await service.voiceCommand('dance party', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
    });
    expect(result.ok).toBe(false);
  });

  it('maps exact and fuzzy voice aliases to P03A21 cells', async () => {
    const exact = await service.voiceCommand('owva up', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
      userEmail: 'op@example.com',
    });
    expect(exact.ok).toBe(true);
    expect(safetyState.pulseDeadman).not.toHaveBeenCalled();
    expect(safetyState.canIssueMotion).toHaveBeenCalledWith('u1', 'device-1');
    expect(hmiService.activateCell).toHaveBeenCalledWith(
      'owva',
      true,
      expect.objectContaining({ direction: 'a' }),
    );

    const fuzzy = await service.voiceCommand('please hoist up now', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    expect(fuzzy.ok).toBe(true);
    expect(fuzzy).toEqual(expect.objectContaining({ label: 'OWVA up/down' }));

    safetyState.canIssueMotion.mockClear();
    const stop = await service.voiceCommand('emergency stop', {
      role: UserRole.SUPERVISOR,
      clientId: 'device-1',
      safeActionPin: '1234',
    });
    expect(stop.ok).toBe(true);
    expect(safetyState.canIssueMotion).not.toHaveBeenCalled();
    expect(safetyState.pulseDeadman).not.toHaveBeenCalled();
  });

  it('uses a later alternative when the top transcript misses', async () => {
    const result = await service.voiceCommand('banana', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
      alternatives: ['completely wrong', 'owva up'],
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        label: 'OWVA up/down',
        transcript: 'owva up',
      }),
    );
  });

  it('rejects a blank transcript', async () => {
    const result = await service.voiceCommand('   ', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'command_not_allowlisted' }),
    );
  });

  it('jogs OWVA then clears the coil without releasing deadman (TP-29)', async () => {
    jest.useFakeTimers();
    const down = await service.voiceCommand('down', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    expect(down).toEqual(
      expect.objectContaining({ ok: true, label: 'OWVA up/down' }),
    );
    expect(hmiService.activateCell).toHaveBeenCalledWith(
      'owva',
      true,
      expect.objectContaining({ direction: 'b' }),
    );
    await jest.advanceTimersByTimeAsync(2800);
    expect(hmiService.activateCell).toHaveBeenCalledWith('owva', false, {});
    expect(safetyState.releaseDeadman).not.toHaveBeenCalled();
    expect(safetyState.pulseDeadman).not.toHaveBeenCalled();
  });

  it('pulses Enable / Seam / Teach / Axis then clears so voice cannot stick ON', async () => {
    jest.useFakeTimers();
    const cases = [
      { phrase: 'enable', id: 'enable', label: 'Enable' },
      { phrase: 'seam tracking on', id: 'seam', label: 'Seam Tracking on/off' },
      {
        phrase: 'teach pipe middle position',
        id: 'teach-pipe',
        label: 'Teach Pipe Middle Position',
      },
      { phrase: 'axis fast', id: 'axis', label: 'Axis fast/slowly' },
    ] as const;

    for (const row of cases) {
      hmiService.activateCell.mockClear();
      const result = await service.voiceCommand(row.phrase, {
        role: UserRole.OPERATOR,
        clientId: 'device-1',
        userId: 'u1',
      });
      expect(result).toEqual(
        expect.objectContaining({ ok: true, label: row.label }),
      );
      expect(hmiService.activateCell).toHaveBeenCalledWith(
        row.id,
        true,
        expect.any(Object),
      );
      await jest.advanceTimersByTimeAsync(2800);
      expect(hmiService.activateCell).toHaveBeenCalledWith(row.id, false, {});
    }
  });

  it('does not pulse Enable off when Listen already holds it', async () => {
    safetyState.isEnableHeld.mockReturnValue(true);
    const result = await service.voiceCommand('enable', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: true, label: 'Enable' }),
    );
    expect(hmiService.activateCell).not.toHaveBeenCalled();
  });

  it('clears a prior voice pushbutton when a new phrase starts', async () => {
    jest.useFakeTimers();
    await service.voiceCommand('seam tracking', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    hmiService.activateCell.mockClear();
    await service.voiceCommand('axis fast', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    expect(hmiService.activateCell).toHaveBeenCalledWith('seam', false, {});
    expect(hmiService.activateCell).toHaveBeenCalledWith(
      'axis',
      true,
      expect.any(Object),
    );
    await jest.advanceTimersByTimeAsync(2800);
    expect(hmiService.activateCell).toHaveBeenCalledWith('axis', false, {});
  });

  it('drops a stale voice pulse coil without stopping the active pulse', () => {
    const priv = service as unknown as {
      endVoicePulse: (id: string) => void;
      voicePulseCellId: string | null;
      voicePulse: NodeJS.Timeout | null;
    };
    priv.voicePulseCellId = 'axis';
    priv.voicePulse = setInterval(() => undefined, 60_000);
    hmiService.activateCell.mockClear();
    priv.endVoicePulse('seam');
    expect(hmiService.activateCell).toHaveBeenCalledWith('seam', false, {});
    expect(priv.voicePulseCellId).toBe('axis');
    expect(priv.voicePulse).not.toBeNull();
    clearInterval(priv.voicePulse);
    priv.voicePulse = null;
    priv.endVoicePulse('axis');
    expect(priv.voicePulseCellId).toBeNull();
    expect(hmiService.activateCell).toHaveBeenCalledWith('axis', false, {});
  });

  it('still clears the jog timer if clearing the coil fails', async () => {
    jest.useFakeTimers();
    hmiService.activateCell.mockImplementation(
      (_id: string, value: boolean) => {
        if (!value) return Promise.reject(new Error('clear failed'));
        return Promise.resolve({ ok: true });
      },
    );
    await service.voiceCommand('owva up', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    await service.voiceCommand('owva up', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    await jest.advanceTimersByTimeAsync(2800);
    expect(safetyState.releaseDeadman).not.toHaveBeenCalled();
  });

  it('refuses timed motion without an active deadman hold (TP-29)', async () => {
    safetyState.canIssueMotion.mockReturnValue(false);
    const blocked = await service.voiceCommand('owva up', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    expect(blocked).toEqual(
      expect.objectContaining({ ok: false, reason: 'deadman_required' }),
    );
    expect(hmiService.activateCell).not.toHaveBeenCalled();
    expect(safetyState.pulseDeadman).not.toHaveBeenCalled();

    const stop = await service.voiceCommand('stop', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    expect(stop.ok).toBe(true);
  });

  it('passes selector direction for OWHA trolley aliases', async () => {
    await service.voiceCommand('trolley left', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    expect(hmiService.activateCell).toHaveBeenCalledWith(
      'owha',
      true,
      expect.objectContaining({ direction: 'a' }),
    );
  });

  it('returns cell_not_found when label missing from layout', async () => {
    hmiService.getLayout.mockResolvedValueOnce({ cells: [], stop: null });
    const result = await service.voiceCommand('stop', {
      role: UserRole.SUPERVISOR,
      clientId: 'device-1',
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'cell_not_found' }),
    );
  });

  it('uses shared layout.stop for voice STOP when cells omit it', async () => {
    hmiService.getLayout.mockResolvedValueOnce({
      cells: p03Cells.filter((c) => c.label !== 'STOP'),
      stop: p03Cells.find((c) => c.label === 'STOP'),
    });
    const result = await service.voiceCommand('stop', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
      userId: 'u1',
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: true, label: 'STOP' }),
    );
    expect(hmiService.activateCell).toHaveBeenCalledWith(
      'stop',
      true,
      expect.any(Object),
    );
  });

  it('refuses timed motion unless Config allows it', async () => {
    safetyState.allowTimedMediaMotion.mockResolvedValueOnce(false);
    const blocked = await service.voiceCommand('owva up', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
    });
    expect(blocked).toEqual(
      expect.objectContaining({ ok: false, reason: 'timed_motion_disabled' }),
    );
    const stop = await service.voiceCommand('stop', {
      role: UserRole.OPERATOR,
      clientId: 'device-1',
    });
    expect(stop.ok).toBe(true);
    expect(stop.message).toBe('STOP commanded (STOP).');
  });

  it('exposes camera config with and without RTSP', () => {
    expect(service.cameraConfig().rtspUrl).toBeNull();
    process.env.CAMERA_RTSP_URL = 'rtsp://cam/1';
    expect(service.cameraConfig().rtspUrl).toBe('rtsp://cam/1');
    expect(service.cameraConfig().deviceCameraEnabled).toBe(true);
  });
});
