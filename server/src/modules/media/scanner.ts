import { connect } from 'node:net';
import { env } from '../../config/env';

export interface ScanResult {
  clean: boolean;
  signature?: string;
}

/**
 * ClamAV clamd INSTREAM client. Every upload is scanned before it is published.
 * MALWARE_SCANNER=none is permitted only outside production (see config validation).
 */
function clamavScan(buf: Buffer): Promise<ScanResult> {
  return new Promise((resolveScan, reject) => {
    const socket = connect({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    let response = '';
    socket.setTimeout(30_000, () => socket.destroy(new Error('clamd timeout')));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const CHUNK = 64 * 1024;
      for (let i = 0; i < buf.length; i += CHUNK) {
        const part = buf.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', (d) => (response += d.toString()));
    socket.on('end', () => {
      const r = response.replace(/\0/g, '').trim();
      if (r.endsWith('OK')) resolveScan({ clean: true });
      else if (r.includes('FOUND')) resolveScan({ clean: false, signature: r.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') });
      else reject(new Error(`unexpected clamd response: ${r}`));
    });
    socket.on('error', reject);
  });
}

export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  if (env.MALWARE_SCANNER === 'clamav') return clamavScan(buf);
  // EICAR test signature is still rejected without a scanner so the pipeline is testable.
  if (buf.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))) return { clean: false, signature: 'Eicar-Test-Signature' };
  return { clean: true };
}
