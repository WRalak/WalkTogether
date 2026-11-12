import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  edges = ['top'] as Edge[],
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
}) {
  return (
    <SafeAreaView edges={edges} className="flex-1 bg-surface-muted">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        {scroll ? (
          <ScrollView
            contentContainerClassName="px-5 pb-10 pt-4"
            keyboardShouldPersistTaps="handled"
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor="#127a50" colors={['#127a50']} /> : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          <View className="flex-1 px-5 pt-4">{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
