import '../global.css';
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/auth';
// Defines the background location task at module scope (required by TaskManager).
import { startTrackingServices } from '@/services/tracking';

void SplashScreen.preventAutoHideAsync();

/** Redirects between the signed-out (auth) group and the app based on session state. */
function useProtectedRoutes() {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (status === 'booting') return;
    const inAuth = segments[0] === '(auth)';
    if (status === 'signedOut' && !inAuth) router.replace('/(auth)/welcome');
    if (status === 'signedIn' && inAuth) router.replace('/(tabs)');
  }, [status, segments, router]);
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    if (status !== 'booting') void SplashScreen.hideAsync();
    if (status === 'signedIn') startTrackingServices();
  }, [status]);
  useProtectedRoutes();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f4f7f5' } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="clubs/[slug]" options={{ headerShown: true, title: '', headerBackTitle: 'Back', headerTintColor: '#127a50' }} />
          <Stack.Screen name="activities/index" options={{ headerShown: true, title: 'Your activities', headerTintColor: '#127a50' }} />
          <Stack.Screen name="activities/[id]" options={{ headerShown: true, title: 'Activity', headerTintColor: '#127a50' }} />
          <Stack.Screen name="activities/summary" options={{ headerShown: true, title: 'Save activity', headerTintColor: '#127a50', gestureEnabled: false }} />
          <Stack.Screen name="settings/privacy" options={{ headerShown: true, title: 'Privacy', headerTintColor: '#127a50' }} />
          <Stack.Screen name="settings/security" options={{ headerShown: true, title: 'Security', headerTintColor: '#127a50' }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
