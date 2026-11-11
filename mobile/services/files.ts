import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Writes text to the cache directory and opens the system share sheet (email, Drive, WhatsApp…). */
export async function shareTextFile(filename: string, text: string, mimeType: string, uti?: string) {
  const safe = filename.replace(/[^a-z0-9._-]/gi, '_');
  const file = new File(Paths.cache, safe);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: safe, UTI: uti });
}

export const shareCsv = (filename: string, csv: string) => shareTextFile(filename, csv, 'text/csv', 'public.comma-separated-values-text');
export const shareHtml = (filename: string, html: string) => shareTextFile(filename, html, 'text/html', 'public.html');
