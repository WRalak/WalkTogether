import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '../src/database/prisma';
import { attachRealtime, closeRealtime } from '../src/modules/messaging/realtime';
import { storage } from '../src/modules/media/storage';
import { addMember, api, app, bearer, createAdmin, createClub, registerUser, teardown, type TestUser } from './helpers';

afterAll(teardown);

async function makePrivate(u: TestUser) {
  await api().patch('/api/v1/users/me/privacy').set(bearer(u)).send({ profileVisibility: 'PRIVATE' }).expect(200);
}

describe('follows', () => {
  it('public profiles are followed instantly; private ones need approval', async () => {
    const [a, b, c] = [await registerUser(), await registerUser(), await registerUser()];
    expect((await api().post(`/api/v1/users/${b.id}/follow`).set(bearer(a)).expect(200)).body.data.status).toBe('ACCEPTED');
    await makePrivate(c);
    expect((await api().post(`/api/v1/users/${c.id}/follow`).set(bearer(a)).expect(200)).body.data.status).toBe('PENDING');
    await api().get(`/api/v1/users/${c.id}/followers`).set(bearer(a)).expect(403);
    const reqs = await api().get('/api/v1/users/me/follow-requests').set(bearer(c)).expect(200);
    expect(reqs.body.data[0].id).toBe(a.id);
    await api().post(`/api/v1/users/me/follow-requests/${a.id}`).set(bearer(c)).send({ accept: true }).expect(204);
    await api().get(`/api/v1/users/${c.id}/followers`).set(bearer(a)).expect(200);
    const profile = await api().get(`/api/v1/users/${c.username}`).set(bearer(a)).expect(200);
    expect(profile.body.data).toMatchObject({ followers: 1, viewerFollows: 'ACCEPTED' });
  });
});

