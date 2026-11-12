import { useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { recoveryCodeSchema, totpCodeSchema } from '@walktogether/validation';
import { Button, ErrorState, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

/** Second sign-in step for members who turned on two-step verification. */
export default function MfaChallenge() {
  const { mfaToken } = useLocalSearchParams<{ mfaToken: string }>();
  const router = useRouter();
  const loadUser = useAuthStore((s) => s.loadUser);
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const parsed = (useRecovery ? recoveryCodeSchema : totpCodeSchema).safeParse(value);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the code');
    setBusy(true);
    try {
      await api.auth.verifyMfa(useRecovery ? { mfaToken, recoveryCode: parsed.data } : { mfaToken, code: parsed.data });
      await loadUser();
    } catch (e) {
      // An expired challenge (5 minutes) means starting again from the password screen.
      if (e instanceof Error && /expired|Invalid token/i.test(e.message)) router.replace('/(auth)/login');
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Text accessibilityRole="header" className="mb-2 text-3xl font-extrabold text-ink">
        Two-step verification
      </Text>
      <Text className="mb-6 text-base text-ink-muted">
        {useRecovery ? 'Enter one of the recovery codes you saved when you turned on two-step verification. Each code works once.' : 'Enter the 6-digit code from your authenticator app.'}
      </Text>
      {error ? <ErrorState message={error} /> : null}
      <TextField
        label={useRecovery ? 'Recovery code' : 'Authentication code'}
        value={value}
        onChangeText={setValue}
        autoFocus
        autoCapitalize="none"
        autoComplete={useRecovery ? 'off' : 'one-time-code'}
        textContentType="oneTimeCode"
        keyboardType={useRecovery ? 'default' : 'number-pad'}
        maxLength={useRecovery ? 11 : 6}
        placeholder={useRecovery ? 'abcde-12345' : '123456'}
        onSubmitEditing={() => void submit()}
      />
      <Button title="Verify" loading={busy} onPress={() => void submit()} />
      <Button
        title={useRecovery ? 'Use my authenticator app instead' : 'Use a recovery code'}
        variant="ghost"
        className="mt-2"
        onPress={() => {
          setUseRecovery((r) => !r);
          setValue('');
          setError(null);
        }}
      />
    </Screen>
  );
}
