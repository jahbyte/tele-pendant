import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { IsNull } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DEMO_CRANE_MAP,
  DEMO_P03A21_MAP,
  pendantDiName,
  pendantDoName,
} from '@tele-pendant/modbus-core';
import { Repository } from 'typeorm';
import { BackgroundDisplay } from '../../backgrounds/entities/background-display.entity';
import { Cell } from '../../cells/entities/cell.entity';
import { hmiAssetPublicPath, hmiAssetsDirectory } from '../hmi-assets';
import { OverlayLabel } from '../../overlays/entities/overlay-label.entity';
import { RegisterMap } from '../../registers/entities/register-map.entity';
import { SafetyRoles } from '../../safety/entities/safety-roles.entity';
import { TrendSample } from '../../trends/entities/trend-sample.entity';

/** Crane demo series — cleared so Ops Trends never shows hoist/load/trolley. */
const LEGACY_CRANE_TREND_KEYS = [
  'holding.hoistHeightMm',
  'holding.loadKg',
  'holding.trolleyPosition',
] as const;

/** P03A21 plant-label series (Speed / Comms / Fault overlays). */
const P03A21_SAMPLE_TREND_KEYS = [
  'holding.speedPct',
  'discrete.commsOk',
  'discrete.fault',
] as const;

/** Seeded plant drawing file name under /hmi-assets. */
const DEMO_PLANT_ASSET = 'demo-p03a21.svg';

/** Live labels that Operator will draw (not cluster-metric names). */
const DEMO_LIVE_LABELS: Array<{
  label: string;
  registerName: string;
  xPct: number;
  yPct: number;
  format: string;
}> = [
  {
    label: 'Speed',
    registerName: 'holding.speedPct',
    xPct: 18,
    yPct: 18,
    format: '{value}',
  },
  {
    label: 'Comms',
    registerName: 'discrete.commsOk',
    xPct: 52,
    yPct: 18,
    format: '{value}',
  },
  {
    label: 'Fault',
    registerName: 'discrete.fault',
    xPct: 82,
    yPct: 18,
    format: '{value}',
  },
];

const DEMO_NODE_IDS: Record<string, string> = {
  'coil.deadman': 'ns=1;s=Deadman',
  'coil.eStop': 'ns=1;s=EStop',
  'holding.heartbeat': 'ns=1;s=Heartbeat',
  'holding.safeState': 'ns=1;s=SafeState',
};

/** Short Operator names written by earlier seeds → P03A21 drawing words. */
const P03A21_DRAWING_LABELS: Record<string, string> = {
  'Teach Pipe Middle': 'Teach Pipe Middle Position',
  'Teach Welding Pos.': 'OWVA/OWCA Teach Welding Position',
  'Teach Seam Laser': 'Teach Seam Tracking Laser',
  'OWFF close/open': 'OWFF Welding Flux Flap close/open',
  'OWFF Flux Flap close/open': 'OWFF Welding Flux Flap close/open',
  'Seam Tracking': 'Seam Tracking on/off',
  'Move Home': 'OWVA, OWCA, OWCVA Move Home Position',
  'Move Home Position': 'OWVA, OWCA, OWCVA Move Home Position',
  'OWHA back/fwd': 'OWHA backw./forw.',
  'Height Reg.': 'OWVA Height Reg. on/off',
  'Axis fast/slow': 'Axis fast/slowly',
  'Move Welding Pos.': 'OWVA, OWCA, OWCVA Move Welding Posit.',
  'Move Welding Position': 'OWVA, OWCA, OWCVA Move Welding Posit.',
  'OWWAC up/down': 'OWWAC Wire Feed AC up/down',
  'OWWDC up/down': 'OWWDC Wire Feed DC up/down',
  'OWCA back/fwd': 'OWCA backw./forw.',
};

@Injectable()
export class HmiSeedService implements OnModuleInit {
  private readonly logger = new Logger(HmiSeedService.name);

