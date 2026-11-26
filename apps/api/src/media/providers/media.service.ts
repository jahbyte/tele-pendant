import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { cellUsesHoldToRun, isOperatorStopCell } from '@tele-pendant/shared';
import { AuditService } from '../../audit/providers/audit.service';
import { HmiService } from '../../hmi/providers/hmi.service';
import { SafetyStateService } from '../../safety/providers/safety-state.service';
import { UserRole } from '../../users/enums/user-role.enum';
import { ScanCode } from '../entities/scan-code.entity';
import { isNegatedVoiceCommand, matchVoiceCommand } from './voice-match';

/** How long a spoken hold-to-run command stays asserted. */
const VOICE_JOG_MS = 2500;
const VOICE_JOG_PULSE_MS = 400;

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly codes: Repository<ScanCode>;
  private readonly hmiService: HmiService;
  private readonly safetyState: SafetyStateService;
  private readonly auditService: AuditService;
  private voicePulse: ReturnType<typeof setInterval> | null = null;
  private voicePulseCellId: string | null = null;

  constructor(
    @InjectRepository(ScanCode)
    codes: Repository<ScanCode>,
    @Inject(HmiService) hmiService: HmiService,
    @Inject(SafetyStateService) safetyState: SafetyStateService,
    @Inject(AuditService) auditService: AuditService,
  ) {
    this.codes = codes;
    this.hmiService = hmiService;
    this.safetyState = safetyState;
    this.auditService = auditService;
  }

  async onModuleInit(): Promise<void> {
    if ((await this.codes.count()) === 0) {
      await this.codes.save([
        this.codes.create({
          code: 'TP-P03A21',
          label: 'P03A21 Operator',
          kind: 'asset',
          routeHint: '/operator',
          notes: 'Seed QR for Operator (P03A21 pendant layout)',
        }),
        this.codes.create({
          code: 'TP-OPS',
          label: 'Ops dashboard',
          kind: 'shortcut',
          routeHint: '/ops',
        }),
      ]);
      return;
    }
    await this.retargetLegacyCraneSeed();
  }

  /** Replace leftover demo-crane seed with the P03A21 Operator code. */
  private async retargetLegacyCraneSeed(): Promise<void> {
    const legacy = await this.codes.findOne({
      where: { code: 'TP-CRANE-DEMO-01' },
    });
    if (!legacy) return;
    const taken = await this.codes.findOne({ where: { code: 'TP-P03A21' } });
    if (taken) {
      await this.codes.remove(legacy);
      return;
    }
    legacy.code = 'TP-P03A21';
    legacy.label = 'P03A21 Operator';
    legacy.routeHint = legacy.routeHint || '/operator';
    legacy.notes = 'Seed QR for Operator (P03A21 pendant layout)';
    await this.codes.save(legacy);
  }

  async resolveCode(code: string) {
    const row = await this.codes.findOne({ where: { code: code.trim() } });
    if (!row) {
      throw new NotFoundException(`Unknown code: ${code}`);
    }
    return row;
  }

  listCodes() {
    return this.codes.find({ order: { label: 'ASC' } });
  }

  async saveCode(input: {
    id?: string;
    code: string;
    label: string;
    kind?: string;
    routeHint?: string | null;
    notes?: string | null;
  }): Promise<ScanCode> {
    const code = input.code.trim();
    const label = input.label.trim();
    if (!code || !label) {
      throw new BadRequestException('Code and label are required');
    }
    const routeHint = input.routeHint?.trim() || null;
    if (routeHint && !routeHint.startsWith('/')) {
      throw new BadRequestException('Route hint must start with /');
    }

    let row: ScanCode;
    if (input.id) {
      const existing = await this.codes.findOneBy({ id: input.id });
      if (!existing) throw new NotFoundException('Scan code not found');
      row = existing;
    } else {
      row = this.codes.create({});
    }

    const duplicate = await this.codes.findOne({ where: { code } });
    if (duplicate && duplicate.id !== row.id) {
      throw new ConflictException('A code with that payload already exists');
    }

    row.code = code;
    row.label = label;
    row.kind = input.kind?.trim() || 'asset';
    row.routeHint = routeHint;
    row.notes = input.notes?.trim() || null;
    return this.codes.save(row);
  }

  async deleteCode(id: string): Promise<void> {
    const row = await this.codes.findOneBy({ id });
    if (!row) throw new NotFoundException('Scan code not found');
    await this.codes.remove(row);
  }

  /**
   * Map a spoken phrase to an allowlisted cell label and activate it.
   */
  async voiceCommand(
    transcript: string,
    opts: {
      userId?: string;
      userEmail?: string;
      userDisplayName?: string | null;
      role?: UserRole;
      ip?: string;
      safeActionPin?: string;
      alternatives?: string[];
      clientId?: string | null;
    },
  ) {
    const clientId = opts.clientId?.trim() || '';
    if (!clientId) {
      return { ok: false, reason: 'device_required', transcript };
    }

    const phrases = [transcript, ...(opts.alternatives ?? [])]
      .map((phrase) => phrase.trim())
      .filter((phrase) => phrase.length > 0);
    let label: string | null = null;
    let direction: 'a' | 'b' | undefined;
    let heard = transcript;
    for (const phrase of phrases) {
      // Refuse "do not open…" instead of falling through to a positive alt.
      if (isNegatedVoiceCommand(phrase)) {
        return {
          ok: false,
          reason: 'command_negated',
          transcript: phrase,
          message: 'Negated voice commands are ignored.',
        };
      }
      const hit = matchVoiceCommand(phrase);
      if (!hit) continue;
      if (hit.label === 'STOP') {
        label = hit.label;
        direction = undefined;
        heard = phrase;
        break;
      }
      if (!label) {
        label = hit.label;
        direction = hit.direction;
        heard = phrase;
      }
    }

    if (!label) {
      return { ok: false, reason: 'command_not_allowlisted', transcript };
    }

    // Use this device's selected Operator screen — not the admin default.
    const layout = await this.hmiService.getLayout(clientId);
    const cell =
      (label === 'STOP' ? layout.stop : null) ??
      layout.cells.find((c) => c.label.toLowerCase() === label.toLowerCase()) ??
      null;
    if (!cell) {
      return { ok: false, reason: 'cell_not_found', transcript, label };
    }

    if (cell.isMotion) {
      const allowed = await this.safetyState.allowTimedMediaMotion();
      if (!allowed) {
        return {
          ok: false,
          reason: 'timed_motion_disabled',
          transcript: heard,
          label,
          message:
            'Timed motion is off. Hold Enable on Operator while you speak, or turn on Allow timed media motion in Config.',
        };
      }
      // TP-29: never synthesize deadman here — require the session hold
      // (header Listen pulse or Operator hold) before timed voice motion.
      if (!this.safetyState.canIssueMotion(opts.userId, clientId)) {
        return {
          ok: false,
          reason: 'deadman_required',
          transcript: heard,
          label,
          message:
            'Claim exclusive control, hold Enable on Operator, and keep Listen active (or a deadman hold) before timed voice motion.',
        };
      }
    }

    // Enable is already held for Listen — do not pulse ON/OFF and fight the hold.
    const enableAlreadyHeld =
      cell.style === 'enable' && this.safetyState.isEnableHeld();
    const needsVoicePulse =
      !enableAlreadyHeld &&
      !isOperatorStopCell(cell) &&
      cellUsesHoldToRun(cell);

    if (!enableAlreadyHeld) {
      await this.hmiService.activateCell(cell.id, true, {
        userId: opts.userId,
        userEmail: opts.userEmail,
        userDisplayName: opts.userDisplayName,
        role: opts.role,
        safeActionPin: opts.safeActionPin,
        ip: opts.ip,
        clientId,
        direction,
      });
    }

    if (needsVoicePulse) {
      this.beginVoicePulse(cell.id);
    }

    await this.auditService.write({
      userId: opts.userId,
      userEmail: opts.userEmail,
      userDisplayName: opts.userDisplayName ?? null,
      action: 'voice.command',
      resource: cell.label,
      details: heard,
      ip: opts.ip,
      clientId,
      result: 'success',
    });

    return {
      ok: true,
      cellId: cell.id,
      label,
      transcript: heard,
      message: cell.requiresSafeAction
        ? `STOP commanded (${label}).`
        : undefined,
    };
  }

  /**
   * Assert then clear hold-to-run coils (jog, Teach, Seam, Enable, …).
   * Clears any prior voice pulse so a second phrase cannot leave the first ON.
   */
  private beginVoicePulse(cellId: string): void {
    const previous = this.voicePulseCellId;
    if (this.voicePulse) {
      clearInterval(this.voicePulse);
      this.voicePulse = null;
    }
    if (previous && previous !== cellId) {
      void this.clearVoiceCell(previous);
    }
    this.voicePulseCellId = cellId;
    const started = Date.now();
    this.voicePulse = setInterval(() => {
      if (Date.now() - started >= VOICE_JOG_MS) {
        this.endVoicePulse(cellId);
      }
    }, VOICE_JOG_PULSE_MS);
    this.voicePulse.unref();
  }

  private endVoicePulse(cellId: string): void {
    // A newer phrase may have replaced this pulse — still drop this coil only.
    if (this.voicePulseCellId !== cellId) {
      void this.clearVoiceCell(cellId);
      return;
    }
    if (this.voicePulse) {
      clearInterval(this.voicePulse);
      this.voicePulse = null;
    }
    this.voicePulseCellId = null;
    void this.clearVoiceCell(cellId);
  }

  private async clearVoiceCell(cellId: string): Promise<void> {
    try {
      await this.hmiService.activateCell(cellId, false, {});
    } catch {
      // Safety tick / Enable·command watchdogs still clear stuck coils.
    }
  }

  cameraConfig() {
    return {
      deviceCameraEnabled: true,
      rtspUrl: process.env.CAMERA_RTSP_URL || null,
      notes:
        'This screen uses the device camera. A plant camera can be connected later by an administrator.',
    };
  }
}
