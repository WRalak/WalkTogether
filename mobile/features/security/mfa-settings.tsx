import { useState } from 'react';
import { Linking, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { totpCodeSchema } from '@walktogether/validation';
import { Badge, Button, Card, Loading, TextField } from '@/components/ui';
import { confirm, Notice } from '@/components/admin';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  return (
    <Card className="mt-3 border-primary">
      <Text className="font-semibold text-ink">Save your recovery codes</Text>
      <Text className="mt-1 text-sm text-ink-muted">Each code signs you in once if you lose your phone. Store them somewhere safe — they won’t be shown again.</Text>
      <Text selectable className="mt-3 font-mono text-base leading-7 text-ink">
        {text}
      </Text>
      <View className="mt-3 flex-row gap-2">
        <Button title="Copy" variant="outline" className="flex-1" onPress={() => void Clipboard.setStringAsync(text)} />
        <Button title="Share" variant="outline" className="flex-1" onPress={() => void Share.share({ message: `WalkTogether recovery codes\n${text}` })} />
      </View>
      <Button title="I’ve saved them" className="mt-2" onPress={onDone} />
    </Card>
  );
}

/** Optional two-step verification (authenticator app) for the member's account. */
export function MfaSettings() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const status = useQuery({ queryKey: ['mfa-status'], queryFn: () => api.auth.mfa.status() });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'disable' | 'regenerate'>('idle');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['mfa-status'] });
  const validCode = () => {
    const p = totpCodeSchema.safeParse(code);
    if (!p.success) throw new Error(p.error.issues[0]?.message ?? 'Enter the 6-digit code');
    return p.data;
  };
  const reset = () => {
    setCode('');
    setPassword('');
    setMode('idle');
  };

  const start = useMutation({ mutationFn: () => api.auth.mfa.setup(), onMutate: () => setError(null), onSuccess: setSetup, onError: (e) => setError(errorMessage(e)) });
  const enable = useMutation({
    mutationFn: () => api.auth.mfa.enable(validCode()),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setSetup(null);
      setCodes(r.recoveryCodes);
      reset();
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const disable = useMutation({
    mutationFn: () => api.auth.mfa.disable({ code: validCode(), password: password || undefined }),
    onMutate: () => setError(null),
    onSuccess: () => {
      reset();
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const regenerate = useMutation({
    mutationFn: () => api.auth.mfa.regenerateRecoveryCodes(validCode()),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      reset();
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (status.isLoading) return <Loading />;
  const s = status.data;

  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-bold text-ink">Two-step verification</Text>
        <Badge tone={s?.enabled ? 'primary' : 'neutral'} label={s?.enabled ? 'On' : 'Off'} />
      </View>
      <Text className="mt-1 text-sm text-ink-muted">Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) whenever you sign in.</Text>
      {error ? (
        <View className="mt-3">
          <Notice>{error}</Notice>
        </View>
      ) : null}
      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

      {!s?.enabled && !setup && <Button title="Turn on" className="mt-3" loading={start.isPending} onPress={() => start.mutate()} />}
      {!s?.enabled && setup && (
        <View className="mt-3">
          <Text className="text-sm text-ink">1. Scan this code with your authenticator app on another device, or add the key manually:</Text>
          <View className="my-3 items-center rounded-2xl bg-white p-4">
            <QRCode value={setup.otpauthUrl} size={180} />
          </View>
          <Text selectable className="text-center font-mono text-sm text-ink">
            {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
          </Text>
          <View className="mt-2 flex-row gap-2">
            <Button title="Copy key" variant="outline" className="flex-1" onPress={() => void Clipboard.setStringAsync(setup.secret)} />
            <Button
              title="Open app"
              variant="outline"
              className="flex-1"
              onPress={() => void Linking.openURL(setup.otpauthUrl).catch(() => setError('No authenticator app found on this phone.'))}
            />
          </View>
          <Text className="mt-4 text-sm text-ink">2. Enter the 6-digit code it shows:</Text>
          <TextField label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
          <Button title="Turn on two-step verification" loading={enable.isPending} onPress={() => enable.mutate()} />
          <Button title="Cancel" variant="ghost" onPress={() => setSetup(null)} />
        </View>
      )}

      {s?.enabled && (
        <View className="mt-3">
          <Text className="text-sm text-ink-muted">{s.recoveryCodesRemaining} recovery codes left.</Text>
          {mode === 'idle' ? (
            <View className="mt-3 flex-row gap-2">
              <Button title="New recovery codes" variant="outline" className="flex-1" onPress={() => setMode('regenerate')} />
              <Button title="Turn off" variant="outline" className="flex-1" onPress={() => setMode('disable')} />
            </View>
          ) : (
            <View className="mt-3">
              <TextField
                label="Code from your authenticator app"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
              />
              {mode === 'disable' && user?.email ? (
                <TextField label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
              ) : null}
              {mode === 'disable' ? (
                <Button
                  title="Turn off two-step verification"
                  variant="danger"
                  loading={disable.isPending}
                  onPress={() => confirm('Turn off two-step verification?', 'Your account will be protected by your password only.', () => disable.mutate(), 'Turn off')}
                />
              ) : (
                <Button title="Create new codes" loading={regenerate.isPending} onPress={() => regenerate.mutate()} />
              )}
              <Button title="Cancel" variant="ghost" onPress={reset} />
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
