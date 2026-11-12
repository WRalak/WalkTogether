import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Sensitive values (refresh token, device id) are kept in the OS keystore via SecureStore
 * (Android Keystore / iOS Keychain), never in AsyncStorage.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const KEYS = { refreshToken: 'wt.refreshToken', deviceId: 'wt.deviceId' } as const;

export const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key: string) => SecureStore.deleteItemAsync(key, OPTIONS),
};

function randomId() {
  // Native CSPRNG (Hermes has no global WebCrypto); never fall back to Math.random.
  return Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable per-install identifier used to label sessions ("Signed in on Tecno Spark"). Not an advertising ID. */
export async function getDeviceId() {
  const existing = await secureStorage.get(KEYS.deviceId);
  if (existing) return existing;
  const id = randomId();
  await secureStorage.set(KEYS.deviceId, id);
  return id;
}
