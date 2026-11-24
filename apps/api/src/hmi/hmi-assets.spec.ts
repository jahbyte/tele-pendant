import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  hmiAssetsDirectory,
  pdfFailureMessage,
  resolveDataRoot,
  serveHmiAssets,
} from './hmi-assets';

describe('hmi-assets paths', () => {
  const prevDb = process.env.DATABASE_PATH;
  const prevSqlite = process.env.SQLITE_DIR;
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'hmi-data-')));
    delete process.env.SQLITE_DIR;
    delete process.env.DATABASE_PATH;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (prevDb === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prevDb;
    if (prevSqlite === undefined) delete process.env.SQLITE_DIR;
    else process.env.SQLITE_DIR = prevSqlite;
  });

  it('resolves relative DATABASE_PATH from the process cwd', () => {
    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      process.env.DATABASE_PATH = './data/tele-pendant.sqlite';
      expect(resolveDataRoot()).toBe(resolve(root, 'data'));
      expect(hmiAssetsDirectory()).toBe(resolve(root, 'data', 'hmi-assets'));
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('prefers absolute SQLITE_DIR over DATABASE_PATH', () => {
    process.env.DATABASE_PATH = './ignored/tele.sqlite';
    process.env.SQLITE_DIR = root;
    expect(resolveDataRoot()).toBe(root);
    expect(hmiAssetsDirectory()).toBe(join(root, 'hmi-assets'));
  });

  it('defaults to cwd/data when no env is set', () => {
    expect(resolveDataRoot()).toBe(resolve(process.cwd(), 'data'));
  });

  it('serves an uploaded file from the absolute assets directory', () => {
    process.env.SQLITE_DIR = root;
    const dir = hmiAssetsDirectory();
    writeFileSync(join(dir, 'plant.png'), 'png');
    const res = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      json: jest.fn(),
      sendFile: jest.fn((_file: string, cb?: (err?: Error) => void) => {
        cb?.();
      }),
    };
    const next = jest.fn();
    serveHmiAssets(
      { method: 'GET', path: '/hmi-assets/plant.png' } as never,
      res as never,
      next,
    );
    expect(res.sendFile).toHaveBeenCalledWith(
      join(dir, 'plant.png'),
      expect.any(Function),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('skips non-GET and missing assets, and forwards sendFile errors', () => {
    process.env.SQLITE_DIR = root;
    hmiAssetsDirectory();
    const next = jest.fn();
    serveHmiAssets(
      { method: 'POST', path: '/hmi-assets/x.png' } as never,
      {} as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);

    const res404 = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      json: jest.fn(),
      sendFile: jest.fn(),
    };
    serveHmiAssets(
      { method: 'GET', path: '/hmi-assets/missing.png' } as never,
      res404 as never,
      next,
    );
    expect(res404.status).toHaveBeenCalledWith(404);

    serveHmiAssets(
      { method: 'GET', path: '/hmi-assets/../secret' } as never,
      res404 as never,
      next,
    );

    writeFileSync(join(hmiAssetsDirectory(), 'bad.png'), 'x');
    const resErr = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      json: jest.fn(),
      sendFile: jest.fn((_file: string, cb?: (err?: Error) => void) => {
        cb?.(new Error('send failed'));
      }),
    };
    const nextErr = jest.fn();
    serveHmiAssets(
      { method: 'GET', path: '/hmi-assets/bad.png' } as never,
      resErr as never,
      nextErr,
    );
    expect(nextErr).toHaveBeenCalledWith(expect.any(Error));
  });

  it('hides host paths from PDF upload errors', () => {
    expect(
      pdfFailureMessage(
        new Error(
          'Invalid factory url: "C:\\Users\\x\\pdfjs-dist\\standard_fonts" must include trailing slash.',
        ),
      ),
    ).toMatch(/Could not read that PDF/);
    expect(pdfFailureMessage(new Error('PDF is empty'))).toBe('PDF is empty');
    expect(pdfFailureMessage('boom')).toBe('Could not read that PDF');
  });
});