  constructor(
    @InjectRepository(RegisterMap)
    private readonly registers: Repository<RegisterMap>,
    @InjectRepository(Cell)
    private readonly cells: Repository<Cell>,
    @InjectRepository(BackgroundDisplay)
    private readonly backgrounds: Repository<BackgroundDisplay>,
    @InjectRepository(OverlayLabel)
    private readonly overlays: Repository<OverlayLabel>,
    @InjectRepository(SafetyRoles)
    private readonly roles: Repository<SafetyRoles>,
    @InjectRepository(TrendSample)
    private readonly trendSamples: Repository<TrendSample>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Drop the old crane screen before the empty-DB seed check so a crane-only
    // database reseeds as demo-p03a21 and never shows demo-crane in Operator.
    await this.removeLegacyDemoCrane();
    const count = await this.cells.count();
    if (count === 0) {
      this.logger.log('Seeding P03A21 welding pendant HMI layout');
      await this.seed();
    }
    await this.syncP03a21DrawingLabels();
    await this.syncP03a21LakshmiFixes();
    await this.ensureRuntimeRegisters();
    await this.ensureSafetyRoles();
    await this.ensureSampleTrends();
    await this.ensureSharedStopIsGlobal();
    await this.attachOrphanCells();
    await this.ensureDemoPlantExample();
  }

  /**
   * STOP is plant-shared (background null). Detach any STOP still owned by a
   * screen so deleting that screen cannot wipe the dock / voice stop.
   */
  private async ensureSharedStopIsGlobal(): Promise<void> {
    const rows = await this.cells.find({
      relations: { primaryRegister: true, background: true },
    });
    const owned = rows.filter(
      (cell) =>
        cell.background &&
        (cell.style === 'estop' ||
          cell.label.trim().toUpperCase() === 'STOP' ||
          cell.primaryRegister?.name === 'coil.eStop'),
    );
    if (owned.length === 0) return;
    for (const cell of owned) {
      cell.background = null;
    }
    await this.cells.save(owned);
    this.logger.log(
      `Detached ${owned.length} shared STOP cell(s) from plant screens`,
    );
  }

  /**
   * Legacy crane demo screen — delete it and its buttons/labels so it never
   * appears in the Operator screen list after boot.
   */
  private async removeLegacyDemoCrane(): Promise<void> {
    const rows = await this.backgrounds.find({ where: { name: 'demo-crane' } });
    if (rows.length === 0) return;
    for (const bg of rows) {
      await this.overlays
        .createQueryBuilder()
        .delete()
        .where('background_id = :id', { id: bg.id })
        .execute();
      await this.cells
        .createQueryBuilder()
        .delete()
        .where('background_id = :id', { id: bg.id })
        .execute();
      await this.backgrounds.remove(bg);
    }
    this.logger.log(`Removed legacy demo-crane screen(s) (${rows.length})`);
  }

  /** Paths that may hold docs/samples/hmi/demo-crane.svg in Docker or local cwd. */
  private demoPlantSvgSources(): string[] {
    const cwd = process.cwd();
    return [
      join(cwd, 'docs', 'samples', 'hmi', 'demo-crane.svg'),
      join(cwd, '..', '..', 'docs', 'samples', 'hmi', 'demo-crane.svg'),
      join(
        cwd,
        'apps',
        'api',
        '..',
        '..',
        'docs',
        'samples',
        'hmi',
        'demo-crane.svg',
      ),
    ];
  }

  /** Copy the sample plant drawing into the HMI asset folder. */
  private installDemoPlantAsset(): string | null {
    const source = this.demoPlantSvgSources().find((path) => existsSync(path));
    if (!source) {
      this.logger.warn(
        'Demo plant SVG missing under docs/samples/hmi; screen stays without a picture',
      );
      return null;
    }
    const dest = join(hmiAssetsDirectory(), DEMO_PLANT_ASSET);
    if (!existsSync(dest)) {
      copyFileSync(source, dest);
    }
    return hmiAssetPublicPath(DEMO_PLANT_ASSET);
  }

