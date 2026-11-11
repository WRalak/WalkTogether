import { useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { Link, type Href } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

/** Native confirmation dialog for destructive or consequential admin actions. */
export function confirm(title: string, message: string, onConfirm: () => void, action = 'Confirm', destructive = true) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

export function NavRow({ href, label, detail, badge }: { href: Href; label: string; detail?: string; badge?: number }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" className="flex-row items-center justify-between border-b border-line py-4 active:opacity-70">
        <View className="flex-1">
          <Text className="text-base font-medium text-ink">{label}</Text>
          {detail ? <Text className="text-sm text-ink-muted">{detail}</Text> : null}
        </View>
        {badge ? (
          <Text accessibilityLabel={`${badge} pending`} className="mr-2 overflow-hidden rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">
            {badge}
          </Text>
        ) : null}
        <Text className="text-lg text-ink-muted">›</Text>
      </Pressable>
    </Link>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="tablist" className="mb-4 flex-row rounded-2xl bg-surface p-1">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)} className={`flex-1 items-center rounded-xl py-2.5 ${on ? 'bg-primary' : ''}`}>
            <Text className={`text-sm font-semibold ${on ? 'text-white' : 'text-ink-muted'}`}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Single-choice chips (React Native has no <select>). */
export function Chips<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View className="mb-4">
      {label ? <Text className="mb-1.5 text-sm font-medium text-ink">{label}</Text> : null}
      <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(o.key)}
              className={`rounded-full border px-3.5 py-2 ${on ? 'border-primary bg-primary-soft' : 'border-line bg-surface'}`}
            >
              <Text className={`text-sm font-medium ${on ? 'text-primary' : 'text-ink'}`}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <View className="min-w-[46%] flex-1 rounded-2xl border border-line bg-surface p-4">
      <Text className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</Text>
      <Text className="mt-1 text-2xl font-extrabold text-ink">{value}</Text>
      {hint ? <Text className="mt-0.5 text-xs text-ink-muted">{hint}</Text> : null}
    </View>
  );
}

export function Notice({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const cls = tone === 'error' ? 'bg-red-50 text-danger' : tone === 'success' ? 'bg-primary-soft text-primary' : 'bg-surface text-ink';
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole={tone === 'error' ? 'alert' : undefined} className={`mb-4 overflow-hidden rounded-2xl px-4 py-3 text-sm ${cls}`}>
      {children}
    </Text>
  );
}

export function NoPermission({ what }: { what: string }) {
  return <Notice>You don’t have permission to {what} in this club.</Notice>;
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} className="mb-4 flex-row items-center justify-between">
      <View className="flex-1 pr-4">
        <Text className="text-base text-ink">{label}</Text>
        {hint ? <Text className="text-xs text-ink-muted">{hint}</Text> : null}
      </View>
      <View className={`h-7 w-12 justify-center rounded-full px-1 ${value ? 'bg-primary' : 'bg-line'}`}>
        <View className={`h-5 w-5 rounded-full bg-white ${value ? 'self-end' : 'self-start'}`} />
      </View>
    </Pressable>
  );
}

/** Date + time picker field. Android shows date then time dialogs; iOS shows the inline compact picker. */
export function DateTimeField({ label, value, onChange, minimumDate }: { label: string; value: Date; onChange: (d: Date) => void; minimumDate?: Date }) {
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const onPick = (e: DateTimePickerEvent, d?: Date) => {
    if (e.type === 'dismissed' || !d) return setMode(null);
    if (Platform.OS === 'android' && mode === 'date') {
      const next = new Date(value);
      next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      onChange(next);
      return setMode('time');
    }
    if (Platform.OS === 'android' && mode === 'time') {
      const next = new Date(value);
      next.setHours(d.getHours(), d.getMinutes(), 0, 0);
      onChange(next);
      return setMode(null);
    }
    onChange(d);
  };
  return (
    <View className="mb-4">
      <Text className="mb-1.5 text-sm font-medium text-ink">{label}</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker value={value} mode="datetime" minimumDate={minimumDate} onChange={onPick} accessibilityLabel={label} />
      ) : (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value.toLocaleString()}`} onPress={() => setMode('date')} className="min-h-[52px] justify-center rounded-2xl border border-line bg-surface px-4">
            <Text className="text-base text-ink">{value.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
          </Pressable>
          {mode && <DateTimePicker value={value} mode={mode} minimumDate={mode === 'date' ? minimumDate : undefined} onChange={onPick} />}
        </>
      )}
    </View>
  );
}
