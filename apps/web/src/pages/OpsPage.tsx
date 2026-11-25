import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCheck, Download, Pause } from 'lucide-react';
import { apiDownload, apiGet, apiPost } from '../lib/api';
import { useT } from '../lib/i18n';
import { HelpTip } from '../lib/tour';
import { PageSpinner } from '@/components/page-spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { canShelveAlarms, normalizeAlarmSeverity } from '@tele-pendant/shared';
import { getStoredUserRole } from '@/lib/user-session';
import { toastErr, toastOk } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface AlarmEvent {
  id: string;
  state: string;
  value: number;
  definition: { name: string; severity: string };
  createdAt: string;
  clearedAt?: string | null;
}

interface AlarmFrequencyRow {
  name: string;
  severity: string;
  count: number;
}

interface TrendPoint {
  value: number;
  createdAt: string;
}

const HISTORY_WINDOWS = [24, 168, 720] as const;
type HistoryHours = (typeof HISTORY_WINDOWS)[number];

function formatAlarmTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function OpsPage() {
  const { t } = useT();
  const mayShelve = canShelveAlarms(getStoredUserRole() ?? 'operator');
  const [hours, setHours] = useState<HistoryHours>(24);
  const [csvBusy, setCsvBusy] = useState(false);

  const alarms = useQuery({
    queryKey: ['alarms'],
    queryFn: () => apiGet<AlarmEvent[]>('/alarms'),
    refetchInterval: 2000,
  });
  const history = useQuery({
    queryKey: ['alarm-history', hours],
    queryFn: () => apiGet<AlarmEvent[]>(`/alarms/history?hours=${hours}`),
    refetchInterval: 5000,
  });
  const frequency = useQuery({
    queryKey: ['alarm-summary', hours],
    queryFn: () =>
      apiGet<AlarmFrequencyRow[]>(`/alarms/summary?hours=${hours}`),
    refetchInterval: 5000,
  });
  const trendKeys = useQuery({
    queryKey: ['trend-keys'],
    queryFn: async () => {
      const rows = await apiGet<unknown>('/trends');
      return Array.isArray(rows) ? (rows as string[]) : [];
    },
    refetchInterval: 3000,
  });
  const diagnostics = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () =>
      apiGet<{
        plc: {
          connected: boolean;
          label: string | null;
          lastError: string | null;
        };
        safety: { mode: string; watchdogOk: boolean };
        uptimeSec: number;
      }>('/diagnostics'),
    refetchInterval: 2000,
  });

  async function downloadHistoryCsv() {
    setCsvBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await apiDownload(
        `/alarms/history.csv?hours=${hours}`,
        `alarms-${stamp}.csv`,
      );
    } catch (err) {
      toastErr(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setCsvBusy(false);
    }
  }

  if (diagnostics.isLoading && alarms.isLoading) {
    return <PageSpinner label={t('alarmsTitle')} />;
  }

  const windowLabel = (value: HistoryHours) =>
    value === 24
      ? t('alarmWindow24h')
      : value === 168
        ? t('alarmWindow7d')
        : t('alarmWindow30d');

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('alarmsTitle')}</h2>

      <HelpTip id="tour.ops.diagnostics">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" /> {t('diagnostics')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              PLC connected: {String(diagnostics.data?.plc.connected ?? '—')} (
              {diagnostics.data?.plc.label ?? 'n/a'})
            </p>
            <p>Safety mode: {diagnostics.data?.safety.mode ?? '—'}</p>
            <p>
              Watchdog OK: {String(diagnostics.data?.safety.watchdogOk ?? '—')}
            </p>
            <p>Uptime: {diagnostics.data?.uptimeSec ?? '—'} s</p>
            {diagnostics.data?.plc.lastError ? (
              <p className="text-destructive">
                Last error: {diagnostics.data.plc.lastError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </HelpTip>

      <HelpTip id="tour.ops.alarms">
        <Card>
          <CardHeader>
            <CardTitle>{t('alarms')}</CardTitle>
            <HelpTip id="tour.ops.ack">
              <p className="text-sm text-muted-foreground">
                Ack means you saw it. Supervisors can park an alarm, then bring
                it back later.
              </p>
            </HelpTip>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!alarms.data?.length ? (
                  <TableRow>
                    <TableCell colSpan={5}>{t('noAlarms')}</TableCell>
                  </TableRow>
                ) : null}
                {(alarms.data ?? []).map((a) => {
                  const severity = normalizeAlarmSeverity(
                    a.definition.severity,
                  );
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Badge
                          variant={
                            severity === 'critical'
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {severity}
                        </Badge>
                      </TableCell>
                      <TableCell>{a.definition.name}</TableCell>
                      <TableCell>{a.state}</TableCell>
                      <TableCell>{a.value}</TableCell>
                      <TableCell>
                        {a.state === 'active' ? (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void apiPost(`/alarms/${a.id}/ack`)
                                  .then(() => {
                                    toastOk(t('ack'));
                                    return alarms.refetch();
                                  })
                                  .catch((err: Error) => toastErr(err.message))
                              }
                            >
                              <CheckCheck /> {t('ack')}
                            </Button>
                            {mayShelve ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void apiPost(`/alarms/${a.id}/shelve`)
                                    .then(() => {
                                      toastOk(t('shelve'));
                                      return alarms.refetch();
                                    })
                                    .catch((err: Error) =>
                                      toastErr(err.message),
                                    )
                                }
                              >
                                <Pause /> {t('shelve')}
                              </Button>
                            ) : null}
                          </div>
                        ) : a.state === 'shelved' && mayShelve ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void apiPost(`/alarms/${a.id}/unshelve`)
                                .then(() => {
                                  toastOk(t('unshelve'));
                                  return alarms.refetch();
                                })
                                .catch((err: Error) => toastErr(err.message))
                            }
                          >
                            {t('unshelve')}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </HelpTip>

      <HelpTip id="tour.ops.window">
        <div className="flex flex-wrap items-center gap-2">
          {HISTORY_WINDOWS.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={hours === value ? 'default' : 'outline'}
              aria-pressed={hours === value}
              onClick={() => setHours(value)}
            >
              {windowLabel(value)}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={csvBusy}
            onClick={() => void downloadHistoryCsv()}
          >
            <Download className="size-4" /> {t('downloadCsv')}
          </Button>
        </div>
      </HelpTip>

      <HelpTip id="tour.ops.history">
        <Card>
          <CardHeader>
            <CardTitle>{t('alarmHistory')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('raised')}</TableHead>
                  <TableHead>{t('cleared')}</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!(history.data ?? []).length ? (
                  <TableRow>
                    <TableCell colSpan={6}>{t('noAlarmHistory')}</TableCell>
                  </TableRow>
                ) : null}
                {(history.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatAlarmTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatAlarmTime(row.clearedAt)}
                    </TableCell>
                    <TableCell>{row.definition?.name ?? '—'}</TableCell>
                    <TableCell>
                      {normalizeAlarmSeverity(row.definition?.severity)}
                    </TableCell>
                    <TableCell>{row.state}</TableCell>
                    <TableCell>{row.value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </HelpTip>

      <HelpTip id="tour.ops.frequency">
        <Card>
          <CardHeader>
            <CardTitle>{t('alarmFrequency')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>{t('count')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!(frequency.data ?? []).length ? (
                  <TableRow>
                    <TableCell colSpan={3}>{t('noAlarmFrequency')}</TableCell>
                  </TableRow>
                ) : null}
                {(frequency.data ?? []).map((row) => (
                  <TableRow
                    key={`${row.name}:${row.severity}`}
                    className={cn(row.count > 1 && 'font-medium')}
                  >
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      {normalizeAlarmSeverity(row.severity)}
                    </TableCell>
                    <TableCell>{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </HelpTip>

      <HelpTip id="tour.ops.trends">
        <Card>
          <CardHeader>
            <CardTitle>{t('trends')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!trendKeys.data?.length ? (
              <p className="text-sm text-muted-foreground">{t('noSamples')}</p>
            ) : null}
            {(trendKeys.data ?? []).map((key) => (
              <TrendChart key={key} seriesKey={key} />
            ))}
          </CardContent>
        </Card>
      </HelpTip>
    </div>
  );
}

function TrendChart({ seriesKey }: { seriesKey: string }) {
  const query = useQuery({
    queryKey: ['trend', seriesKey],
    queryFn: async () => {
      const rows = await apiGet<unknown>(
        `/trends/${encodeURIComponent(seriesKey)}?minutes=30`,
      );
      return Array.isArray(rows) ? (rows as TrendPoint[]) : [];
    },
    refetchInterval: 3000,
  });
  const points = query.data ?? [];
  if (points.length === 0) return <p>No samples yet</p>;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = min === max;
  const span = flat ? 1 : max - min;
  const width = 320;
  const height = 220;
  const plotLeft = 44;
  const plotRight = 8;
  const plotTop = 16;
  const plotBottom = 16;
  const coords = values
    .map((value, index) => {
      const x =
        plotLeft +
        (index / Math.max(values.length - 1, 1)) *
          (width - plotLeft - plotRight);
      const y = flat
        ? height / 2
        : plotTop +
          (1 - (value - min) / span) * (height - plotTop - plotBottom);
      return `${x},${y}`;
    })
    .join(' ');
  const last = values[values.length - 1];
  const unit = /speedPct/i.test(seriesKey) ? ' %' : '';
  return (
    <figure>
      <figcaption className="mb-1 text-sm">
        {seriesKey}: {last}
        {unit}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="220"
        role="img"
        aria-label={`${seriesKey} from ${min} to ${max}`}
      >
        <text x="4" y="20" fontSize="11" fill="currentColor">
          {max}
        </text>
        <text x="4" y={height - 8} fontSize="11" fill="currentColor">
          {min}
        </text>
        <polyline
          fill="none"
          stroke="currentColor"
          className="text-emerald-500"
          strokeWidth="2"
          points={coords}
        />
      </svg>
    </figure>
  );
}
