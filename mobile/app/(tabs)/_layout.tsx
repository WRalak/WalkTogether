import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#127a50', tabBarInactiveTintColor: '#7b8a83', tabBarLabelStyle: { fontSize: 12, fontWeight: '600' }, tabBarStyle: { minHeight: 60 } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore', tabBarIcon: icon('compass') }} />
      <Tabs.Screen name="record" options={{ title: 'Record', tabBarIcon: icon('radio-button-on') }} />
      <Tabs.Screen name="community" options={{ title: 'Community', tabBarIcon: icon('people') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle') }} />
    </Tabs>
  );
}
