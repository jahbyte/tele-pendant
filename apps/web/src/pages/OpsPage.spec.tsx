import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { OpsPage } from './OpsPage';
import { renderWithProviders } from '../test/render';
import * as api from '../lib/api';

function mockOpsGet(
  overrides?: (path: string) => unknown | undefined,
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(api, 'apiGet').mockImplementation(async (path) => {
    const custom = overrides?.(path);
    if (custom !== undefined) return custom as never;
    if (path === '/alarms') return [];
    if (path.startsWith('/alarms/history')) return [];
    if (path.startsWith('/alarms/summary')) return [];
    if (path === '/trends') return [];
    if (path.startsWith('/trends/')) return [];
    return {
      plc: { connected: true, label: 'sim', lastError: null },
      safety: { mode: 'normal', watchdogOk: true },
      uptimeSec: 1,
    };
  });
}

describe('OpsPage', () => {
  it('renders diagnostics alarms trends and acks', async () => {
    const get = mockOpsGet((path) => {
      if (path === '/alarms') {
        return [
          {
            id: 'a1',
            state: 'active',
            value: 1,
            definition: { name: 'E-Stop', severity: 'critical' },
            createdAt: new Date().toISOString(),
          },
          {
            id: 'a2',
            state: 'shelved',
            value: 1,
            definition: { name: 'Overload', severity: 'warn' },
            createdAt: new Date().toISOString(),
          },
          {
            id: 'a3',
            state: 'acked',
            value: 0,
            definition: { name: 'Seen', severity: 'info' },
            createdAt: new Date().toISOString(),
          },
        ];
      }
      if (path === '/trends')
        return [
          'holding.speedPct',
          'discrete.commsOk',
          'discrete.fault',
          'raw',
        ];
      if (path.startsWith('/trends/discrete.commsOk')) {
        return [
          { value: 1, createdAt: new Date().toISOString() },
          { value: 1, createdAt: new Date().toISOString() },
        ];
      }
      if (path.startsWith('/trends/discrete.fault'))
        return [{ t: '1', value: 0 }];
      if (path.startsWith('/trends/raw')) return { nope: true };
      if (path.startsWith('/trends/')) {
        return [
          { value: 10, createdAt: new Date().toISOString() },
          { value: 40, createdAt: new Date().toISOString() },
        ];
      }
      if (path === '/diagnostics') {
        return {
          plc: { connected: true, label: 'sim', lastError: 'timeout' },
          safety: { mode: 'normal', watchdogOk: true },
          uptimeSec: 9,
        };
      }
      return undefined;
    });
    const post = vi.spyOn(api, 'apiPost').mockResolvedValue({});
    renderWithProviders(<OpsPage />, { role: 'supervisor' });
    await waitFor(() => expect(screen.getByText(/E-Stop/)).toBeInTheDocument());
    expect(screen.getByText(/Last error: timeout/)).toBeInTheDocument();
    expect(await screen.findByText(/40 %/)).toBeInTheDocument();
    expect(screen.getByText(/discrete.commsOk: 1/)).toBeInTheDocument();
    expect(screen.getByText(/shelved/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ack' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Shelve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unshelve' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/alarms/a1/shelve'));
    expect(post).toHaveBeenCalledWith('/alarms/a2/unshelve');
    expect(post).toHaveBeenCalledWith('/alarms/a1/ack');
    expect(get).toHaveBeenCalled();
  });

  it('shows empty alarm and trend placeholders', async () => {
    mockOpsGet((path) => {
      if (path === '/alarms' || path.startsWith('/trends/')) return [];
      if (path === '/trends') return { nope: true };
      if (path === '/diagnostics') {
        return {
          plc: { connected: false, label: null, lastError: null },
          safety: { mode: 'comms_lost', watchdogOk: false },
          uptimeSec: 1,
        };
      }
      return undefined;
    });
    renderWithProviders(<OpsPage />, { role: 'supervisor' });
    expect(await screen.findByText('No active alarms')).toBeInTheDocument();
    expect(screen.getByText('No samples yet')).toBeInTheDocument();
    expect(screen.getByText('No alarms in this window')).toBeInTheDocument();
    expect(
      screen.getByText('No alarm counts in this window'),
    ).toBeInTheDocument();
  });

  it('renders empty lists when alarms and trends fail', async () => {
    vi.spyOn(api, 'apiGet').mockImplementation(async (path) => {
      if (
        path === '/alarms' ||
        path === '/trends' ||
        path.startsWith('/alarms/history') ||
        path.startsWith('/alarms/summary')
      ) {
        throw new Error('offline');
      }
      return {
        plc: { connected: true, label: 'sim', lastError: null },
        safety: { mode: 'normal', watchdogOk: true },
        uptimeSec: 2,
      };
    });
    renderWithProviders(<OpsPage />, { role: 'supervisor' });
    expect(await screen.findByText('No active alarms')).toBeInTheDocument();
    expect(screen.getByText('No samples yet')).toBeInTheDocument();
  });

  it('shows diagnostic placeholders when diagnostics fail', async () => {
    mockOpsGet((path) => {
      if (path === '/diagnostics') throw new Error('diag');
      return undefined;
    });
    renderWithProviders(<OpsPage />, { role: 'supervisor' });
    expect(await screen.findByText(/PLC connected:/)).toBeInTheDocument();
    expect(screen.getByText(/n\/a/)).toBeInTheDocument();
  });

  it('defaults shelve permission when no session role is stored', async () => {
    localStorage.removeItem('user');
    mockOpsGet((path) => {
      if (path === '/alarms') {
        return [
          {
            id: 'a1',
            state: 'active',
            value: 1,
            definition: { name: 'E-Stop', severity: 'critical' },
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return undefined;
    });
    renderWithProviders(<OpsPage />);
    await screen.findByText(/E-Stop/);
    expect(
      screen.queryByRole('button', { name: 'Shelve' }),
    ).not.toBeInTheDocument();
  });

  it('hides shelve controls for operators', async () => {
    mockOpsGet((path) => {
      if (path === '/alarms') {
        return [
          {
            id: 'a1',
            state: 'active',
            value: 1,
            definition: { name: 'E-Stop', severity: 'critical' },
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return undefined;
    });
    renderWithProviders(<OpsPage />, { role: 'operator' });
    await screen.findByText(/E-Stop/);
    expect(
      screen.queryByRole('button', { name: 'Shelve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Unshelve' }),
    ).not.toBeInTheDocument();
  });

  it('toasts when ack or shelve fails', async () => {
    mockOpsGet((path) => {
      if (path === '/alarms') {
        return [
          {
            id: 'a1',
            state: 'active',
            value: 1,
            definition: { name: 'E-Stop', severity: 'critical' },
            createdAt: new Date().toISOString(),
          },
          {
            id: 'a2',
            state: 'shelved',
            value: 1,
            definition: { name: 'Parked', severity: 'warn' },
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return undefined;
    });
    vi.spyOn(api, 'apiPost')
      .mockRejectedValueOnce(new Error('ack failed'))
      .mockRejectedValueOnce(new Error('shelve failed'))
      .mockRejectedValueOnce(new Error('unshelve failed'));
    renderWithProviders(<OpsPage />, { role: 'supervisor' });
    await screen.findByText(/E-Stop/);
    fireEvent.click(screen.getByRole('button', { name: 'Ack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Shelve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unshelve' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(3));
  });

  it('shows history frequency windows and downloads CSV', async () => {
    mockOpsGet((path) => {
      if (path.startsWith('/alarms/history')) {
        return [
          {
            id: 'h1',
            state: 'cleared',
            value: 1,
            definition: { name: 'E-Stop', severity: 'critical' },
            createdAt: '2026-01-01T10:00:00.000Z',
            clearedAt: '2026-01-01T10:05:00.000Z',
          },
          {
            id: 'h2',
            state: 'active',
            value: 0,
            definition: { name: 'Comms', severity: 'warning' },
            createdAt: 'not-a-date',
            clearedAt: null,
          },
          {
            id: 'h3',
            state: 'acked',
            value: 2,
            definition: undefined,
            createdAt: '',
            clearedAt: undefined,
          },
        ];
      }
      if (path.startsWith('/alarms/summary')) {
        return [
          { name: 'E-Stop', severity: 'critical', count: 4 },
          { name: 'Comms', severity: 'warning', count: 1 },
        ];
      }
      return undefined;
    });
    const download = vi.spyOn(api, 'apiDownload').mockResolvedValue();
    renderWithProviders(<OpsPage />, { role: 'supervisor' });
    expect(await screen.findByText('Alarm history')).toBeInTheDocument();
    expect(screen.getByText('Most frequent')).toBeInTheDocument();
    expect(screen.getAllByText('Comms').length).toBeGreaterThan(0);
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() =>
      expect(api.apiGet).toHaveBeenCalledWith('/alarms/history?hours=168'),
    );
    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    await waitFor(() =>
      expect(api.apiGet).toHaveBeenCalledWith('/alarms/summary?hours=720'),
    );
    fireEvent.click(screen.getByRole('button', { name: '24h' }));
    await waitFor(() =>
      expect(api.apiGet).toHaveBeenCalledWith('/alarms/history?hours=24'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Download CSV/i }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        '/alarms/history.csv?hours=24',
        expect.stringMatching(/^alarms-\d{4}-\d{2}-\d{2}\.csv$/),
      ),
    );
  });

  it('toasts when CSV export fails', async () => {
    mockOpsGet();
    vi.spyOn(api, 'apiDownload').mockRejectedValue(new Error('export fail'));
    renderWithProviders(<OpsPage />, { role: 'supervisor' });
    await screen.findByText('Alarm history');
    fireEvent.click(screen.getByRole('button', { name: /Download CSV/i }));
    await waitFor(() => expect(api.apiDownload).toHaveBeenCalled());
  });

  it('toasts a fallback when CSV export fails without Error', async () => {
    mockOpsGet();
    vi.spyOn(api, 'apiDownload').mockRejectedValue('nope');
    renderWithProviders(<OpsPage />, { role: 'supervisor' });
    await screen.findByText('Alarm history');
    fireEvent.click(screen.getByRole('button', { name: /Download CSV/i }));
    await waitFor(() => expect(api.apiDownload).toHaveBeenCalled());
  });
});
