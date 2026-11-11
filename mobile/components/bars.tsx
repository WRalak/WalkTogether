import { Text, View } from 'react-native';

/** Simple accessible monthly bar chart (one series, labelled values). */
export function Bars({ data, label }: { data: { month: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View accessible accessibilityLabel={`${label}: ${data.map((d) => `${d.month} ${d.value}`).join(', ')}`} className="mb-6">
      <Text className="mb-2 text-sm font-semibold text-ink">{label}</Text>
      <View className="h-36 flex-row items-end gap-1">
        {data.map((d) => (
          <View key={d.month} className="flex-1 items-center justify-end" style={{ height: '100%' }}>
            {d.value > 0 && <Text className="mb-0.5 text-[10px] text-ink-muted">{d.value}</Text>}
            <View className="w-full rounded-t bg-primary" style={{ height: `${(d.value / max) * 80}%`, minHeight: d.value ? 4 : 0 }} />
            <Text className="mt-1 text-[10px] text-ink-muted">{d.month.slice(5)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
