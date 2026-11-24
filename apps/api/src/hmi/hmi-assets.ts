import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const HMI_ASSETS_PREFIX = '/hmi-assets';

/**
 * SQLite / plant-graphic root as an absolute path.
 * Relative DATABASE_PATH / SQLITE_DIR values are resolved from process.cwd()
 * so Express sendFile and uploads share the same folder on Windows bare installs.
 */
export function resolveDataRoot(): string {
  const sqliteDir = process.env.SQLITE_DIR?.trim();
  if (sqliteDir) {
    return isAbsolute(sqliteDir)
      ? sqliteDir
      : resolve(process.cwd(), sqliteDir);
  }
  const dbPath = process.env.DATABASE_PATH?.trim();
  if (dbPath) {
    const dir = dbPath.replace(/[/\\][^/\\]+$/, '') || '.';
    return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  }
  return resolve(process.cwd(), 'data');
}

/** Persist plant graphics next to SQLite so docker named volumes keep them. */
export function hmiAssetsDirectory(): string {
  const dir = resolve(join(resolveDataRoot(), 'hmi-assets'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function hmiAssetPublicPath(filename: string): string {
  return `${HMI_ASSETS_PREFIX}/${filename}`;
}

/** Serves uploaded plant graphics outside the /api/v1 prefix (no auth). */
export function serveHmiAssets(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method !== 'GET') {
    next();
    return;
  }
  const match = /^\/hmi-assets\/([^/]+)$/.exec(req.path);
  if (!match || match[1].includes('..')) {
    next();
    return;
  }
  const file = resolve(hmiAssetsDirectory(), match[1]);
  if (!existsSync(file)) {
    res.status(404).type('application/json').json({
      message: 'HMI asset not found',
    });
    return;
  }
  res.sendFile(file, (err) => {
    if (err) next(err);
  });
}

export const HMI_ASSET_MIME: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

export const HMI_IMAGE_BYTE_LIMIT = 2_000_000;
export const HMI_PDF_BYTE_LIMIT = 8_000_000;

export function svgFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Invalid SVG';
}

/**
 * Operator-facing PDF upload error. Never echo host paths (pdfjs Windows
 * standard_fonts factory messages include the full node_modules path).
 */
export function pdfFailureMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  if (
    /standard_fonts|Invalid factory url|pdfjs|ENOENT|EACCES/i.test(raw) ||
    /[A-Za-z]:[\\/]|\/Users\/|\/home\/|node_modules/i.test(raw)
  ) {
    return 'Could not read that PDF. Try a one-page PDF or upload a PNG instead.';
  }
  if (raw.trim()) return raw;
  return 'Could not read that PDF';
}

/** Drop scripts, embedded documents, and event handlers from an uploaded SVG. */
export function sanitizeSvg(source: string): string {
  let svg = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  svg = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '');
  svg = svg.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
  svg = svg.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
  svg = svg.replace(/<embed\b[^>]*\/?>/gi, '');
  svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  svg = svg.replace(/javascript\s*:/gi, '');
  if (!/<svg[\s>]/i.test(svg)) {
    throw new Error('SVG must contain an svg root');
  }
  return svg;
}