  /**
   * Fresh demo: plant drawing plus three live labels on demo-p03a21.
   * Only fills a screen that still has no picture and no labels.
   */
  private async ensureDemoPlantExample(
    screen?: BackgroundDisplay | null,
  ): Promise<void> {
    const target =
      screen ??
      (await this.backgrounds.findOne({ where: { name: 'demo-p03a21' } }));
    if (!target || target.name !== 'demo-p03a21') return;

    if (!target.imageUrl?.trim()) {
      const imageUrl = this.installDemoPlantAsset();
      if (imageUrl) {
        target.imageUrl = imageUrl;
        await this.backgrounds.save(target);
        this.logger.log(`Demo plant picture set on ${target.name}`);
      }
    }

    const existing = await this.overlays.count({
      where: { background: { id: target.id } },
    });
    if (existing > 0) return;

    for (const def of DEMO_LIVE_LABELS) {
      const register = await this.registers.findOne({
        where: { name: def.registerName },
      });
      if (!register) continue;
      await this.overlays.save(
        this.overlays.create({
          label: def.label,
          xPct: def.xPct,
          yPct: def.yPct,
          format: def.format,
          background: target,
          register,
        }),
      );
    }
    this.logger.log(`Demo live labels seeded on ${target.name}`);
  }

  /** Buttons saved with no screen belong on the admin default screen. */
  private async attachOrphanCells(): Promise<void> {
    const active = await this.backgrounds.findOne({ where: { active: true } });
    if (!active) return;
    const orphans = (
      await this.cells.find({
        where: { background: IsNull() },
        relations: { primaryRegister: true },
      })
    ).filter(
      (cell) =>
        !cell.background &&
        cell.style !== 'estop' &&
        cell.label.trim().toUpperCase() !== 'STOP' &&
        cell.primaryRegister?.name !== 'coil.eStop',
    );
    if (orphans.length === 0) return;
    for (const cell of orphans) {
      cell.background = active;
    }
    await this.cells.save(orphans);
    this.logger.log(
      `Attached ${orphans.length} button(s) with no screen to ${active.name}`,
    );
  }

  /** Rename shortened demo labels in place. Custom names are left alone. */
  private async syncP03a21DrawingLabels(): Promise<void> {
    const rows = await this.cells.find();
    for (const cell of rows) {
      const next = P03A21_DRAWING_LABELS[cell.label];
      if (!next) continue;
      cell.label = next;
      await this.cells.save(cell);
    }
  }

  /**
   * Live-demo patches: Buttons active = lamp, Teach Pipe own DO,
   * Move Home / Move Welding require Enable (isMotion).
   */
  private async syncP03a21LakshmiFixes(): Promise<void> {
    const buttonsLamp = await this.upsertRegister(
      pendantDoName('buttonsActive'),
      DEMO_P03A21_MAP.do.buttonsActive,
      'coil',
      'bool',
      'rw',
    );
    const teachPipeLamp = await this.upsertRegister(
      pendantDoName('teachPipeMiddle'),
      DEMO_P03A21_MAP.do.teachPipeMiddle,
      'coil',
      'bool',
      'rw',
    );

    const rows = await this.cells.find({
      relations: {
        primaryRegister: true,
        feedbackRegister: true,
      },
    });
    for (const cell of rows) {
      const label = cell.label.trim();
      if (label === 'Buttons active') {
        let dirty = false;
        if (cell.style !== 'lamp') {
          cell.style = 'lamp';
          dirty = true;
        }
        if (cell.primaryRegister?.id !== buttonsLamp.id) {
          cell.primaryRegister = buttonsLamp;
          dirty = true;
        }
        if (cell.feedbackRegister) {
          cell.feedbackRegister = null;
          dirty = true;
        }
        if (cell.isMotion) {
          cell.isMotion = false;
          dirty = true;
        }
        if (dirty) await this.cells.save(cell);
        continue;
      }
      if (label === 'Teach Pipe Middle Position') {
        if (cell.feedbackRegister?.id !== teachPipeLamp.id) {
          cell.feedbackRegister = teachPipeLamp;
          await this.cells.save(cell);
        }
        continue;
      }
      if (
        label === 'OWVA, OWCA, OWCVA Move Home Position' ||
        label === 'OWVA, OWCA, OWCVA Move Welding Posit.'
      ) {
        if (!cell.isMotion) {
          cell.isMotion = true;
          cell.variableSpeed = false;
          await this.cells.save(cell);
        }
      }
    }
  }

