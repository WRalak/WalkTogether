'use client';
import { useRef, useState } from 'react';
import { Alert, Button } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Uploads straight to object storage via a presigned URL, then attaches the processed image. */
export function BrandingUpload({ clubId, kind, onDone }: { clubId: string; kind: 'logo' | 'cover'; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { mediaId, upload } = await api.media.request({ purpose: kind === 'logo' ? 'CLUB_LOGO' : 'CLUB_COVER', mimeType: file.type, sizeBytes: file.size });
      const res = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file });
      if (!res.ok) throw new Error('Upload failed');
      let m = await api.media.complete(mediaId);
      for (let i = 0; i < 20 && m.status === 'PROCESSING'; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        m = await api.media.get(mediaId);
      }
      if (m.status !== 'READY') throw new Error(m.status === 'REJECTED' ? 'This image was rejected. Use a JPEG, PNG or WebP photo.' : 'Still processing, try again shortly.');
      await api.media.setClubBranding(clubId, kind === 'logo' ? { logoMediaId: mediaId } : { coverMediaId: mediaId });
      onDone();
    } catch (e) {
      setError(e instanceof Error && !(e as { code?: string }).code ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <Button variant="outline" loading={busy} onClick={() => input.current?.click()}>
        Upload {kind}
      </Button>
      {error && <Alert variant="destructive">{error}</Alert>}
    </div>
  );
}
