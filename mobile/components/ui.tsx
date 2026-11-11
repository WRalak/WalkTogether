import { forwardRef } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type PressableProps, type TextInputProps, type ViewProps } from 'react-native';

type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

const buttonStyles: Record<Variant, { box: string; text: string }> = {
  primary: { box: 'bg-primary', text: 'text-white' },
  secondary: { box: 'bg-primary-soft', text: 'text-primary' },
  outline: { box: 'border border-line bg-surface', text: 'text-ink' },
  danger: { box: 'bg-danger', text: 'text-white' },
  ghost: { box: 'bg-transparent', text: 'text-primary' },
};

export function Button({ title, variant = 'primary', loading, disabled, className = '', textClassName = '', ...props }: PressableProps & { title: string; variant?: Variant; loading?: boolean; className?: string; textClassName?: string }) {
  const s = buttonStyles[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      className={`min-h-[52px] flex-row items-center justify-center rounded-2xl px-5 active:opacity-80 ${s.box} ${isDisabled ? 'opacity-50' : ''} ${className}`}
      {...props}
    >
      {loading && <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : '#127a50'} className="mr-2" />}
      <Text className={`text-base font-semibold ${s.text} ${textClassName}`}>{title}</Text>
    </Pressable>
  );
}

export const TextField = forwardRef<TextInput, TextInputProps & { label: string; error?: string; hint?: string }>(({ label, error, hint, ...props }, ref) => (
  <View className="mb-4">
    <Text className="mb-1.5 text-sm font-medium text-ink">{label}</Text>
    <TextInput
      ref={ref}
      accessibilityLabel={label}
      placeholderTextColor="#8a9a93"
      className={`min-h-[52px] rounded-2xl border bg-surface px-4 text-base text-ink ${error ? 'border-danger' : 'border-line'}`}
      {...props}
    />
    {error ? (
      <Text accessibilityLiveRegion="polite" className="mt-1 text-sm text-danger">
        {error}
      </Text>
    ) : hint ? (
      <Text className="mt-1 text-xs text-ink-muted">{hint}</Text>
    ) : null}
  </View>
));
TextField.displayName = 'TextField';

export function Card({ className = '', ...props }: ViewProps & { className?: string }) {
  return <View className={`rounded-3xl border border-line bg-surface p-5 ${className}`} {...props} />;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'primary' | 'warning' }) {
  const cls = tone === 'primary' ? 'bg-primary-soft text-primary' : tone === 'warning' ? 'bg-orange-100 text-orange-700' : 'bg-surface-muted text-ink-muted';
  return <Text className={`self-start overflow-hidden rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</Text>;
}

export function Avatar({ label, size = 48 }: { label: string; size?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size }} className="items-center justify-center rounded-full bg-primary-soft">
      <Text className="font-bold text-primary" style={{ fontSize: size * 0.36 }}>
        {label}
      </Text>
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} className="items-center justify-center py-12">
      <ActivityIndicator color="#127a50" size="large" />
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View className="items-center rounded-3xl border border-dashed border-line px-6 py-10">
      <Text className="text-center text-base font-semibold text-ink">{title}</Text>
      {body && <Text className="mt-1 text-center text-sm text-ink-muted">{body}</Text>}
      {action && <View className="mt-4 self-stretch">{action}</View>}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View accessibilityRole="alert" className="items-center rounded-3xl bg-red-50 px-6 py-8">
      <Text className="text-center text-base font-semibold text-danger">{message}</Text>
      {onRetry && <Button title="Try again" variant="outline" className="mt-4 self-stretch" onPress={onRetry} />}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <View className="mb-3 mt-6 flex-row items-center justify-between">
      <Text accessibilityRole="header" className="text-lg font-bold text-ink">
        {children}
      </Text>
      {action}
    </View>
  );
}
