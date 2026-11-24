import { MigrationInterface, QueryRunner } from 'typeorm';
import { addColumnIfMissing } from '../column-exists';

export class AddAlarmEventClearedAt1763700000000 implements MigrationInterface {
  name = 'AddAlarmEventClearedAt1763700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addColumnIfMissing(
      queryRunner,
      'alarm_events',
      'cleared_at',
      'datetime',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "alarm_events" DROP COLUMN "cleared_at"`,
    );
  }
}
