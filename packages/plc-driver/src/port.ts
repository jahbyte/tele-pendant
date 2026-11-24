export type PlcKind = 'coil' | 'discrete' | 'holding' | 'input';

export interface PlcPoint {
  kind: PlcKind;
  address: number;
  nodeId?: string | null;
}

export type OpcSecurityMode = 'None' | 'Sign' | 'SignAndEncrypt';

export interface PlcConnectOptions {
  host: string;
  port: number;
  unitId?: number;
  timeoutMs?: number;
  /** Client / application certificate PEM path (OPC UA or Modbus TLS). */
  tlsCertPath?: string | null;
  /** Client private key PEM path. */
  tlsKeyPath?: string | null;
  /** CA / trust PEM path. */
  tlsCaPath?: string | null;
  /** When false, skip peer certificate verification (lab only). */
  tlsRejectUnauthorized?: boolean;
  /** When true, Modbus connects over TLS (modbus-tls protocol). */
  modbusTls?: boolean;
  opcSecurityMode?: OpcSecurityMode | null;
  opcSecurityPolicy?: string | null;
  opcUsername?: string | null;
  /** Absolute path to a file whose contents are the OPC UA password. */
  opcPasswordFile?: string | null;
}

/** Protocol-neutral read/write. Modbus and OPC UA each adapt to this. */
export interface PlcPort {
  connect(options: PlcConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  read(point: PlcPoint): Promise<number | boolean>;
  write(point: PlcPoint, value: number | boolean): Promise<void>;
}

export interface ModbusShapedDriver {
  connect(options: {
    host: string;
    port: number;
    unitId: number;
    timeoutMs?: number;
    tls?: {
      enabled: boolean;
      caPath?: string | null;
      certPath?: string | null;
      keyPath?: string | null;
      rejectUnauthorized?: boolean;
    };
  }): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  readCoils(address: number, length: number): Promise<boolean[]>;
  readDiscreteInputs(address: number, length: number): Promise<boolean[]>;
  readHoldingRegisters(address: number, length: number): Promise<number[]>;
  readInputRegisters(address: number, length: number): Promise<number[]>;
  writeCoil(address: number, value: boolean): Promise<void>;
  writeRegister(address: number, value: number): Promise<void>;
  writeRegisters(address: number, values: number[]): Promise<void>;
}