  /** Safety + crane leftovers the poller still resolves by name. */
  private async ensureRuntimeRegisters(): Promise<void> {
    const extras: Array<[string, number, RegisterMap['kind'], string, string]> =
      [
        ['coil.deadman', DEMO_CRANE_MAP.coils.deadman, 'coil', 'bool', 'rw'],
        ['coil.eStop', DEMO_CRANE_MAP.coils.eStop, 'coil', 'bool', 'rw'],
        [
          'holding.heartbeat',
          DEMO_CRANE_MAP.holdings.heartbeat,
          'holding',
          'uint16',
          'rw',
        ],
        [
          'holding.safeState',
          DEMO_CRANE_MAP.holdings.safeState,
          'holding',
          'uint16',
          'rw',
        ],
        [
          'holding.speedPct',
          DEMO_CRANE_MAP.holdings.speedPct,
          'holding',
          'uint16',
          'r',
        ],
        [
          'holding.hoistHeightMm',
          DEMO_CRANE_MAP.holdings.hoistHeightMm,
          'holding',
          'uint16',
          'r',
        ],
        [
          'holding.loadKg',
          DEMO_CRANE_MAP.holdings.loadKg,
          'holding',
          'uint16',
          'r',
        ],
        [
          'holding.trolleyPosition',
          DEMO_CRANE_MAP.holdings.trolleyPosition,
          'holding',
          'uint16',
          'r',
        ],
        [
          'discrete.fault',
          DEMO_CRANE_MAP.discretes.fault,
          'discrete',
          'bool',
          'r',
        ],
        [
          'discrete.commsOk',
          DEMO_CRANE_MAP.discretes.commsOk,
          'discrete',
          'bool',
          'r',
        ],
        [
          'discrete.motorRunning',
          DEMO_CRANE_MAP.discretes.motorRunning,
          'discrete',
          'bool',
          'r',
        ],
      ];
    for (const [name, address, kind, dataType, rw] of extras) {
      await this.upsertRegister(name, address, kind, dataType, rw);
    }
  }

  private async upsertRegister(
    name: string,
    address: number,
    kind: RegisterMap['kind'],
    dataType: string,
    rw: string,
  ): Promise<RegisterMap> {
    let row = await this.registers.findOne({ where: { name } });
    const nodeId = DEMO_NODE_IDS[name] ?? null;
    if (!row) {
      try {
        row = await this.registers.save(
          this.registers.create({
            name,
            address,
            kind,
            dataType,
            rw,
            scale: 1,
            trended: false,
            nodeId,
          }),
        );
        return row;
      } catch {
        // Parallel seed races can hit UNIQUE(name); re-read the winner.
        row = await this.registers.findOne({ where: { name } });
        if (!row) throw new Error(`Failed to upsert register ${name}`);
      }
    }
    if (nodeId && !row.nodeId) {
      row.nodeId = nodeId;
      row = await this.registers.save(row);
    }
    return row;
  }

