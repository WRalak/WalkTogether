import { Text } from 'react-native';
import { Link } from 'expo-router';
import { Button, Card } from '@/components/ui';
import { Screen } from '@/components/screen';

export default function Community() {
  return (
    <Screen>
      <Text accessibilityRole="header" className="text-3xl font-extrabold text-ink">
        Community
      </Text>
      <Card className="mt-5">
        <Text className="text-lg font-bold text-ink">Your community feed is on its way</Text>
        <Text className="mt-2 text-ink-muted">Soon you’ll see activities from people you follow and updates from your clubs, with likes, comments and messages.</Text>
        <Link href="/(tabs)/explore" asChild>
          <Button title="Join a club in the meantime" variant="secondary" className="mt-4" />
        </Link>
      </Card>
    </Screen>
  );
}
