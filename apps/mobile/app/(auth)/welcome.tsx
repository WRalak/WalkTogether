import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';

export default function Welcome() {
  return (
    <SafeAreaView className="flex-1 bg-primary">
      <View className="flex-1 justify-between px-6 pb-6 pt-16">
        <View>
          <View className="h-14 w-14 items-center justify-center rounded-full bg-white/20">
            <Text className="text-lg font-extrabold text-white">WT</Text>
          </View>
          <Text accessibilityRole="header" className="mt-8 text-5xl font-extrabold leading-tight text-white">
            Every step is better together.
          </Text>
          <Text className="mt-4 text-lg text-white/85">Track walks and runs, join clubs, and show up for each other.</Text>
        </View>
        <View className="gap-3">
          <Link href="/(auth)/phone" asChild>
            <Button title="Continue with phone number" variant="secondary" />
          </Link>
          <Link href="/(auth)/register" asChild>
            <Button title="Sign up with email" className="border border-white/40" />
          </Link>
          <Link href="/(auth)/login" asChild>
            <Button title="I already have an account" variant="ghost" textClassName="text-white" />
          </Link>
          <Text className="mt-2 text-center text-xs text-white/70">By continuing you agree to our Terms and Privacy Policy.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
