import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PlcProtocol = 'modbus-tcp' | 'modbus-tls' | 'opcua';

export type OpcSecurityMode = 'None' | 'Sign' | 'SignAndEncrypt';

@Entity('plc_connections')
export class PlcConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  label!: string;

  @Column({ type: 'varchar', default: 'modbus-tcp' })
  protocol!: PlcProtocol;

  @Column({ type: 'varchar', default: '127.0.0.1' })
  host!: string;

  @Column({ type: 'int', default: 1502 })
  port!: number;

  @Column({ name: 'unit_id', type: 'int', default: 1 })
  unitId!: number;

  @Column({ name: 'poll_ms', type: 'int', default: 250 })
  pollMs!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'is_simulator', type: 'boolean', default: false })
  isSimulator!: boolean;

  /** PEM CA / trust file for Modbus TLS or OPC UA server validation. */
  @Column({ name: 'tls_ca_path', type: 'varchar', nullable: true })
  tlsCaPath?: string | null;

  /** Client certificate PEM path (Modbus TLS / OPC UA). */
  @Column({ name: 'tls_cert_path', type: 'varchar', nullable: true })
  tlsCertPath?: string | null;

  /** Client private key PEM path (Modbus TLS / OPC UA). */
  @Column({ name: 'tls_key_path', type: 'varchar', nullable: true })
  tlsKeyPath?: string | null;

  /** When false, skip verifying the peer certificate (lab only). */
  @Column({ name: 'tls_reject_unauthorized', type: 'boolean', default: true })
  tlsRejectUnauthorized!: boolean;

  /** OPC UA message security mode. */
  @Column({
    name: 'opc_security_mode',
    type: 'varchar',
    nullable: true,
    default: 'SignAndEncrypt',
  })
  opcSecurityMode?: OpcSecurityMode | null;

  /** OPC UA security policy URI short name (e.g. Basic256Sha256). */
  @Column({
    name: 'opc_security_policy',
    type: 'varchar',
    nullable: true,
    default: 'Basic256Sha256',
  })
  opcSecurityPolicy?: string | null;

  @Column({ name: 'opc_username', type: 'varchar', nullable: true })
  opcUsername?: string | null;

  /** Path to a file containing the OPC UA password (not stored in DB). */
  @Column({ name: 'opc_password_file', type: 'varchar', nullable: true })
  opcPasswordFile?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
