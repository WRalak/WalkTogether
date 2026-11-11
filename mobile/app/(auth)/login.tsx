import { useState } from 'react';
import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button, ErrorState, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { loginSchema } from '@/features/auth-schemas';
import { api } from '@/services/api';
import { deviceInfo } from '@/services/device';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

export default function Login() {
  const loadUser = useAuthStore((s) => s.loadUser);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.auth.login({ ...values, device: await deviceInfo() });
      await loadUser();
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <Screen edges={[]}>
      <Text accessibilityRole="header" className="mb-6 text-3xl font-extrabold text-ink">
        Welcome back
      </Text>
      {error && (
        <View className="mb-4">
          <ErrorState message={error} />
        </View>
      )}
      <Controller control={control} name="email" render={({ field }) => <TextField label="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={formState.errors.email?.message} />} />
      <Controller control={control} name="password" render={({ field }) => <TextField label="Password" secureTextEntry autoComplete="current-password" textContentType="password" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={formState.errors.password?.message} />} />
      <Button title="Sign in" onPress={onSubmit} loading={formState.isSubmitting} />
      <Link href="/(auth)/forgot-password" asChild>
        <Button title="Forgot password?" variant="ghost" className="mt-2" />
      </Link>
    </Screen>
  );
}
