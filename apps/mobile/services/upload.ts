import * as ImagePicker from 'expo-image-picker';
import type { MediaDto } from '@walktogether/api-client';
import { api } from './api';

type Purpose = 'AVATAR' | 'CLUB_LOGO' | 'CLUB_COVER' | 'POST' | 'EVENT_COVER';

/** Picks an image, uploads it straight to object storage (presigned URL) and waits for server processing. */
export async function pickAndUploadImage(purpose: Purpose): Promise<MediaDto | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo access is needed to choose a picture.');
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: purpose !== 'POST', exif: false });
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  const blob = await (await fetch(asset.uri)).blob();
  const mimeType = asset.mimeType ?? blob.type ?? 'image/jpeg';
  const { mediaId, upload } = await api.media.request({ purpose, mimeType, sizeBytes: blob.size });
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: blob });
  if (!put.ok) throw new Error('Upload failed. Please try again.');
  let media = await api.media.complete(mediaId);
  for (let i = 0; i < 20 && media.status === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    media = await api.media.get(mediaId);
  }
  if (media.status === 'REJECTED') throw new Error('This image could not be used. Try a different photo.');
  if (media.status !== 'READY') throw new Error('Still processing: try again in a moment.');
  return media;
}
