import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: true, headerTitle: '', headerShadowVisible: false, headerTintColor: '#127a50', headerStyle: { backgroundColor: '#f4f7f5' } }}>
    <Stack.Screen name="welcome" options={{ headerShown: false }} />
  </Stack>;
}
