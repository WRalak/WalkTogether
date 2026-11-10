/** Magic-byte detection: the declared Content-Type is never trusted on its own. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const box = buf.subarray(4, 8).toString('ascii');
  if (box === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'mif1', 'msf1', 'hevc'].includes(brand)) return 'image/heic';
    if (['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'].includes(brand)) return 'video/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
  }
  return null;
}

export const ALLOWED: Record<string, { kind: 'IMAGE' | 'VIDEO'; maxBytes: number }> = {
  'image/jpeg': { kind: 'IMAGE', maxBytes: 10 * 1024 * 1024 },
  'image/png': { kind: 'IMAGE', maxBytes: 10 * 1024 * 1024 },
  'image/webp': { kind: 'IMAGE', maxBytes: 10 * 1024 * 1024 },
  'image/heic': { kind: 'IMAGE', maxBytes: 15 * 1024 * 1024 },
  'video/mp4': { kind: 'VIDEO', maxBytes: 100 * 1024 * 1024 },
  'video/quicktime': { kind: 'VIDEO', maxBytes: 100 * 1024 * 1024 },
};
