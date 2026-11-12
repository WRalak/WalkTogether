import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useQuery } from '@tanstack/react-query';
import type { MessageDto } from '@walktogether/api-client';
import { Button, ErrorState, Loading } from '@/components/ui';
import { api } from '@/services/api';
import { getSocket } from '@/services/realtime';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useAuthStore((s) => s.user);
  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => api.messaging.get(id) });
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api.messaging
      .messages(id, { limit: 40 })
      .then((p) => {
        setMessages(p.items);
        setCursor(p.meta.nextCursor);
      })
      .catch((e) => setError(errorMessage(e)));
    void api.messaging.read(id).catch(() => undefined);
    const s = getSocket();
    const join = () => s.emit('conversation:join', { conversationId: id });
    join();
    s.on('connect', join);
    const onNew = (m: MessageDto & { conversationId: string }) => {
      if (m.conversationId !== id) return;
      setMessages((prev) =>
        prev.some((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId)) ? prev.map((x) => (x.clientId && x.clientId === m.clientId ? m : x)) : [m, ...prev],
      );
      s.emit('conversation:read', { conversationId: id });
    };
    s.on('message:new', onNew);
    return () => {
      s.off('message:new', onNew);
      s.off('connect', join);
    };
  }, [id]);

  const send = async () => {
    const body = text.trim();
    if (!body || !me) return;
    const clientId = Crypto.randomUUID();
    // Optimistic message; replaced when the server echo arrives (idempotent by clientId).
    setMessages((prev) => [{ id: `local-${clientId}`, senderId: me.id, body, createdAt: new Date().toISOString(), clientId }, ...prev]);
    setText('');
    try {
      await api.messaging.send(id, body, clientId);
    } catch (e) {
      setError(errorMessage(e));
      setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
    }
  };

  const other = conv.data?.members.find((m) => m.id !== me?.id);
  const title = conv.data?.kind === 'DIRECT' ? (other?.profile?.displayName ?? other?.username) : conv.data?.title;
  if (conv.isLoading) return <Loading />;
  if (conv.error) return <ErrorState message={errorMessage(conv.error)} />;
  const readByOther = conv.data?.kind === 'DIRECT' && other?.lastReadAt ? new Date(other.lastReadAt) : null;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-surface-muted" keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: title ?? 'Chat' }} />
      {error && <Text className="bg-red-50 p-2 text-center text-danger">{error}</Text>}
      <FlatList
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerClassName="px-4 py-3"
        onEndReached={async () => {
          if (!cursor) return;
          const p = await api.messaging.messages(id, { cursor, limit: 40 });
          setMessages((prev) => [...prev, ...p.items]);
          setCursor(p.meta.nextCursor);
        }}
        renderItem={({ item: m, index }) => {
          const mine = m.senderId === me?.id;
          const sender = conv.data?.members.find((x) => x.id === m.senderId);
          return (
            <View className={`mb-2 max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'self-end bg-primary' : 'self-start bg-surface'}`}>
              {!mine && conv.data?.kind !== 'DIRECT' && <Text className="text-xs font-semibold text-primary">{sender?.profile?.displayName ?? sender?.username ?? 'Member'}</Text>}
              <Text className={mine ? 'text-white' : 'text-ink'}>{m.body}</Text>
              {mine && index === 0 && readByOther && readByOther >= new Date(m.createdAt) && <Text className="mt-0.5 text-right text-[10px] text-white/70">Read</Text>}
            </View>
          );
        }}
      />
      <View className="flex-row items-end gap-2 border-t border-line bg-surface px-4 py-3">
        <TextInput
          accessibilityLabel="Message"
          placeholder="Message"
          placeholderTextColor="#8a9a93"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={4000}
          className="max-h-28 flex-1 rounded-2xl border border-line px-3 py-2 text-ink"
        />
        <Button title="Send" className="min-h-[44px] px-4" disabled={!text.trim()} onPress={() => void send()} />
      </View>
    </KeyboardAvoidingView>
  );
}
