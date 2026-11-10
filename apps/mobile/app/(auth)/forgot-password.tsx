import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, ErrorState, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { emailSchema } from '@walktogether/validation';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError('Enter a valid email address');
    setError(null);
    setState('sending');
    try {
      await api.auth.forgotPassword(parsed.data);
      setState('sent');
    } catch (e) {
      setError(errorMessage(e));
      setState('idle');
    }
  };

  return (
    <Screen edges={[]}>
      <Text accessibilityRole="header" className="mb-2 text-3xl font-extrabold text-ink">
        Reset your password
      </Text>
      <Text className="mb-6 text-ink-muted">We’ll email you a link to choose a new password.</Text>
      {state === 'sent' ? (
        <Card>
          <Text className="text-base text-ink">If an account exists for {email}, a reset link is on its way. The link expires in 30 minutes.</Text>
        </Card>
      ) : (
        <>
          {error && <ErrorState message={error} />}
          <TextField label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Button title="Send reset link" onPress={submit} loading={state === 'sending'} />
        </>
      )}
    </Screen>
  );
}
