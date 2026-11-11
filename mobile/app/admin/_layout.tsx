import { Stack } from 'expo-router';

/** Club administration lives inside the member app; options per screen set titles. */
export default function AdminLayout() {
  return <Stack screenOptions={{ headerShown: true, headerTintColor: '#127a50', headerBackTitle: 'Back', contentStyle: { backgroundColor: '#f4f7f5' } }} />;
}
