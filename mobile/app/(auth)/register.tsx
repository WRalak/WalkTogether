import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button, ErrorState, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { registerFormSchema } from '@/features/auth-schemas';
import { api } from '@/services/api';
import { deviceInfo } from '@/services/device';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

type Values = z.infer<typeof registerFormSchema>;

export default function Register() {
  const loadUser = useAuthStore((s) => s.loadUser);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { displayName: '', username: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!accepted) return setError('Please accept the Terms and Privacy Policy to continue.');
    setError(null);
    try {
      await api.auth.register({ ...values, acceptTerms: true, device: await deviceInfo() });
      await loadUser();
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  const field = (name: keyof Values, label: string, props: object = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field: f }) => <TextField label={label} value={f.value} onChangeText={f.onChange} onBlur={f.onBlur} error={formState.errors[name]?.message} {...props} />}
    />
  );

  return (
    <Screen edges={[]}>
      <Text accessibilityRole="header" className="mb-6 text-3xl font-extrabold text-ink">
        Create your account
      </Text>
      {error && (
        <View className="mb-4">
          <ErrorState message={error} />
        </View>
      )}
      {field('displayName', 'Your name', { autoComplete: 'name', textContentType: 'name' })}
      {field('username', 'Username', { autoCapitalize: 'none', autoComplete: 'username', hint: 'Letters, numbers, dots and underscores' })}
      {field('email', 'Email', { autoCapitalize: 'none', keyboardType: 'email-address', autoComplete: 'email' })}
      {field('password', 'Password', { secureTextEntry: true, autoComplete: 'new-password', hint: 'At least 10 characters with letters and numbers' })}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => setAccepted((a) => !a)} className="mb-5 flex-row items-start gap-3">
        <View className={`mt-0.5 h-6 w-6 items-center justify-center rounded-md border-2 ${accepted ? 'border-primary bg-primary' : 'border-line bg-surface'}`}>
          {accepted && <Text className="font-bold text-white">✓</Text>}
        </View>
        <Text className="flex-1 text-sm text-ink-muted">
          I agree to the{' '}
          <Text className="font-semibold text-primary" onPress={() => void Linking.openURL('https://walktogether.app/terms')}>
            Terms
          </Text>{' '}
          and{' '}
          <Text className="font-semibold text-primary" onPress={() => void Linking.openURL('https://walktogether.app/privacy')}>
            Privacy Policy
          </Text>
        </Text>
      </Pressable>
      <Button title="Create account" onPress={onSubmit} loading={formState.isSubmitting} />
    </Screen>
  );
}
