import {
  pdfStandardFontDataUrl,
  rasterizeFirstPdfPage,
  renderPdfFirstPage,
} from './hmi-pdf';

describe('hmi pdf page', () => {
  it('rasterizes page 1 to a png', async () => {
    const png = await rasterizeFirstPdfPage(
      Buffer.from('%PDF'),
      async () => ({
        getViewport: () => ({ width: 10.2, height: 4.2 }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => undefined,
      }),
      (width, height) => ({
        context: { width, height },
        toPng: () => Buffer.from('png'),
      }),
    );
    expect(png.toString()).toBe('png');
  });

  it('rejects an empty pdf and an empty render', async () => {
    const open = async () => ({
      getViewport: () => ({ width: 0, height: 0 }),
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => undefined,
    });
    await expect(
      rasterizeFirstPdfPage(Buffer.alloc(0), open, () => ({
        context: {},
        toPng: () => Buffer.from('x'),
      })),
    ).rejects.toThrow('PDF is empty');
    await expect(
      rasterizeFirstPdfPage(Buffer.from('%PDF'), open, () => ({
        context: {},
        toPng: () => Buffer.alloc(0),
      })),
    ).rejects.toThrow('PDF page rendered empty');
  });

  it('uses the loader tools', async () => {
    const png = await renderPdfFirstPage(Buffer.from('%PDF'), async () => ({
      open: async () => ({
        getViewport: () => ({ width: 8, height: 8 }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => undefined,
      }),
      paint: () => ({
        context: {},
        toPng: () => Buffer.from('png'),
      }),
    }));
    expect(png.toString()).toBe('png');
  });

  it('normalizes Windows font dirs to a trailing forward slash for pdfjs', () => {
    expect(
      pdfStandardFontDataUrl('C:\\Users\\x\\pdfjs-dist\\standard_fonts'),
    ).toBe('C:/Users/x/pdfjs-dist/standard_fonts/');
    expect(pdfStandardFontDataUrl('/tmp/standard_fonts/')).toBe(
      '/tmp/standard_fonts/',
    );
  });
});
