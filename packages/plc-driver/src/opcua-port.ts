import { readFileSync } from 'node:fs';
import type {
  ModbusShapedDriver,
  OpcSecurityMode,
  PlcConnectOptions,
  PlcPoint,
  PlcPort,
} from './port';

export type OpcUaSecurityOptions = {
  securityMode: OpcSecurityMode;
  securityPolicy: string;
  certificateFile?: string | null;
  privateKeyFile?: string | null;
  serverCertificateFile?: string | null;
  rejectUnauthorized?: boolean;
  username?: string | null;
  passwordFile?: string | null;
};

export interface OpcStatus {
  name?: string;
  isGood?: () => boolean;
  toString?: () => string;
}

export function errorForOpcStatus(
  status: OpcStatus | string | null | undefined,
): Error | null {
  if (!status) return null;
  const name =
    typeof status === 'string'
      ? status
      : (status.name ?? status.toString?.() ?? '');
  if (!name || name === 'Good' || name.startsWith('Good')) return null;
  const error = new Error(`OPC UA status ${name}`) as Error & {
    lostSession?: boolean;
  };
  if (/BadSession|BadConnection|BadSecureChannel|BadNotConnected/i.test(name)) {
    error.lostSession = true;
  }
  return error;
}

function lostSession(err: unknown): boolean {
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { lostSession?: boolean }).lostSession === true
  ) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /BadSession|BadConnection|BadSecureChannel|BadNotConnected|ECONNRESET|socket hang up/i.test(
    message,
  );
}

export interface OpcSession {
  read(nodeId: string): Promise<unknown>;
  write(nodeId: string, value: boolean | number): Promise<void>;
  close(): Promise<void>;
}

/**
 * OPC UA adapter. No subscription. node-opcua is loaded only when connecting
 * so the Modbus demo does not need the stack at startup.
 */
export class OpcUaPort implements PlcPort {
  private session: OpcSession | null = null;
  private points: PlcPoint[] = [];
  private facade: ModbusShapedDriver | null = null;

  constructor(
    private readonly openSession: (
      endpoint: string,
      security: OpcUaSecurityOptions,
    ) => Promise<OpcSession> = openNodeOpcuaSession,
  ) {}

  setPoints(points: PlcPoint[]): void {
    this.points = points;
  }

  async connect(options: PlcConnectOptions): Promise<void> {
    await this.disconnect();
    const mode = (options.opcSecurityMode ??
      'SignAndEncrypt') as OpcSecurityMode;
    const policy = options.opcSecurityPolicy?.trim() || 'Basic256Sha256';
    if (mode !== 'None') {
      if (!options.tlsCertPath?.trim() || !options.tlsKeyPath?.trim()) {
        throw new Error(
          'OPC UA Sign/SignAndEncrypt requires tlsCertPath and tlsKeyPath (client certificate and private key)',
        );
      }
    }
    const endpoint = `opc.tcp://${options.host}:${options.port}`;
    this.session = await this.openSession(endpoint, {
      securityMode: mode,
      securityPolicy: policy,
      certificateFile: options.tlsCertPath,
      privateKeyFile: options.tlsKeyPath,
      serverCertificateFile: options.tlsCaPath,
      rejectUnauthorized: options.tlsRejectUnauthorized !== false,
      username: options.opcUsername,
      passwordFile: options.opcPasswordFile,
    });
  }

  async disconnect(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) await session.close();
  }

  isConnected(): boolean {
    return this.session !== null;
  }

  async read(point: PlcPoint): Promise<number | boolean> {
    try {
      const value = await this.sessionOrThrow().read(this.nodeId(point));
      if (point.kind === 'coil' || point.kind === 'discrete')
        return Boolean(value);
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    } catch (err) {
      this.dropIfLost(err);
      throw err;
    }
  }

  async write(point: PlcPoint, value: number | boolean): Promise<void> {
    const payload =
      point.kind === 'coil' || point.kind === 'discrete'
        ? Boolean(value)
        : Number(value);
    try {
      await this.sessionOrThrow().write(this.nodeId(point), payload);
    } catch (err) {
      this.dropIfLost(err);
      throw err;
    }
  }

  /** Same method names the poller already calls, backed by node ids. */
  asModbus(): ModbusShapedDriver {
    if (this.facade) return this.facade;
    this.facade = {
      connect: async () => undefined,
      disconnect: () => this.disconnect(),
      isConnected: () => this.isConnected(),
      readCoils: (address, length) => this.readFlags('coil', address, length),
      readDiscreteInputs: (address, length) =>
        this.readFlags('discrete', address, length),
      readHoldingRegisters: (address, length) =>
        this.readWords('holding', address, length),
      readInputRegisters: (address, length) =>
        this.readWords('input', address, length),
      writeCoil: async (address, value) => {
        await this.write({ kind: 'coil', address }, value);
      },
      writeRegister: async (address, value) => {
        await this.write({ kind: 'holding', address }, value);
      },
      writeRegisters: async (address, values) => {
        for (let i = 0; i < values.length; i++) {
          await this.write(
            { kind: 'holding', address: address + i },
            values[i],
          );
        }
      },
    };
    return this.facade;
  }

  private async readFlags(
    kind: 'coil' | 'discrete',
    address: number,
    length: number,
  ): Promise<boolean[]> {
    const out: boolean[] = [];
    for (let i = 0; i < length; i++) {
      out.push(Boolean(await this.read({ kind, address: address + i })));
    }
    return out;
  }

  private async readWords(
    kind: 'holding' | 'input',
    address: number,
    length: number,
  ): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < length; i++) {
      out.push(Number(await this.read({ kind, address: address + i })));
    }
    return out;
  }

  private nodeId(point: PlcPoint): string {
    if (point.nodeId) return point.nodeId;
    const hit = this.points.find(
      (row) =>
        row.kind === point.kind && row.address === point.address && row.nodeId,
    );
    if (!hit?.nodeId) {
      throw new Error(`No OPC UA node for ${point.kind} ${point.address}`);
    }
    return hit.nodeId;
  }

  private sessionOrThrow(): OpcSession {
    if (!this.session) throw new Error('OPC UA is not connected');
    return this.session;
  }

  private dropIfLost(err: unknown): void {
    if (lostSession(err)) this.session = null;
  }
}