describe('posts, feed and interactions', () => {
  it('feed respects visibility, follows, club membership and blocks', async () => {
    const [author, follower, stranger, clubmate] = [await registerUser(), await registerUser(), await registerUser(), await registerUser()];
    const club = await createClub(author);
    await addMember(club.id, clubmate.id);
    await api().post(`/api/v1/users/${author.id}/follow`).set(bearer(follower)).expect(200);
    const pub = await api().post('/api/v1/posts').set(bearer(author)).send({ body: 'Public sunrise!', visibility: 'PUBLIC' }).expect(201);
    const fol = await api().post('/api/v1/posts').set(bearer(author)).send({ body: 'Followers only', visibility: 'FOLLOWERS' }).expect(201);
    const priv = await api().post('/api/v1/posts').set(bearer(author)).send({ body: 'Just me', visibility: 'PRIVATE' }).expect(201);
    const clubPost = await api().post('/api/v1/posts').set(bearer(author)).send({ body: 'Club only', clubId: club.id }).expect(201);
    await api().post('/api/v1/posts').set(bearer(stranger)).send({ body: 'x', clubId: club.id }).expect(403);

    const ids = async (u: TestUser) => (await api().get('/api/v1/feed').set(bearer(u)).expect(200)).body.data.map((p: { id: string }) => p.id);
    expect(await ids(follower)).toEqual(expect.arrayContaining([pub.body.data.id, fol.body.data.id]));
    expect(await ids(follower)).not.toContain(priv.body.data.id);
    expect(await ids(follower)).not.toContain(clubPost.body.data.id);
    expect(await ids(clubmate)).toEqual([clubPost.body.data.id]);
    expect(await ids(stranger)).toEqual([]);
    expect(await ids(author)).toHaveLength(4);

    await api().get(`/api/v1/posts/${fol.body.data.id}`).set(bearer(stranger)).expect(404);
    await api().get(`/api/v1/posts/${pub.body.data.id}`).expect(200);
    await api().post(`/api/v1/users/${follower.id}/block`).set(bearer(author)).expect(204);
    expect(await ids(follower)).toEqual([]);
  });

  it('likes, comments with replies, mentions and bookmarks', async () => {
    const [author, fan, mentioned] = [await registerUser(), await registerUser(), await registerUser()];
    const p = await api().post('/api/v1/posts').set(bearer(author)).send({ body: 'Who is walking Saturday?', visibility: 'PUBLIC' }).expect(201);
    const id = p.body.data.id;
    await api().post(`/api/v1/posts/${id}/like`).set(bearer(fan)).expect(200);
    await api().post(`/api/v1/posts/${id}/like`).set(bearer(fan)).expect(200);
    const c = await api().post(`/api/v1/posts/${id}/comments`).set(bearer(fan)).send({ body: `Me! @${mentioned.username} come too` }).expect(201);
    await api().post(`/api/v1/posts/${id}/comments`).set(bearer(author)).send({ body: 'Great', parentId: c.body.data.id }).expect(201);
    await api().post(`/api/v1/posts/${id}/bookmark`).set(bearer(fan)).expect(200);
    const post = await api().get(`/api/v1/posts/${id}`).set(bearer(fan)).expect(200);
    expect(post.body.data).toMatchObject({ likeCount: 1, commentCount: 2, likedByMe: true, bookmarkedByMe: true });
    const comments = await api().get(`/api/v1/posts/${id}/comments`).expect(200);
    expect(comments.body.data[1].parentId).toBe(c.body.data.id);
    const notes = (await api().get('/api/v1/notifications').set(bearer(mentioned)).expect(200)).body.data;
    expect(notes[0].type).toBe('mention');
    const authorNotes = (await api().get('/api/v1/notifications').set(bearer(author)).expect(200)).body.data.map((n: { type: string }) => n.type);
    expect(authorNotes).toEqual(expect.arrayContaining(['reaction.new', 'comment.new']));
    expect((await api().get('/api/v1/posts/bookmarks').set(bearer(fan)).expect(200)).body.data[0].id).toBe(id);
    await api().delete(`/api/v1/posts/${id}/like`).set(bearer(fan)).expect(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id } })).likeCount).toBe(0);
  });

  it('mentions never leak private posts', async () => {
    const [author, outsider] = [await registerUser(), await registerUser()];
    await api().post('/api/v1/posts').set(bearer(author)).send({ body: `secret @${outsider.username}`, visibility: 'PRIVATE' }).expect(201);
    expect((await api().get('/api/v1/notifications').set(bearer(outsider)).expect(200)).body.data).toHaveLength(0);
  });

  it('completed activities appear in followers’ feeds', async () => {
    const [walker, follower] = [await registerUser(), await registerUser()];
    await api().post(`/api/v1/users/${walker.id}/follow`).set(bearer(follower)).expect(200);
    const a = await api().post('/api/v1/activities').set(bearer(walker)).send({ clientId: randomUUID(), type: 'WALK', startedAt: new Date(Date.now() - 600_000).toISOString() }).expect(201);
    const t0 = Date.now() - 400_000;
    await api().post(`/api/v1/activities/${a.body.data.id}/gps-points`).set(bearer(walker)).send({ points: Array.from({ length: 50 }, (_, i) => ({ seq: i, t: t0 + i * 3000, lat: -1.29 + i * 0.00004, lng: 36.82, accuracy: 5 })) }).expect(200);
    await api().post(`/api/v1/activities/${a.body.data.id}/complete`).set(bearer(walker)).send({ endedAt: new Date().toISOString(), visibility: 'FOLLOWERS' }).expect(200);
    const feed = await api().get('/api/v1/feed').set(bearer(follower)).expect(200);
    expect(feed.body.data[0].activity.id).toBe(a.body.data.id);
    await api().patch(`/api/v1/activities/${a.body.data.id}`).set(bearer(walker)).send({ visibility: 'PRIVATE' }).expect(200);
    expect((await api().get('/api/v1/feed').set(bearer(follower)).expect(200)).body.data).toHaveLength(0);
  });
});

describe('media pipeline', () => {
  it('uploads, verifies magic bytes, strips EXIF and produces variants', async () => {
    const u = await registerUser();
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#127a50' } })
      .withExif({ IFD0: { Make: 'TestPhone' }, GPS: { GPSLatitudeRef: 'S', GPSLatitude: '1/1 17/1 0/1' } } as never)
      .jpeg()
      .toBuffer();
    const req = await api().post('/api/v1/media').set(bearer(u)).send({ purpose: 'AVATAR', mimeType: 'image/jpeg', sizeBytes: jpeg.length }).expect(201);
    const url = new URL(req.body.data.upload.url);
    await api().put(url.pathname + url.search).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    const done = await api().post(`/api/v1/media/${req.body.data.mediaId}/complete`).set(bearer(u)).expect(200);
    expect(done.body.data.status).toBe('READY');
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: req.body.data.mediaId } });
    const medium = await storage.read((asset.variants as Record<string, string>).medium!);
    const meta = await sharp(medium!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(await storage.read(asset.storageKey)).toBeNull(); // original with EXIF removed
    const me = await api().put('/api/v1/users/me/avatar').set(bearer(u)).send({ mediaId: asset.id }).expect(200);
    expect(me.body.data.profile.avatarUrl).toContain(`media/${asset.id}/medium.webp`);
  });

  it('rejects disguised files and malware; enforces type/size limits', async () => {
    const u = await registerUser();
    await api().post('/api/v1/media').set(bearer(u)).send({ purpose: 'POST', mimeType: 'application/x-msdownload', sizeBytes: 100 }).expect(400);
    await api().post('/api/v1/media').set(bearer(u)).send({ purpose: 'AVATAR', mimeType: 'video/mp4', sizeBytes: 100 }).expect(400);
    await api().post('/api/v1/media').set(bearer(u)).send({ purpose: 'POST', mimeType: 'image/png', sizeBytes: 50 * 1024 * 1024 }).expect(400);
    const fake = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*  padding padding');
    const req = await api().post('/api/v1/media').set(bearer(u)).send({ purpose: 'POST', mimeType: 'image/png', sizeBytes: fake.length }).expect(201);
    const url = new URL(req.body.data.upload.url);
    await api().put(url.pathname + url.search).set('Content-Type', 'image/png').send(fake).expect(200);
    const done = await api().post(`/api/v1/media/${req.body.data.mediaId}/complete`).set(bearer(u)).expect(200);
    expect(done.body.data).toMatchObject({ status: 'REJECTED', rejectReason: 'type_mismatch' });
    // Upload URLs cannot be forged.
    await api().put(`${url.pathname}?exp=${Math.floor(Date.now() / 1000) + 60}&token=forged`).set('Content-Type', 'image/png').send(fake).expect(401);
  });
});

