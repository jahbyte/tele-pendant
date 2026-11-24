import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QrCode, ScanLine } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { useT } from '../lib/i18n';
import { HelpTip } from '../lib/tour';
import { PageSpinner } from '@/components/page-spinner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CameraAccessAlert } from '@/components/device-camera-panel';
import { useDeviceCamera } from '@/lib/use-device-camera';
import { isSupervisorOrAdmin } from '@/lib/user-session';
import { toastErr, toastOk } from '@/lib/toast';

export function MediaPage() {
  const navigate = useNavigate();
  const { t } = useT();
  const [scanFeedback, setScanFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const mayEditCodes = isSupervisorOrAdmin();
  const [manualCode, setManualCode] = useState('TP-CRANE-DEMO-01');
  const canResolveManual = manualCode.trim().length > 0;

  const camera = useQuery({
    queryKey: ['camera-config'],
    queryFn: () =>
      apiGet<{
        deviceCameraEnabled: boolean;
        rtspUrl: string | null;
        notes: string;
      }>('/media/camera'),
  });

  const codes = useQuery({
    queryKey: ['scan-codes'],
    queryFn: () =>
      apiGet<Array<{ code: string; label: string; routeHint?: string | null }>>(
        '/media/codes',
      ),
  });

  const waiting = camera.isLoading || codes.isLoading;
  const deviceCamera = useDeviceCamera({
    enabled: !waiting,
    facingMode: 'environment',
  });

  async function resolveCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) {
      setScanFeedback({ ok: false, text: t('enterCode') });
      return;
    }
    setScanFeedback(null);
    try {
      const row = await apiPost<{
        code: string;
        label: string;
        routeHint?: string | null;
      }>('/media/codes/resolve', { code: trimmed });
      const text = `Resolved: ${row.label} (${row.code})`;
      setScanFeedback({ ok: true, text });
      toastOk(row.label);
      if (row.routeHint) {
        navigate(row.routeHint);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Resolve failed';
      setScanFeedback({ ok: false, text: message });
      toastErr(message);
    }
  }

  async function scanFrame() {
    setScanBusy(true);
    try {
      await scanFrameInner();
    } finally {
      setScanBusy(false);
    }
  }

  async function scanFrameInner() {
    if (deviceCamera.camError) {
      return;
    }
    const video = deviceCamera.videoRef.current;
    if (!video) {
      setScanFeedback({
        ok: false,
        text: 'No camera video — allow the camera in site settings, then reload this page.',
      });
      return;
    }
    const Detector = (
      window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => {
          detect: (
            source: HTMLVideoElement,
          ) => Promise<Array<{ rawValue: string }>>;
        };
      }
    ).BarcodeDetector;
    if (Detector) {
      const detector = new Detector({
        formats: ['qr_code', 'code_128', 'ean_13'],
      });
      const codesFound = await detector.detect(video);
      const value = codesFound[0]?.rawValue;
      if (!value) {
        setScanFeedback({
          ok: false,
          text: 'No code in frame — hold a registered QR steady and try again.',
        });
        return;
      }
      await resolveCode(value);
      return;
    }
    if (video.readyState < 2) {
      setScanFeedback({
        ok: false,
        text: 'Camera still starting — wait a moment and scan again.',
      });
      return;
    }
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeOnceFromVideoElement(video);
      const value = result.getText();
      if (!value) {
        setScanFeedback({
          ok: false,
          text: 'No code in frame — hold a registered QR steady and try again.',
        });
        return;
      }
      await resolveCode(value);
    } catch {
      setScanFeedback({
        ok: false,
        text: 'No code in frame — use a QR whose text matches a registered code (see list). Safari and Firefox use ZXing; Chrome uses the built-in detector.',
      });
    }
  }

  const scanFeedbackAlert = scanFeedback ? (
    <Alert variant={scanFeedback.ok ? 'default' : 'destructive'}>
      <AlertDescription>{scanFeedback.text}</AlertDescription>
    </Alert>
  ) : null;

  if (waiting) {
    return <PageSpinner label={t('mediaTitle')} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('mediaTitle')}</h2>
        <p className="text-sm text-muted-foreground">{camera.data?.notes}</p>
        {camera.data?.rtspUrl ? (
          <p className="text-xs text-muted-foreground">
            Plant camera configured
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Voice Listen is in the top header — hold Enable on Operator, then tap
          the mic.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <HelpTip id="tour.media.camera">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanLine className="size-4" /> Device camera
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {deviceCamera.camError ? (
                <CameraAccessAlert {...deviceCamera} />
              ) : (
                <video
                  ref={deviceCamera.videoRef}
                  className="aspect-video w-full rounded-md border bg-black object-cover"
                  autoPlay
                  playsInline
                  muted
                />
              )}
              <Button
                type="button"
                loading={scanBusy}
                onClick={() => void scanFrame()}
              >
                <QrCode />
                Scan QR / barcode in frame
              </Button>
              {scanFeedbackAlert}
            </CardContent>
          </Card>
        </HelpTip>

        <HelpTip id="tour.media.qr">
          <Card>
            <CardHeader>
              <CardTitle>Manual / known codes</CardTitle>
              <CardDescription>
                Demo payloads: <strong>TP-CRANE-DEMO-01</strong>,{' '}
                <strong>TP-OPS</strong>.
                {mayEditCodes ? (
                  <>
                    {' '}
                    <Link
                      to="/admin?section=codes"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Add or edit codes in Config
                    </Link>
                    .
                  </>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                />
              </div>
              <Button
                type="button"
                disabled={!canResolveManual}
                onClick={() => void resolveCode(manualCode)}
              >
                Resolve
              </Button>
              <ul className="space-y-1 text-sm">
                {(codes.data ?? []).map((c) => (
                  <li key={c.code}>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => void resolveCode(c.code)}
                    >
                      {c.code}
                    </Button>{' '}
                    — {c.label}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </HelpTip>
      </div>
    </div>
  );
}