  /**
   * Ops Trends for the welding pendant: Speed / Comms / Fault.
   * Clears leftover crane hoist/load/trolley trend flags and samples.
   */
  private async ensureSampleTrends(): Promise<void> {
    const rows = await this.registers.find();
    const legacy = new Set<string>(LEGACY_CRANE_TREND_KEYS);
    const next = new Set<string>(P03A21_SAMPLE_TREND_KEYS);
    for (const row of rows) {
      if (legacy.has(row.name) && row.trended) {
        row.trended = false;
        await this.registers.save(row);
        continue;
      }
      if (next.has(row.name) && !row.trended) {
        row.trended = true;
        await this.registers.save(row);
      }
    }
    await this.trendSamples
      .createQueryBuilder()
      .delete()
      .where('series_key IN (:...keys)', {
        keys: [...LEGACY_CRANE_TREND_KEYS],
      })
      .execute();
  }

  private async ensureSafetyRoles(): Promise<void> {
    const [existing] = await this.roles.find({ take: 1 });
    if (existing) return;
    const idOf = async (name: string) =>
      (await this.registers.findOne({ where: { name } }))?.id ?? null;
    await this.roles.save(
      this.roles.create({
        eStopRegisterId: await idOf('coil.eStop'),
        deadmanRegisterId: await idOf('coil.deadman'),
        heartbeatRegisterId: await idOf('holding.heartbeat'),
        safeStateRegisterId: await idOf('holding.safeState'),
      }),
    );
  }

  /**
   * Admin reset: wipe cells/overlays on demo-p03a21 only, then reseed that
   * screen (keeps registers and every other Operator screen intact).
   */
  async resetP03a21Demo(): Promise<{ ok: true; cells: number }> {
    const screen = await this.backgrounds.findOne({
      where: { name: 'demo-p03a21' },
    });
    if (screen) {
      await this.overlays
        .createQueryBuilder()
        .delete()
        .where('background_id = :id', { id: screen.id })
        .execute();
      await this.cells
        .createQueryBuilder()
        .delete()
        .where('background_id = :id', { id: screen.id })
        .execute();
    }
    await this.seed();
    const demo = await this.backgrounds.findOne({
      where: { name: 'demo-p03a21' },
    });
    const cells = demo
      ? await this.cells.count({ where: { background: { id: demo.id } } })
      : 0;
    this.logger.log(`P03A21 demo reset complete (${cells} cells)`);
    return { ok: true, cells };
  }

