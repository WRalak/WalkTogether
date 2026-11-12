import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { usernameSchema } from '@walktogether/validation';
import { Button, ErrorState, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { phoneFormSchema } from '@/features/auth-schemas';
import { api } from '@/services/api';
import { deviceInfo } from '@/services/device';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

type Step = { kind: 'phone' } | { kind: 'code'; phone: string } | { kind: 'profile'; registrationToken: string };

/** Phone-first sign-in / sign-up with an SMS one-time code. */
export default function PhoneAuth() {
  const loadUser = useAuthStore((s) => s.loadUser);
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'phone' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Text accessibilityRole="header" className="mb-6 text-3xl font-extrabold text-ink">
        {step.kind === 'profile' ? 'Almost there' : 'Continue with phone'}
      </Text>
      {error && (
        <View className="mb-4">
          <ErrorState message={error} />
        </View>
      )}

      {step.kind === 'phone' && (
        <>
          <TextField
            label="Phone number"
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="0712 345 678"
            value={phone}
            onChangeText={setPhone}
            hint="We’ll send you a 6-digit code by SMS"
          />
          <Button
            title="Send code"
            loading={busy}
            onPress={() =>
              run(async () => {
                const parsed = phoneFormSchema.safeParse({ phone });
                if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid phone number');
                await api.auth.requestPhoneOtp({ phone: parsed.data.phone, purpose: 'LOGIN' });
                setStep({ kind: 'code', phone: parsed.data.phone });
              })
            }
          />
        </>
      )}

      {step.kind === 'code' && (
        <>
          <Text className="mb-4 text-ink-muted">Enter the code we sent to {step.phone}.</Text>
          <TextField
            label="Verification code"
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
          />
          <Button
            title="Verify"
            disabled={code.length !== 6}
            loading={busy}
            onPress={() =>
              run(async () => {
                const res = await api.auth.verifyPhoneOtp({ phone: step.phone, code, purpose: 'LOGIN', device: await deviceInfo() });
                if ('status' in res && res.status === 'authenticated') await loadUser();
                else if ('status' in res && res.status === 'mfa_required') router.push({ pathname: '/(auth)/mfa', params: { mfaToken: res.mfaToken } });
                else if ('status' in res && res.status === 'registration_required') setStep({ kind: 'profile', registrationToken: res.registrationToken });
              })
            }
          />
          <Button title="Use a different number" variant="ghost" className="mt-2" onPress={() => setStep({ kind: 'phone' })} />
        </>
      )}

      {step.kind === 'profile' && (
        <>
          <TextField label="Your name" value={displayName} onChangeText={setDisplayName} autoComplete="name" />
          <TextField label="Username" autoCapitalize="none" value={username} onChangeText={setUsername} hint="Letters, numbers, dots and underscores" />
          <Text className="mb-4 text-xs text-ink-muted">By creating an account you agree to the Terms and Privacy Policy.</Text>
          <Button
            title="Create account"
            loading={busy}
            onPress={() =>
              run(async () => {
                const u = usernameSchema.safeParse(username);
                if (!u.success) throw new Error(u.error.issues[0]?.message);
                await api.auth.completePhoneRegistration({
                  registrationToken: step.registrationToken,
                  username: u.data,
                  displayName: displayName.trim(),
                  acceptTerms: true,
                  device: await deviceInfo(),
                });
                await loadUser();
              })
            }
          />
        </>
      )}
    </Screen>
  );
}
