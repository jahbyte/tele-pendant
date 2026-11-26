import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DEMO_CRANE_MAP } from '@tele-pendant/modbus-core';
import { WS_EVENTS } from '@tele-pendant/shared';
import { AlarmEngineService } from '../../alarms/providers/alarm-engine.service';
import { motionDebug, motionDebugEnabled } from '../../common/motion-debug';
import { PlcService } from '../../plc/providers/plc.service';
import { SafetyStateService } from '../../safety/providers/safety-state.service';
import { TrendsService } from '../../trends/providers/trends.service';
import { RealtimeGateway } from '../realtime.gateway';

/** Old crane holdings — never re-publish into live tags / Assistant. */
const LEGACY_CRANE_VALUE_KEYS = [
  'holding.hoistHeightMm',
  'holding.loadKg',
  'holding.trolleyPosition',
] as const;

export type LiveTagSnapshot = {
  speedPct: number;
  motorRunning: boolean;
  fault: boolean;
  commsOk: boolean;
  values: Record<string, number | boolean>;
  /** Increments every successful poll (strict ordering for Operator merge). */
  seq: number;
  at: string;
};

@Injectable()
export class TagPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TagPollerService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Slow path: full named map + trends — must not block the 250ms live poll. */
  private heavyTimer: NodeJS.Timeout | null = null;
  private tick = 0;
  private seq = 0;
  /** Skip overlapping polls — prod Modbus RTT otherwise stacks reads and stalls live tags. */
  private inFlight = false;
  private heavyInFlight = false;
  private lastTags: LiveTagSnapshot | null = null;
  private pollStartedAt = 0;

  constructor(
    @Inject(PlcService) private readonly plcService: PlcService,
    @Inject(SafetyStateService)
    private readonly safetyState: SafetyStateService,
    @Inject(RealtimeGateway) private readonly gateway: RealtimeGateway,
    @Inject(AlarmEngineService) private readonly alarms: AlarmEngineService,
    @Inject(TrendsService) private readonly trends: TrendsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, 250);
    this.heavyTimer = setInterval(() => {
      void this.heavyRefresh();
    }, 2000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.heavyTimer) clearInterval(this.heavyTimer);
  }

  /** Last broadcast payload — used by GET /realtime/tags when WS is laggy in prod. */
  latest(): LiveTagSnapshot | { at: null } {
    return this.lastTags ?? { at: null };
  }

  /**
   * Critical path only: safety tick + 2 batch reads + broadcast.
   * Named-map / trends run on heavyRefresh so activate writes are not buried.
   */
  private async poll(): Promise<void> {
    if (this.inFlight) {
      if (motionDebugEnabled()) {
        motionDebug('tags.poll.skip-inflight');
      }
      return;
    }
    this.inFlight = true;
    this.pollStartedAt = Date.now();
    try {
      await this.plcService.reconnectIfNeeded();
      const safety = await this.safetyState.tick();
      this.gateway.broadcast(WS_EVENTS.SAFETY_STATE, safety);
      this.gateway.broadcast(
        WS_EVENTS.CONNECTION_HEALTH,
        this.plcService.health(),
      );

      const driver = this.plcService.getDriver();
      if (!driver.isConnected()) return;

      const speedAddr = await this.plcService.addressFor(
        'holding.speedPct',
        DEMO_CRANE_MAP.holdings.speedPct,
      );
      const motorAddr = await this.plcService.addressFor(
        'discrete.motorRunning',
        DEMO_CRANE_MAP.discretes.motorRunning,
      );
      const faultAddr = await this.plcService.addressFor(
        'discrete.fault',
        DEMO_CRANE_MAP.discretes.fault,
      );
      const commsAddr = await this.plcService.addressFor(
        'discrete.commsOk',
        DEMO_CRANE_MAP.discretes.commsOk,
      );
      // Batch-read contiguous demo map blocks so serialized Modbus keeps up
      // with the 250ms poll (per-register reads were freezing then jumping).
      const holdingBlock = await driver.readHoldingRegisters(speedAddr, 1);
      const speed = holdingBlock[0] ?? 0;
      const discreteBase = Math.min(motorAddr, faultAddr, commsAddr);
      const discreteTop = Math.max(motorAddr, faultAddr, commsAddr);
      const discreteBlock = await driver.readDiscreteInputs(
        discreteBase,
        discreteTop - discreteBase + 1,
      );
      const pickDiscrete = (addr: number) =>
        Boolean(discreteBlock[addr - discreteBase]);
      const motorRunning = pickDiscrete(motorAddr);
      const fault = pickDiscrete(faultAddr);
      const commsOk = pickDiscrete(commsAddr);

      const coreValues: Record<string, number | boolean> = {
        'holding.speedPct': speed ?? 0,
        'discrete.motorRunning': motorRunning,
        'discrete.fault': fault,
        'discrete.commsOk': commsOk,
      };
      const values = scrubLegacyCraneValues({
        ...this.lastTags?.values,
        ...coreValues,
      });

      this.seq += 1;
      const snapshot: LiveTagSnapshot = {
        speedPct: speed ?? 0,
        motorRunning,
        fault,
        commsOk,
        values,
        seq: this.seq,
        at: new Date().toISOString(),
      };
      this.lastTags = snapshot;
      this.gateway.broadcast(WS_EVENTS.TAGS_UPDATE, snapshot);

      if (
        motionDebugEnabled() &&
        (safety.deadmanActive || this.tick % 8 === 0)
      ) {
        motionDebug('tags.poll', {
          seq: snapshot.seq,
          ms: Date.now() - this.pollStartedAt,
          deadmanActive: safety.deadmanActive,
          speedPct: snapshot.speedPct,
        });
      }

      await this.alarms.evaluate();
      this.tick += 1;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' &&
              err !== null &&
              'message' in err &&
              typeof err.message === 'string'
            ? (err as { message: string }).message
            : String(err);
      this.logger.debug(`poll error: ${message}`);
    } finally {
      this.inFlight = false;
    }
  }

  /** Secondary Modbus work — never blocks the live 250ms path. */
  private async heavyRefresh(): Promise<void> {
    if (this.heavyInFlight) return;
    if (!this.plcService.getDriver().isConnected()) return;
    const holding = this.safetyState.snapshot().deadmanActive;
    this.heavyInFlight = true;
    try {
      if (this.lastTags) {
        try {
          const named = await this.plcService.readNamedValues();
          this.seq += 1;
          this.lastTags = {
            ...this.lastTags,
            values: scrubLegacyCraneValues({
              ...this.lastTags.values,
              ...named,
            }),
            seq: this.seq,
            at: new Date().toISOString(),
          };
          this.gateway.broadcast(WS_EVENTS.TAGS_UPDATE, this.lastTags);
        } catch {
          // keep core snapshot
        }
      }
      if (!holding) {
        const series = await this.plcService.trendedSamples();
        for (const sample of series) {
          await this.trends.record(sample.key, sample.value);
        }
      }
    } catch (err) {
      this.logger.debug(
        `heavy refresh error: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    } finally {
      this.heavyInFlight = false;
    }
  }
}

function scrubLegacyCraneValues(
  values: Record<string, number | boolean>,
): Record<string, number | boolean> {
  const next = { ...values };
  for (const key of LEGACY_CRANE_VALUE_KEYS) {
    delete next[key];
  }
  return next;
}
