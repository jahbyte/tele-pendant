import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { QrCode, Scan } from 'lucide-react-native';
import { canManageScanCodes, type UserRole } from '@tele-pendant/shared';
import { apiGet, apiPost } from '../api';
import { useLocale } from '../locale';
import type { RootDrawerParamList } from '../navigation';
import { HelpTip } from '../tour';
import { getStoredUserRole } from '../user-session';
import {
  Btn,
  BtnText,
  Field,
  Hint,
  OkText,
  Section,
  showErrorAlert,
  showErrorFrom,
} from '../ui';

const CAMERA_PREVIEW_HEIGHT = 220;

const cameraPreviewStyle = StyleSheet.create({
  frame: {
    width: Dimensions.get('window').width - 32,
    height: CAMERA_PREVIEW_HEIGHT,
    alignSelf: 'center',
    marginBottom: 12,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: {
    ...StyleSheet.absoluteFill,
  },
});

type ScanCodeRow = {
  code: string;
  label: string;
  routeHint?: string | null;
};

function routeHintToTarget(hint: string): {
  kind: 'tab' | 'drawer';
  name: string;
} | null {
  const path = hint.replace(/^\//, '').split('?')[0]?.toLowerCase() ?? '';
  if (
    path === 'operator' ||
    path === 'ops' ||
    path === 'media' ||
    path === 'assistant'
  ) {
    return { kind: 'tab', name: path };
  }
  if (
    path === 'face' ||
    path === 'config' ||
    path === 'audit' ||
    path === 'admin'
  ) {
    return { kind: 'drawer', name: path === 'admin' ? 'config' : path };
  }
  return null;
}

export function MediaScreen({ token }: { token: string }) {
  const { t } = useLocale();
  const isFocused = useIsFocused();
  const navigation = useNavigation<DrawerNavigationProp<RootDrawerParamList>>();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const lastCode = useRef('');
  const [permission, requestPermission] = useCameraPermissions();

  const codes = useQuery({
    queryKey: ['scan-codes', token],
    queryFn: () => apiGet<ScanCodeRow[]>('/media/codes', token),
  });

  useEffect(() => {
    void getStoredUserRole().then(setUserRole);
  }, [token]);

  useEffect(() => {
    if (!isFocused && scanning) setScanning(false);
  }, [isFocused, scanning]);

  function followRouteHint(hint?: string | null) {
    if (!hint?.trim()) return;
    const target = routeHintToTarget(hint.trim());
    if (!target) return;
    if (target.kind === 'tab') {
      navigation.navigate('MainTabs', {
        screen: target.name as 'operator' | 'ops' | 'media' | 'assistant',
      });
      return;
    }
    navigation.navigate(target.name as 'face' | 'config' | 'audit');
  }

  async function resolve(value: string) {
    setResult(null);
    try {
      const row = await apiPost<{ label: string; routeHint?: string | null }>(
        '/media/codes/resolve',
        { code: value },
        token,
      );
      setResult(`Resolved: ${row.label}${row.routeHint ? ` (${value})` : ''}`);
      followRouteHint(row.routeHint);
    } catch (err) {
      showErrorFrom(err, 'Resolve failed', 'Media');
    }
  }

  async function requestCameraAccess(): Promise<boolean> {
    const result = await requestPermission();
    if (result.granted) {
      setCameraBlocked(false);
      return true;
    }
    const msg =
      result.canAskAgain === false
        ? t('cameraPermissionBlocked')
        : t('cameraPermissionDenied');
    setCameraBlocked(result.canAskAgain === false);
    showErrorAlert(msg, 'Camera');
    return false;
  }

  async function toggleScanning() {
    if (scanning) {
      setScanning(false);
      return;
    }
    const ok = await requestCameraAccess();
    if (ok) setScanning(true);
  }

  const canEditCodes = userRole != null && canManageScanCodes(userRole);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-4 pb-12"
    >
      <HelpTip id="tour.media.qr">
        <>
          <Section>{t('qrTitle')}</Section>
          <Hint>
            Type a known code (e.g. TP-P03A21) or pick one below, then Resolve.
          </Hint>
          <Field label="Code" value={code} onChangeText={setCode} />
          <Btn disabled={!code.trim()} onPress={() => void resolve(code)}>
            <QrCode size={16} color="#041018" />
            <BtnText>Resolve</BtnText>
          </Btn>
          {(codes.data ?? []).length > 0 ? (
            <View className="mt-3 gap-1.5">
              <Text className="text-sm font-semibold text-foreground">
                Known codes
              </Text>
              {(codes.data ?? []).map((row) => (
                <Pressable
                  key={row.code}
                  accessibilityRole="button"
                  className="min-h-[44px] rounded-md border border-border bg-card px-3 py-2"
                  onPress={() => {
                    setCode(row.code);
                    void resolve(row.code);
                  }}
                >
                  <Text className="text-sm font-medium text-foreground">
                    {row.label}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {row.code}
                    {row.routeHint ? ` → ${row.routeHint}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {canEditCodes ? (
            <Pressable
              accessibilityRole="button"
              className="mt-2"
              onPress={() => navigation.navigate('config')}
            >
              <Text className="text-sm text-primary">
                Add or edit codes in Config
              </Text>
            </Pressable>
          ) : null}
        </>
      </HelpTip>
      <HelpTip id="tour.media.camera">
        <>
          {scanning && permission?.granted && isFocused ? (
            <View style={cameraPreviewStyle.frame} collapsable={false}>
              <CameraView
                style={cameraPreviewStyle.camera}
                facing="back"
                active={scanning && isFocused}
                barcodeScannerSettings={{
                  barcodeTypes: ['qr', 'code128', 'ean13'],
                }}
                onBarcodeScanned={({ data }) => {
                  if (data === lastCode.current) return;
                  lastCode.current = data;
                  setCode(data);
                  void resolve(data);
                }}
                onMountError={(event) => {
                  showErrorAlert(
                    event.message || 'Camera failed to start',
                    'Camera',
                  );
                  setScanning(false);
                }}
              />
            </View>
          ) : null}
          {cameraBlocked || (permission && !permission.granted) ? (
            <View className="mb-3 gap-2">
              {permission?.canAskAgain === false ? (
                <Btn onPress={() => void Linking.openSettings()}>
                  <Scan size={16} color="#041018" />
                  <BtnText>{t('openAppSettings')}</BtnText>
                </Btn>
              ) : (
                <Btn
                  onPress={() =>
                    void requestCameraAccess().then(
                      (ok) => ok && setScanning(true),
                    )
                  }
                >
                  <Scan size={16} color="#041018" />
                  <BtnText>{t('retryCamera')}</BtnText>
                </Btn>
              )}
            </View>
          ) : null}
          <Btn onPress={() => void toggleScanning()}>
            <Scan size={16} color="#041018" />
            <BtnText>{scanning ? t('stopCamera') : t('scanCamera')}</BtnText>
          </Btn>
        </>
      </HelpTip>
      {result ? <OkText>{result}</OkText> : null}
      <Section>{t('voice')}</Section>
      <Hint>
        Voice Listen is in the top header — hold Enable on Operator, then tap
        the mic. {t('phoneVoiceHint')}
      </Hint>
    </ScrollView>
  );
}
