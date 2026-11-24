import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MediaPage } from './MediaPage';
import { renderWithProviders } from '../test/render';
import * as api from '../lib/api';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});
const zxingState = vi.hoisted(() => ({ mode: 'TP-P03A21' }));
const cameraOverride = vi.hoisted(() => ({
  impl: null as
    | null
    | (() => ReturnType<
        typeof import('@/lib/use-device-camera').useDeviceCamera
      >),
}));
const toastMocks = vi.hoisted(() => ({
  ok: vi.fn(),
  err: vi.fn(),
}));

vi.mock('@/lib/use-device-camera', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/use-device-camera')>();
  return {
    useDeviceCamera: (opts?: Parameters<typeof actual.useDeviceCamera>[0]) =>
      cameraOverride.impl?.() ?? actual.useDeviceCamera(opts),
  };
});

vi.mock('@/lib/toast', () => ({
  toastOk: (...args: unknown[]) => toastMocks.ok(...args),
  toastErr: (...args: unknown[]) => toastMocks.err(...args),
}));

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decodeOnceFromVideoElement() {
      if (zxingState.mode === 'throw') throw new Error('decode failed');
      const text = zxingState.mode;
      return Promise.resolve({ getText: () => text });
    }
  },
}));

describe('MediaPage', () => {
  beforeEach(() => {
    cameraOverride.impl = null;
    navigateMock.mockClear();
    zxingState.mode = 'TP-P03A21';
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    toastMocks.ok.mockClear();
    toastMocks.err.mockClear();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
    vi.spyOn(api, 'apiGet').mockImplementation(async (path) => {
      if (path === '/media/camera') {
        return {
          deviceCameraEnabled: true,
          rtspUrl: 'rtsp://cam',
          notes: 'Device camera notes',
        };
      }
      return [
        { code: 'TP-P03A21', label: 'P03A21 Operator', routeHint: '/operator' },
      ];
    });
    vi.spyOn(api, 'apiPost').mockResolvedValue({
      code: 'TP-P03A21',
      label: 'P03A21 Operator',
      routeHint: null,
    });
  });

  it('navigates after resolve when a route hint is returned', async () => {
    vi.spyOn(api, 'apiPost').mockResolvedValue({
      code: 'TP-OPS',
      label: 'Ops',
      routeHint: '/ops',
    });
    renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/ops'));
  });

  it('rejects whitespace-only scan payloads', async () => {
    class SpaceDetector {
      detect = vi.fn().mockResolvedValue([{ rawValue: '   ' }]);
    }
    (
      window as unknown as { BarcodeDetector: typeof SpaceDetector }
    ).BarcodeDetector = SpaceDetector;
    const post = vi.spyOn(api, 'apiPost');
    renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(
        alerts.some((el) => /Enter a code/i.test(el.textContent ?? '')),
      ).toBe(true);
    });
    expect(post).not.toHaveBeenCalledWith(
      '/media/codes/resolve',
      expect.anything(),
    );
  });

  it('resolves codes and scans barcodes', async () => {
    class FakeDetector {
      detect = vi.fn().mockResolvedValue([{ rawValue: 'TP-P03A21' }]);
    }
    (
      window as unknown as { BarcodeDetector: typeof FakeDetector }
    ).BarcodeDetector = FakeDetector;

    const post = vi.spyOn(api, 'apiPost').mockImplementation(async (path) => {
      if (path === '/media/codes/resolve') {
        return {
          code: 'TP-P03A21',
          label: 'P03A21 Operator',
          routeHint: null,
        };
      }
      return { ok: true, label: 'Hoist Up' };
    });

    renderWithProviders(<MediaPage />);
    expect(await screen.findByText(/Device camera notes/)).toBeInTheDocument();
    expect(screen.getByText(/Plant camera configured/)).toBeInTheDocument();

    const codeInput = screen.getByDisplayValue('TP-P03A21');
    fireEvent.change(codeInput, { target: { value: 'TP-CUSTOM' } });
    expect(codeInput).toHaveValue('TP-CUSTOM');
    fireEvent.change(codeInput, { target: { value: 'TP-P03A21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/media/codes/resolve', {
        code: 'TP-P03A21',
      }),
    );
    await waitFor(() =>
      expect(toastMocks.ok).toHaveBeenCalledWith('P03A21 Operator'),
    );
    expect(
      screen.getAllByText(/Resolved: P03A21 Operator \(TP-P03A21\)/).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'TP-P03A21' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    await waitFor(() => expect(api.apiPost).toHaveBeenCalled());
  });

  it('handles camera, barcode, and resolve failures', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('no cam')),
      },
    });
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    vi.spyOn(api, 'apiGet').mockImplementation(async (path) => {
      if (path === '/media/camera') {
        return {
          deviceCameraEnabled: true,
          rtspUrl: null,
          notes: 'notes',
        };
      }
      return [];
    });
    vi.spyOn(api, 'apiPost').mockRejectedValueOnce(new Error('bad code'));

    renderWithProviders(<MediaPage />);
    expect(await screen.findByText(/no cam/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: 'TP-P03A21' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(toastMocks.err).toHaveBeenCalledWith('bad code'),
    );
    expect(screen.getAllByText('bad code').length).toBeGreaterThan(0);

    vi.spyOn(api, 'apiPost').mockRejectedValueOnce('x');
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(toastMocks.err).toHaveBeenCalledWith('Resolve failed'),
    );
    expect(screen.getAllByText('Resolve failed').length).toBeGreaterThan(0);
  });

  it('handles non-Error camera denial', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue('denied'),
      },
    });
    vi.spyOn(api, 'apiGet').mockImplementation(async (path) => {
      if (path === '/media/camera') {
        return {
          deviceCameraEnabled: true,
          rtspUrl: null,
          notes: 'notes',
        };
      }
      return [];
    });
    renderWithProviders(<MediaPage />);
    expect(
      await screen.findByText(/blocked for this site/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reload page' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Allow camera again' }),
    ).not.toBeInTheDocument();
  });

  it('renders without scan codes when the list request fails', async () => {
    vi.spyOn(api, 'apiGet').mockImplementation(async (path) => {
      if (path === '/media/camera') {
        return {
          deviceCameraEnabled: true,
          rtspUrl: null,
          notes: 'notes only',
        };
      }
      throw new Error('codes down');
    });
    renderWithProviders(<MediaPage />);
    expect(await screen.findByText('notes only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });

  it('reports empty barcode frame', async () => {
    class EmptyDetector {
      detect = vi.fn().mockResolvedValue([]);
    }
    (
      window as unknown as { BarcodeDetector: typeof EmptyDetector }
    ).BarcodeDetector = EmptyDetector;
    renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(
        alerts.some((el) => /No code in frame/i.test(el.textContent ?? '')),
      ).toBe(true);
    });
  });

  it('stops a late camera stream after leaving the page', async () => {
    const pending: Array<
      (stream: {
        getTracks: () => Array<{ stop: ReturnType<typeof vi.fn> }>;
      }) => void
    > = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((resolve) => {
              pending.push(resolve);
            }),
        ),
      },
    });
    const view = renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    view.unmount();
    const stop = vi.fn();
    pending[0]?.({ getTracks: () => [{ stop }] });
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('ignores a camera error that arrives after leaving the page', async () => {
    const pending: Array<(err: Error) => void> = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              pending.push(reject);
            }),
        ),
      },
    });
    const view = renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    view.unmount();
    pending[0]?.(new Error('late'));
    await Promise.resolve();
  });

  it('shows the config link for supervisors', async () => {
    renderWithProviders(<MediaPage />, { role: 'supervisor' });
    expect(
      await screen.findByRole('link', { name: /Add or edit codes in Config/i }),
    ).toHaveAttribute('href', '/admin?section=codes');
  });

  it('reports camera warmup before zxing', async () => {
    renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      get: () => 0,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByText(/Camera still starting/i).length,
      ).toBeGreaterThan(0),
    );
  });

  it('reports missing video when the camera element is unavailable', async () => {
    const videoRef = { current: null as HTMLVideoElement | null };
    Object.defineProperty(videoRef, 'current', {
      configurable: true,
      get: () => null,
      set: () => undefined,
    });
    cameraOverride.impl = () => ({
      videoRef: videoRef as unknown as {
        current: HTMLVideoElement | null;
      },
      camError: null,
      camRepromptAllowed: false,
      camShowSettingsHint: false,
      camPermissionDenied: false,
      retryCameraAccess: vi.fn(),
    });
    renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    await waitFor(() =>
      expect(screen.getAllByText(/No camera video/i)).toHaveLength(1),
    );
  });

  it('does not duplicate camera feedback when permission is already denied', async () => {
    cameraOverride.impl = () => ({
      videoRef: { current: null },
      camError: 'Camera permission denied',
      camRepromptAllowed: false,
      camShowSettingsHint: false,
      camPermissionDenied: true,
      retryCameraAccess: vi.fn(),
    });
    renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    expect(screen.queryByText(/No camera video/i)).not.toBeInTheDocument();
  });

  it('decodes with zxing when BarcodeDetector is missing', async () => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    zxingState.mode = 'TP-P03A21';
    renderWithProviders(<MediaPage />);
    await screen.findByText(/Device camera notes/);
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    Object.defineProperty(video as HTMLVideoElement, 'readyState', {
      configurable: true,
      value: 2,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    await waitFor(() => expect(api.apiPost).toHaveBeenCalled());
    zxingState.mode = '';
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(
        alerts.some((el) => /No code in frame/i.test(el.textContent ?? '')),
      ).toBe(true);
    });
    zxingState.mode = 'throw';
    fireEvent.click(
      screen.getByRole('button', { name: 'Scan QR / barcode in frame' }),
    );
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(
        alerts.some((el) => /No code in frame/i.test(el.textContent ?? '')),
      ).toBe(true);
    });
  });
});