function resolveMessageSecurityMode(
  mode: OpcSecurityMode,
  MessageSecurityMode: Record<string, number>,
): number {
  if (mode === 'None') return MessageSecurityMode.None;
  if (mode === 'Sign') return MessageSecurityMode.Sign;
  return MessageSecurityMode.SignAndEncrypt;
}

function resolveSecurityPolicy(
  policy: string,
  SecurityPolicy: Record<string, string>,
): string {
  const key = policy.trim();
  if (key in SecurityPolicy) return SecurityPolicy[key]!;
  const withPrefix = `SecurityPolicy_${key}`;
  if (withPrefix in SecurityPolicy) return SecurityPolicy[withPrefix]!;
  return SecurityPolicy.Basic256Sha256 ?? key;
}

async function openNodeOpcuaSession(
  endpoint: string,
  security: OpcUaSecurityOptions,
): Promise<OpcSession> {
  const spec = 'node-opcua';
  const opc = (await import(spec)) as {
    OPCUAClient: {
      create: (options: Record<string, unknown>) => {
        connect: (url: string) => Promise<void>;
        disconnect: () => Promise<void>;
        createSession: (identity?: {
          type: number;
          userName?: string;
          password?: string;
        }) => Promise<{
          read: (req: { nodeId: string; attributeId: number }) => Promise<{
            value?: { value?: unknown };
            statusCode?: OpcStatus;
          }>;
          write: (req: {
            nodeId: string;
            attributeId: number;
            value: { value: { dataType: unknown; value: boolean | number } };
          }) => Promise<OpcStatus | undefined>;
          close: () => Promise<void>;
        }>;
      };
    };
    AttributeIds: { Value: number };
    DataType: { Boolean: unknown; Double: unknown };
    MessageSecurityMode: Record<string, number>;
    SecurityPolicy: Record<string, string>;
    UserTokenType?: { UserName: number; Anonymous: number };
  };

  const clientOptions: Record<string, unknown> = {
    endpointMustExist: false,
    securityMode: resolveMessageSecurityMode(
      security.securityMode,
      opc.MessageSecurityMode,
    ),
    securityPolicy: resolveSecurityPolicy(
      security.securityPolicy,
      opc.SecurityPolicy,
    ),
  };
  if (security.certificateFile?.trim()) {
    clientOptions.certificateFile = security.certificateFile.trim();
  }
  if (security.privateKeyFile?.trim()) {
    clientOptions.privateKeyFile = security.privateKeyFile.trim();
  }
  if (security.serverCertificateFile?.trim()) {
    clientOptions.serverCertificate = readFileSync(
      security.serverCertificateFile.trim(),
    );
  }
  if (security.rejectUnauthorized === false) {
    clientOptions.certificateManager = undefined;
    clientOptions.serverCertificateValidation = async () => {
      /* lab: allow untrusted server cert */
    };
  }

  const client = opc.OPCUAClient.create(clientOptions);
  await client.connect(endpoint);

  let sessionIdentity:
    { type: number; userName?: string; password?: string } | undefined;
  const username = security.username?.trim();
  if (username) {
    const password = security.passwordFile?.trim()
      ? readFileSync(security.passwordFile.trim(), 'utf8').trim()
      : '';
    sessionIdentity = {
      type: opc.UserTokenType?.UserName ?? 1,
      userName: username,
      password,
    };
  }
  const session = await client.createSession(sessionIdentity);
  return {
    read: async (nodeId) => {
      const data = await session.read({
        nodeId,
        attributeId: opc.AttributeIds.Value,
      });
      const statusError = errorForOpcStatus(data.statusCode);
      if (statusError) throw statusError;
      return data.value?.value;
    },
    write: async (nodeId, value) => {
      const result = await session.write({
        nodeId,
        attributeId: opc.AttributeIds.Value,
        value: {
          value: {
            dataType:
              typeof value === 'boolean'
                ? opc.DataType.Boolean
                : opc.DataType.Double,
            value,
          },
        },
      });
      const statusError = errorForOpcStatus(result);
      if (statusError) throw statusError;
    },
    close: async () => {
      await session.close();
      await client.disconnect();
    },
  };
}
