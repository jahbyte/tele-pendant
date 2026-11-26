import { HmiSeedService } from './hmi-seed.service';

describe('HmiSeedService', () => {
  function makeService(overrides?: {
    cellCount?: number;
    selectorCount?: number;
    activeBg?: { id?: string; name: string; active: boolean } | null;
  }) {
    const cellCount = overrides?.cellCount ?? 0;
    const selectorCount = overrides?.selectorCount ?? 0;
    const activeBg = overrides?.activeBg ?? null;

    const cells = {
      count: jest.fn().mockResolvedValue(cellCount),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(selectorCount),
        delete: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      })),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn((row: unknown) => row),
    };
    const backgrounds = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(activeBg),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn((row: unknown) => row),
      remove: jest.fn(async (row: unknown) => row),
    };
    const registers = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([
        { name: 'holding.hoistHeightMm', trended: true },
        { name: 'holding.loadKg', trended: true },
        { name: 'holding.trolleyPosition', trended: true },
        { name: 'holding.speedPct', trended: false },
        { name: 'discrete.commsOk', trended: false },
        { name: 'discrete.fault', trended: false },
      ]),
      save: jest.fn(async (row: unknown) => ({
        id: 'reg',
        ...(row as object),
      })),
      create: jest.fn((row: unknown) => row),
    };
    const overlays = {
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      })),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn((row: unknown) => row),
    };
    const roles = {
      find: jest.fn().mockResolvedValue([{ id: 'role1' }]),
      save: jest.fn(),
      create: jest.fn((row: unknown) => row),
    };
    const trendSamples = {
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      })),
    };

    const service = new HmiSeedService(
      registers as never,
      cells as never,
      backgrounds as never,
      overlays as never,
      roles as never,
      trendSamples as never,
    );
    return { service, cells, backgrounds, overlays, registers, trendSamples };
  }

  it('seeds when the database has no cells', async () => {
    const { service, cells } = makeService({ cellCount: 0 });
    const seed = jest.spyOn(service, 'seed').mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(seed).toHaveBeenCalled();
    expect(cells.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('removes demo-crane and reseeds when the database is empty after cleanup', async () => {
    const crane = { id: 'crane', name: 'demo-crane', active: true };
    const { service, backgrounds, cells, overlays } = makeService({
      cellCount: 0,
    });
    backgrounds.find.mockResolvedValue([crane]);
    const seed = jest.spyOn(service, 'seed').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(overlays.createQueryBuilder).toHaveBeenCalled();
    expect(cells.createQueryBuilder).toHaveBeenCalled();
    expect(backgrounds.remove).toHaveBeenCalledWith(crane);
    expect(seed).toHaveBeenCalled();
  });

  it('removes demo-crane but keeps an existing P03A21 layout', async () => {
    const crane = { id: 'crane', name: 'demo-crane', active: false };
    const { service, backgrounds } = makeService({
      cellCount: 18,
      activeBg: { name: 'demo-p03a21', active: true },
    });
    backgrounds.find.mockResolvedValue([crane]);
    const seed = jest.spyOn(service, 'seed').mockResolvedValue(undefined);
    const reset = jest
      .spyOn(service, 'resetP03a21Demo')
      .mockResolvedValue({ ok: true, cells: 18 });

    await service.onModuleInit();

    expect(backgrounds.remove).toHaveBeenCalledWith(crane);
    expect(seed).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('skips reset when the active background is already P03A21', async () => {
    const { service, backgrounds } = makeService({
      cellCount: 12,
      selectorCount: 0,
      activeBg: { name: 'demo-p03a21', active: true },
    });
    const reset = jest
      .spyOn(service, 'resetP03a21Demo')
      .mockResolvedValue({ ok: true, cells: 12 });
    await service.onModuleInit();
    expect(backgrounds.remove).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('renames shortened P03A21 labels and leaves custom names', async () => {
    const { service, cells } = makeService({
      cellCount: 12,
      selectorCount: 3,
      activeBg: { name: 'demo-p03a21', active: true },
    });
    const shortened = {
      id: 'a',
      label: 'OWHA back/fwd',
      background: { id: 'bg' },
    };
    const custom = {
      id: 'b',
      label: 'My custom jog',
      background: { id: 'bg' },
    };
    cells.find.mockResolvedValue([shortened, custom]);
    await service.onModuleInit();
    expect(shortened.label).toBe('OWHA backw./forw.');
    expect(custom.label).toBe('My custom jog');
    expect(cells.save).toHaveBeenCalledTimes(1);
    expect(cells.save).toHaveBeenCalledWith(shortened);
  });

  it('adds a plant picture and three live labels when the demo has none', async () => {
    const { service, backgrounds, overlays, registers } = makeService({
      cellCount: 12,
      selectorCount: 3,
      activeBg: { name: 'demo-p03a21', active: true },
    });
    const screen = {
      id: 'bg-p03',
      name: 'demo-p03a21',
      active: true,
      imageUrl: null as string | null,
    };
    backgrounds.findOne.mockResolvedValue(screen);
    overlays.count.mockResolvedValue(0);
    registers.findOne.mockImplementation(
      async (q: { where?: { name?: string } }) => {
        const name = q.where?.name;
        if (!name) return null;
        return { id: `reg-${name}`, name };
      },
    );
    const install = jest
      .spyOn(
        service as unknown as { installDemoPlantAsset: () => string | null },
        'installDemoPlantAsset',
      )
      .mockReturnValue('/hmi-assets/demo-p03a21.svg');

    await service.onModuleInit();

    expect(install).toHaveBeenCalled();
    expect(screen.imageUrl).toBe('/hmi-assets/demo-p03a21.svg');
    expect(backgrounds.save).toHaveBeenCalledWith(screen);
    expect(overlays.save).toHaveBeenCalledTimes(3);
    expect(overlays.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Speed' }),
    );
    expect(overlays.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Comms' }),
    );
    expect(overlays.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Fault' }),
    );
  });

  it('refreshes the plant SVG but leaves custom URL and existing labels alone', async () => {
    const { service, backgrounds, overlays } = makeService({
      cellCount: 12,
      selectorCount: 3,
      activeBg: { name: 'demo-p03a21', active: true },
    });
    backgrounds.findOne.mockResolvedValue({
      id: 'bg-p03',
      name: 'demo-p03a21',
      active: true,
      imageUrl: '/hmi-assets/custom.svg',
    });
    overlays.count.mockResolvedValue(2);
    const install = jest
      .spyOn(
        service as unknown as { installDemoPlantAsset: () => string | null },
        'installDemoPlantAsset',
      )
      .mockReturnValue('/hmi-assets/demo-p03a21.svg');

    await service.onModuleInit();

    // Reinstall overwrites a leftover crane file; custom URL is not forced.
    expect(install).toHaveBeenCalled();
    expect(backgrounds.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: '/hmi-assets/demo-p03a21.svg' }),
    );
    expect(overlays.save).not.toHaveBeenCalled();
  });

  it('installs the P03A21 plant SVG, not the legacy crane drawing', () => {
    const { service } = makeService({
      cellCount: 12,
      activeBg: { name: 'demo-p03a21', active: true },
    });
    const sources = (
      service as unknown as { demoPlantSvgSources: () => string[] }
    ).demoPlantSvgSources();
    expect(sources.every((path) => path.endsWith('demo-p03a21.svg'))).toBe(
      true,
    );
    expect(sources.some((path) => path.includes('demo-crane.svg'))).toBe(false);
  });

  it('resets only demo-p03a21 cells and overlays, not other screens', async () => {
    const demo = { id: 'bg-demo', name: 'demo-p03a21', active: true };
    const other = { id: 'bg-qa', name: 'QA Welder', active: false };
    const { service, backgrounds, cells, overlays } = makeService({
      cellCount: 5,
      activeBg: demo,
    });
    backgrounds.findOne.mockImplementation(
      async (q: { where?: { name?: string; active?: boolean } }) => {
        if (q.where?.name === 'demo-p03a21') return demo;
        if (q.where?.active) return demo;
        return null;
      },
    );
    const overlayWhere = jest.fn().mockReturnThis();
    const overlayExecute = jest.fn().mockResolvedValue(undefined);
    overlays.createQueryBuilder.mockReturnValue({
      delete: jest.fn().mockReturnThis(),
      where: overlayWhere,
      execute: overlayExecute,
    });
    const cellWhere = jest.fn().mockReturnThis();
    const cellExecute = jest.fn().mockResolvedValue(undefined);
    cells.createQueryBuilder.mockReturnValue({
      delete: jest.fn().mockReturnThis(),
      where: cellWhere,
      getCount: jest.fn().mockResolvedValue(0),
      execute: cellExecute,
    });
    cells.count.mockResolvedValue(18);
    const seed = jest.spyOn(service, 'seed').mockResolvedValue(undefined);

    const result = await service.resetP03a21Demo();

    expect(overlayWhere).toHaveBeenCalledWith('background_id = :id', {
      id: 'bg-demo',
    });
    expect(cellWhere).toHaveBeenCalledWith('background_id = :id', {
      id: 'bg-demo',
    });
    expect(overlayWhere).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: other.id }),
    );
    expect(seed).toHaveBeenCalled();
    expect(cells.count).toHaveBeenCalledWith({
      where: { background: { id: 'bg-demo' } },
    });
    expect(result).toEqual({ ok: true, cells: 18 });
  });

  it('reseeds when demo-p03a21 is missing without wiping other screens', async () => {
    const { service, cells, overlays } = makeService({ cellCount: 3 });
    // No demo screen yet — must not run an unscoped delete.
    const seed = jest.spyOn(service, 'seed').mockResolvedValue(undefined);
    cells.count.mockResolvedValue(0);

    const result = await service.resetP03a21Demo();

    expect(overlays.createQueryBuilder).not.toHaveBeenCalled();
    expect(cells.createQueryBuilder).not.toHaveBeenCalled();
    expect(seed).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, cells: 0 });
  });

  it('skips creating a second plant-shared STOP when one already exists', async () => {
    const demo = {
      id: 'bg-demo',
      name: 'demo-p03a21',
      active: true,
      imageUrl: '/hmi-assets/demo-p03a21.svg',
    };
    const { service, backgrounds, cells, registers, overlays } = makeService({
      cellCount: 1,
      activeBg: demo,
    });
    backgrounds.findOne.mockResolvedValue(demo);
    overlays.count.mockResolvedValue(3);
    cells.find.mockResolvedValue([
      {
        id: 'stop-1',
        label: 'STOP',
        style: 'estop',
        requiresSafeAction: true,
        background: null,
      },
    ]);
    registers.findOne.mockImplementation(
      async (q: { where?: { name?: string } }) => {
        const name = q.where?.name ?? (q as { name?: string }).name;
        if (!name) return null;
        return { id: `reg-${name}`, name, kind: 'coil', address: 1 };
      },
    );

    await service.seed();

    const stopCreates = cells.create.mock.calls.filter(
      (args: unknown[]) =>
        typeof args[0] === 'object' &&
        args[0] !== null &&
        (args[0] as { label?: string }).label === 'STOP',
    );
    expect(stopCreates).toHaveLength(0);
  });

  it('replaces crane trend flags with P03A21 Speed/Comms/Fault and purges samples', async () => {
    const { service, registers, trendSamples } = makeService({
      cellCount: 12,
      selectorCount: 3,
      activeBg: { name: 'demo-p03a21', active: true },
    });
    const hoist = { name: 'holding.hoistHeightMm', trended: true };
    const load = { name: 'holding.loadKg', trended: true };
    const trolley = { name: 'holding.trolleyPosition', trended: true };
    const speed = { name: 'holding.speedPct', trended: false };
    const comms = { name: 'discrete.commsOk', trended: false };
    const fault = { name: 'discrete.fault', trended: false };
    registers.find.mockResolvedValue([
      hoist,
      load,
      trolley,
      speed,
      comms,
      fault,
    ]);

    await service.onModuleInit();

    expect(hoist.trended).toBe(false);
    expect(load.trended).toBe(false);
    expect(trolley.trended).toBe(false);
    expect(speed.trended).toBe(true);
    expect(comms.trended).toBe(true);
    expect(fault.trended).toBe(true);
    expect(trendSamples.createQueryBuilder).toHaveBeenCalled();
  });
});
