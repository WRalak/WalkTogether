import { Text } from 'react-native';
import { Link } from 'expo-router';
import { Button } from '@/components/ui';
import { Screen } from '@/components/screen';

export default function NotFound() {
  return (
    <Screen>
      <Text className="mb-4 text-2xl font-bold text-ink">Page not found</Text>
      <Link href="/" asChild>
        <Button title="Go home" />
      </Link>
    </Screen>
  );
}
