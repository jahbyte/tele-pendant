import { MigrationInterface, QueryRunner } from 'typeorm';
import { addColumnIfMissing } from '../column-exists';

export class AddPlcConnectionSecurity1763800000000 implements MigrationInterface {
  name = 'AddPlcConnectionSecurity1763800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addColumnIfMissing(
      queryRunner,
      'plc_connections',
      'tls_ca_path',
      'varchar',
    );
    await addColumnIfMissing(
      queryRunner,
      'plc_connections',
      'tls_cert_path',
      'varchar',
    );
    await addColumnIfMissing(
      queryRunner,
      'plc_connections',
      'tls_key_path',
      'varchar',
    );
    await addColumnIfMissing(
      queryRunner,
      'plc_connections',
      'tls_reject_unauthorized',
      'boolean NOT NULL DEFAULT 1',
    );
    await addColumnIfMissing(
      queryRunner,
      'plc_connections',
      'opc_security_mode',
      "varchar DEFAULT 'SignAndEncrypt'",
    );
    await addColumnIfMissing(
      queryRunner,
      'plc_connections',
      'opc_security_policy',
      "varchar DEFAULT 'Basic256Sha256'",
    );
    await addColumnIfMissing(
      queryRunner,
      'plc_connections',
      'opc_username',
      'varchar',
    );
    await addColumnIfMissing(
      queryRunner,
      'plc_connections',
      'opc_password_file',
      'varchar',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'tls_ca_path',
      'tls_cert_path',
      'tls_key_path',
      'tls_reject_unauthorized',
      'opc_security_mode',
      'opc_security_policy',
      'opc_username',
      'opc_password_file',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "plc_connections" DROP COLUMN "${column}"`,
      );
    }
  }
}
