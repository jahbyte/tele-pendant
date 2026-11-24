import { registerAs } from '@nestjs/config';
import { isAbsolute, join, resolve } from 'path';

/** Keep SQLite on an absolute path so relative ./data works after cwd changes. */
function resolveDatabasePath(raw?: string): string {
  const fallback = join(process.cwd(), 'data', 'tele-pendant.sqlite');
  const value = raw?.trim();
  if (!value) return fallback;
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

export default registerAs('database', () => ({
  path: resolveDatabasePath(process.env.DATABASE_PATH),
  synchronize: process.env.DATABASE_SYNC === 'true' ? true : false,
  autoLoadEntities: process.env.DATABASE_AUTOLOAD === 'true' ? true : false,
}));
