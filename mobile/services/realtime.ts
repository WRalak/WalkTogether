import { io, type Socket } from 'socket.io-client';
import { api, tokenStore } from './api';
import { config } from './config';

let socket: Socket | null = null;

/**
 * Authenticated Socket.IO connection. Access tokens are short-lived, so on auth errors we refresh
 * and reconnect with the new token.
 */
export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(`${config.apiUrl}/rt`, {
    transports: ['websocket'],
    auth: (cb) => cb({ token: tokenStore.getAccessToken() }),
    reconnectionDelayMax: 10_000,
  });
  socket.on('connect_error', async (err) => {
    if (err.message === 'UNAUTHORIZED' && (await api.http.refresh())) socket?.connect();
  });
  socket.on('disconnect', (reason) => {
    // Server disconnects when the access token expires; refresh and reconnect.
    if (reason === 'io server disconnect') void api.http.refresh().then((ok) => ok && socket?.connect());
  });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