  async seed(): Promise<void> {
    await this.ensureRuntimeRegisters();

    const di = async (key: keyof typeof DEMO_P03A21_MAP.di) =>
      this.upsertRegister(
        pendantDiName(key),
        DEMO_P03A21_MAP.di[key],
        'coil',
        'bool',
        'rw',
      );
    const lamp = async (key: keyof typeof DEMO_P03A21_MAP.do) =>
      this.upsertRegister(
        pendantDoName(key),
        DEMO_P03A21_MAP.do[key],
        'coil',
        'bool',
        'rw',
      );

    const eStop = await this.upsertRegister(
      'coil.eStop',
      DEMO_P03A21_MAP.safety.eStop,
      'coil',
      'bool',
      'rw',
    );

    const [
      buttonsActiveDi,
      teachPipeDi,
      teachWeldDi,
      teachSeamDi,
      seamTrackDi,
      moveHomeDi,
      heightRegDi,
      axisFastDi,
      moveWeldDi,
      enableDi,
      owcvaDown,
      owcvaUp,
      owvaUp,
      owvaDown,
      owhaBack,
      owhaFwd,
      owcaBack,
      owcaFwd,
      owwacUp,
      owwacDown,
      owwdcUp,
      owwdcDown,
      owffClose,
      owffOpen,
    ] = await Promise.all([
      di('buttonsActive'), // kept for map parity; HMI cell uses DO lamp
      di('teachPipeMiddle'),
      di('teachWeldingPosition'),
      di('teachSeamTrackingLaser'),
      di('seamTrackingOnOff'),
      di('moveHomePosition'),
      di('owvaHeightReg'),
      di('axisFastSlowly'),
      di('moveWeldingPosition'),
      di('enable'),
      di('owcvaDown'),
      di('owcvaUp'),
      di('owvaUp'),
      di('owvaDown'),
      di('owhaBack'),
      di('owhaFwd'),
      di('owcaBack'),
      di('owcaFwd'),
      di('owwacUp'),
      di('owwacDown'),
      di('owwdcUp'),
      di('owwdcDown'),
      di('owffClose'),
      di('owffOpen'),
    ]);
    void buttonsActiveDi;

    const [
      buttonsActiveLamp,
      teachSeamLamp,
      teachWeldLamp,
      seamTrackLamp,
      moveHomeLamp,
      heightRegLamp,
      axisFastLamp,
      moveWeldLamp,
      owcvaLamp,
      owvaLamp,
      owhaLamp,
      owcaLamp,
      owwacLamp,
      owwdcLamp,
      owffLamp,
    ] = await Promise.all([
      lamp('buttonsActive'),
      lamp('teachSeamTrackingLaser'),
      lamp('teachWeldingPosition'),
      lamp('seamTrackingOnOff'),
      lamp('moveHomePosition'),
      lamp('owvaHeightReg'),
      lamp('axisFastSlowly'),
      lamp('moveWeldingPosition'),
      lamp('owcvaSelector'),
      lamp('owvaSelector'),
      lamp('owhaSelector'),
      lamp('owcaSelector'),
      lamp('owwacSelector'),
      lamp('owwdcSelector'),
      lamp('owffSelector'),
    ]);
    const teachPipeLamp = await lamp('teachPipeMiddle');

    let screen = await this.backgrounds.findOne({
      where: { name: 'demo-p03a21' },
    });
    if (!screen) {
      await this.backgrounds.update({ active: true }, { active: false });
      screen = await this.backgrounds.save(
        this.backgrounds.create({
          name: 'demo-p03a21',
          active: true,
          cssBackground:
            'linear-gradient(165deg, #2a2a2e 0%, #1a1a1c 40%, #3d3a2e 100%)',
          imageUrl: this.installDemoPlantAsset(),
        }),
      );
    } else if (!screen.active) {
      await this.backgrounds.update({ active: true }, { active: false });
      screen.active = true;
      screen = await this.backgrounds.save(screen);
    }

    type CellDef = {
      row: number;
      col: number;
      label: string;
      style: string;
      primary: RegisterMap;
      secondary?: RegisterMap;
      feedback?: RegisterMap;
      isMotion?: boolean;
      requiresSafeAction?: boolean;
      variableSpeed?: boolean;
      /** STOP is plant-shared (no background) so screen delete cannot wipe it. */
      plantShared?: boolean;
    };

    const cellDefs: CellDef[] = [
      // Row 0 — drawing words. The matrix wraps them; it does not shorten them.
      {
        row: 0,
        col: 0,
        label: 'Buttons active',
        style: 'lamp',
        primary: buttonsActiveLamp,
      },
      {
        row: 0,
        col: 1,
        label: 'Teach Pipe Middle Position',
        style: 'pushbutton',
        primary: teachPipeDi,
        feedback: teachPipeLamp,
      },
      {
        row: 0,
        col: 2,
        label: 'OWVA/OWCA Teach Welding Position',
        style: 'pushbutton',
        primary: teachWeldDi,
        feedback: teachWeldLamp,
      },
      // Row 1
      {
        row: 1,
        col: 0,
        label: 'Teach Seam Tracking Laser',
        style: 'pushbutton',
        primary: teachSeamDi,
        feedback: teachSeamLamp,
      },
      {
        row: 1,
        col: 1,
        label: 'OWFF Welding Flux Flap close/open',
        style: 'selector',
        primary: owffClose,
        secondary: owffOpen,
        feedback: owffLamp,
        isMotion: false,
        variableSpeed: false,
      },
      {
        row: 1,
        col: 2,
        label: 'Seam Tracking on/off',
        style: 'pushbutton',
        primary: seamTrackDi,
        feedback: seamTrackLamp,
      },
      // Row 2
      {
        row: 2,
        col: 0,
        label: 'OWVA, OWCA, OWCVA Move Home Position',
        style: 'pushbutton',
        primary: moveHomeDi,
        feedback: moveHomeLamp,
        isMotion: true,
        variableSpeed: false,
      },
      {
        row: 2,
        col: 1,
        label: 'OWCVA down/up',
        style: 'selector',
        primary: owcvaDown,
        secondary: owcvaUp,
        feedback: owcvaLamp,
        isMotion: true,
      },
      {
        row: 2,
        col: 2,
        label: 'OWHA backw./forw.',
        style: 'selector',
        primary: owhaBack,
        secondary: owhaFwd,
        feedback: owhaLamp,
        isMotion: true,
      },
      // Row 3
      {
        row: 3,
        col: 0,
        label: 'OWVA Height Reg. on/off',
        style: 'pushbutton',
        primary: heightRegDi,
        feedback: heightRegLamp,
      },
      {
        row: 3,
        col: 1,
        label: 'Axis fast/slowly',
        style: 'pushbutton',
        primary: axisFastDi,
        feedback: axisFastLamp,
      },
      {
        row: 3,
        col: 2,
        label: 'OWVA up/down',
        style: 'selector',
        primary: owvaUp,
        secondary: owvaDown,
        feedback: owvaLamp,
        isMotion: true,
      },
      // Row 4
      {
        row: 4,
        col: 0,
        label: 'OWVA, OWCA, OWCVA Move Welding Posit.',
        style: 'pushbutton',
        primary: moveWeldDi,
        feedback: moveWeldLamp,
        isMotion: true,
        variableSpeed: false,
      },
      {
        row: 4,
        col: 1,
        label: 'OWWAC Wire Feed AC up/down',
        style: 'selector',
        primary: owwacUp,
        secondary: owwacDown,
        feedback: owwacLamp,
        isMotion: true,
      },
      {
        row: 4,
        col: 2,
        label: 'OWWDC Wire Feed DC up/down',
        style: 'selector',
        primary: owwdcUp,
        secondary: owwdcDown,
        feedback: owwdcLamp,
        isMotion: true,
      },
      // Row 5 — STOP docks out (hole at 5,0); Enable; OWCA
      {
        row: 5,
        col: 0,
        label: 'STOP',
        style: 'estop',
        primary: eStop,
        requiresSafeAction: true,
        // Plant-shared: not owned by one screen so delete/copy cannot wipe STOP.
        plantShared: true,
      },
      {
        row: 5,
        col: 1,
        label: 'Enable',
        style: 'enable',
        primary: enableDi,
      },
      {
        row: 5,
        col: 2,
        label: 'OWCA backw./forw.',
        style: 'selector',
        primary: owcaBack,
        secondary: owcaFwd,
        feedback: owcaLamp,
        isMotion: true,
      },
    ];

    for (const def of cellDefs) {
      // Plant-shared STOP survives a scoped demo reset — do not create a second.
      if (def.plantShared) {
        const shared = await this.cells.find({
          where: { background: IsNull() },
        });
        const hasStop = shared.some(
          (cell) =>
            cell.style === 'estop' ||
            cell.requiresSafeAction ||
            cell.label.trim().toUpperCase() === 'STOP',
        );
        if (hasStop) continue;
      }
      const isMotion = def.isMotion ?? false;
      await this.cells.save(
        this.cells.create({
          row: def.row,
          col: def.col,
          label: def.label,
          style: def.style,
          primaryRegister: def.primary,
          secondaryRegister: def.secondary ?? null,
          feedbackRegister: def.feedback ?? null,
          statusRegister: null,
          isMotion,
          requiresSafeAction: def.requiresSafeAction ?? false,
          // Pendant uses the Axis fast/slowly cell; hide the separate jog strip.
          variableSpeed: def.variableSpeed ?? false,
          slowSpeedPct: 30,
          fastSpeedPct: 100,
          background: def.plantShared ? null : screen,
        }),
      );
    }

    await this.ensureSafetyRoles();
    await this.ensureDemoPlantExample(screen);
  }
}
