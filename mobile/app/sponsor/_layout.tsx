import { Stack } from 'expo-router';

export default function SponsorLayout() {
  return <Stack screenOptions={{ headerShown: true, headerTintColor: '#127a50', headerBackTitle: 'Back', contentStyle: { backgroundColor: '#f4f7f5' } }} />;
}