describe('moderation', () => {
  it('club moderators handle reports on club content; platform admins can suspend', async () => {
    const [owner, troll, member] = [await registerUser(), await registerUser(), await registerUser()];
    const club = await createClub(owner);
    await addMember(club.id, troll.id);
    await addMember(club.id, member.id);
    const bad = await api().post('/api/v1/posts').set(bearer(troll)).send({ body: 'spam spam', clubId: club.id }).expect(201);
    const report = await api().post('/api/v1/reports').set(bearer(member)).send({ targetType: 'POST', targetId: bad.body.data.id, reason: 'SPAM' }).expect(201);
    await api().post('/api/v1/reports').set(bearer(member)).send({ targetType: 'POST', targetId: bad.body.data.id, reason: 'SPAM' }).expect(409);
    await api().get(`/api/v1/clubs/${club.id}/reports`).set(bearer(member)).expect(403);
    const list = await api().get(`/api/v1/clubs/${club.id}/reports`).set(bearer(owner)).expect(200);
    expect(list.body.data[0]).toMatchObject({ id: report.body.data.id, preview: 'spam spam' });
    await api().post(`/api/v1/clubs/${club.id}/reports/${report.body.data.id}/resolve`).set(bearer(owner)).send({ action: 'HIDE' }).expect(204);
    await api().get(`/api/v1/posts/${bad.body.data.id}`).set(bearer(member)).expect(404);

    const dm = await api().post('/api/v1/posts').set(bearer(troll)).send({ body: 'abuse', visibility: 'PUBLIC' }).expect(201);
    const r2 = await api().post('/api/v1/reports').set(bearer(member)).send({ targetType: 'POST', targetId: dm.body.data.id, reason: 'HARASSMENT' }).expect(201);
    const admin = await createAdmin('MODERATOR');
    const queue = await api().get('/api/v1/platform-admin/reports').set({ Authorization: `Bearer ${admin.accessToken}` }).expect(200);
    expect(queue.body.data.map((r: { id: string }) => r.id)).toContain(r2.body.data.id);
    await api().post(`/api/v1/platform-admin/reports/${r2.body.data.id}/resolve`).set({ Authorization: `Bearer ${admin.accessToken}` }).send({ action: 'SUSPEND_USER', note: 'Repeated harassment' }).expect(204);
    await api().get('/api/v1/users/me').set(bearer(troll)).expect(401);
  });
});

