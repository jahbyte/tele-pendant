import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const requireCanvas = createRequire(__filename);

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

export function rasterFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Invalid plant graphic';
}

const RASTER_EXTS = new Set(['png', 'jpg', 'webp', 'gif']);

/** Declared extension must match the file's magic header. */
export function rasterMagicMatches(buffer: Buffer, ext: string): boolean {
  if (ext === 'png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (ext === 'jpg') {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (ext === 'gif') {
    if (buffer.length < 6) return false;
    const head = buffer.subarray(0, 6).toString('ascii');
    return head === 'GIF87a' || head === 'GIF89a';
  }
  if (ext === 'webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

/**
 * Reject text/damaged files labeled as PNG/JPEG/WebP/GIF so Operator never
 * stores a "successful" upload that then shows a broken picture.
 */
export async function assertReadableRasterImage(
  buffer: Buffer,
  ext: string,
): Promise<void> {
  if (!RASTER_EXTS.has(ext)) return;
  const label = ext === 'jpg' ? 'JPEG' : ext.toUpperCase();
  try {
    if (!rasterMagicMatches(buffer, ext)) {
      throw new Error(`That file is not a readable ${label} image`);
    }
    const { loadImage } = requireCanvas('@napi-rs/canvas') as {
      loadImage: (data: Buffer) => Promise<{ width: number; height: number }>;
    };
    const image = await loadImage(buffer);
    if (!(image.width > 0 && image.height > 0)) {
      throw new Error(`That file is not a readable ${label} image`);
    }
  } catch (err) {
    if (
      err instanceof Error &&
      /^That file is not a readable /.test(err.message)
    ) {
      throw err;
    }
    throw new Error(`That file is not a readable ${label} image`, {
      cause: err,
    });
  }
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