describe('messaging', () => {
  let socket: Socket | null = null;
  afterEach(async () => {
    socket?.disconnect();
    await closeRealtime();
  });

  it('direct messages are private to members, idempotent, and delivered in real time', async () => {
    const [a, b, c] = [await registerUser(), await registerUser(), await registerUser()];
    const conv = await api().post('/api/v1/conversations/direct').set(bearer(a)).send({ userId: b.id }).expect(200);
    const id = conv.body.data.id;
    const again = await api().post('/api/v1/conversations/direct').set(bearer(b)).send({ userId: a.id }).expect(200);
    expect(again.body.data.id).toBe(id);
    await api().get(`/api/v1/conversations/${id}/messages`).set(bearer(c)).expect(404);
    await api().post(`/api/v1/conversations/${id}/messages`).set(bearer(c)).send({ body: 'intrude' }).expect(404);

    const server = createServer(app);
    attachRealtime(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    socket = ioClient(`http://127.0.0.1:${port}/rt`, { auth: { token: b.accessToken }, transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      socket!.on('connect', resolve);
      socket!.on('connect_error', reject);
    });
    const joined = await socket.emitWithAck('conversation:join', { conversationId: id });
    expect(joined).toEqual({ ok: true });
    const received = new Promise<{ body: string }>((resolve) => socket!.on('message:new', resolve));
    const clientId = randomUUID();
    await api().post(`/api/v1/conversations/${id}/messages`).set(bearer(a)).send({ body: 'Habari! Walk tomorrow?', clientId }).expect(201);
    expect((await received).body).toBe('Habari! Walk tomorrow?');
    await api().post(`/api/v1/conversations/${id}/messages`).set(bearer(a)).send({ body: 'Habari! Walk tomorrow?', clientId }).expect(201);
    expect((await api().get(`/api/v1/conversations/${id}/messages`).set(bearer(b)).expect(200)).body.data).toHaveLength(1);

    const list = await api().get('/api/v1/conversations').set(bearer(b)).expect(200);
    expect(list.body.data[0]).toMatchObject({ id, unread: true });
    await api().post(`/api/v1/conversations/${id}/read`).set(bearer(b)).expect(200);
    expect((await api().get('/api/v1/conversations').set(bearer(b)).expect(200)).body.data[0].unread).toBe(false);

    // Outsiders cannot join the room over sockets either.
    const intruder = ioClient(`http://127.0.0.1:${port}/rt`, { auth: { token: c.accessToken }, transports: ['websocket'] });
    await new Promise<void>((r) => intruder.on('connect', () => r()));
    expect(await intruder.emitWithAck('conversation:join', { conversationId: id })).toEqual({ error: 'FORBIDDEN' });
    intruder.disconnect();
    // Bad tokens are refused at the handshake.
    const anon = ioClient(`http://127.0.0.1:${port}/rt`, { auth: { token: 'nope' }, transports: ['websocket'] });
    await expect(new Promise((resolve, reject) => { anon.on('connect', () => resolve(null)); anon.on('connect_error', reject); })).rejects.toThrow();
    anon.disconnect();
    // Blocking ends the conversation.
    await api().post(`/api/v1/users/${a.id}/block`).set(bearer(b)).expect(204);
    await api().post(`/api/v1/conversations/${id}/messages`).set(bearer(a)).send({ body: 'still there?' }).expect(403);
    socket.disconnect();
    await closeRealtime(); // also closes the HTTP server
  });

  it('club chat is limited to active members', async () => {
    const [owner, member, outsider] = [await registerUser(), await registerUser(), await registerUser()];
    const club = await createClub(owner);
    await addMember(club.id, member.id);
    const conv = await api().post(`/api/v1/conversations/club/${club.id}`).set(bearer(member)).expect(200);
    await api().post(`/api/v1/conversations/club/${club.id}`).set(bearer(outsider)).expect(403);
    await api().post(`/api/v1/conversations/${conv.body.data.id}/messages`).set(bearer(member)).send({ body: 'Hi club' }).expect(201);
    await prisma.clubMembership.updateMany({ where: { clubId: club.id, userId: member.id }, data: { status: 'REMOVED' } });
    await api().get(`/api/v1/conversations/${conv.body.data.id}/messages`).set(bearer(member)).expect(403);
  });
});

describe('video pipeline', () => {
  it('transcodes to MP4, strips location metadata and creates a poster', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'wt-vtest-'));
    const src = join(dir, 'in.mp4');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25', '-t', '2', '-metadata', 'location=-01.2921+036.8219/', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
    const buf = readFileSync(src);
    const u = await registerUser();
    const req = await api().post('/api/v1/media').set(bearer(u)).send({ purpose: 'POST', mimeType: 'video/mp4', sizeBytes: buf.length }).expect(201);
    const url = new URL(req.body.data.upload.url);
    await api().put(url.pathname + url.search).set('Content-Type', 'video/mp4').send(buf).expect(200);
    const done = await api().post(`/api/v1/media/${req.body.data.mediaId}/complete`).set(bearer(u)).expect(200);
    expect(done.body.data).toMatchObject({ status: 'READY', width: 1280, height: 720 });
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: req.body.data.mediaId } });
    const out = await storage.read((asset.variants as Record<string, string>).video!);
    const outPath = join(dir, 'out.mp4');
    (await import('node:fs')).writeFileSync(outPath, out!);
    const tags = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', outPath]).toString();
    expect(tags).not.toContain('location');
    expect(await storage.read(asset.storageKey)).toBeNull();
  }, 60_000);
});
