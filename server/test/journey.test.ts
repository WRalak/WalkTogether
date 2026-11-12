/**
 * End-to-end journey (API level) for the Phase 1 portion of the product journey:
 *   1. a user registers  2. creates a club  3. another user discovers it
 *   4. requests membership  5. the administrator approves it.
 * Later phases extend this file with events, activities, subscriptions and sponsorships.
 */
import { afterAll, expect, it } from 'vitest';
import { api, bearer, teardown, tokenFromEmail, uid } from './helpers';

afterAll(teardown);

it('register → verify → create club → discover → request → approve', async () => {
  const id = uid();
  const ownerEmail = `founder_${id}@example.com`;
  const reg = await api()
    .post('/api/v1/auth/register')
    .send({ email: ownerEmail, password: 'sunrise-walks-2026', username: `founder_${id}`, displayName: 'Founder', acceptTerms: true })
    .expect(201);
  const owner = reg.body.data;
  await api()
    .post('/api/v1/auth/verify-email')
    .send({ token: tokenFromEmail(ownerEmail) })
    .expect(200);

  const slug = `karura-${id}`;
  const club = await api()
    .post('/api/v1/clubs')
    .set(bearer(owner))
    .send({ name: `Karura Forest Walkers ${id}`, slug, category: 'WALKING', visibility: 'PRIVATE', city: 'Nairobi', countryCode: 'KE', latitude: -1.2341, longitude: 36.8327 })
    .expect(201);

  const walkerEmail = `walker_${id}@example.com`;
  const walker = (
    await api()
      .post('/api/v1/auth/register')
      .send({ email: walkerEmail, password: 'sunrise-walks-2026', username: `walker_${id}`, displayName: 'Walker', acceptTerms: true })
      .expect(201)
  ).body.data;

  const found = await api()
    .get('/api/v1/clubs')
    .query({ q: `Karura Forest Walkers ${id}` })
    .set(bearer(walker))
    .expect(200);
  expect(found.body.data.map((c: { slug: string }) => c.slug)).toContain(slug);

  const join = await api().post(`/api/v1/clubs/${club.body.data.id}/join`).set(bearer(walker)).send({ message: 'Saturday regular!' }).expect(202);
  expect(join.body.data.status).toBe('PENDING');

  const pending = await api().get(`/api/v1/clubs/${club.body.data.id}/members`).query({ status: 'PENDING' }).set(bearer(owner)).expect(200);
  const request = pending.body.data.find((m: { user: { username: string } }) => m.user.username === `walker_${id}`);
  await api().post(`/api/v1/clubs/${club.body.data.id}/members/${request.membershipId}/review`).set(bearer(owner)).send({ decision: 'APPROVE' }).expect(200);

  const detail = await api().get(`/api/v1/clubs/${slug}`).set(bearer(walker)).expect(200);
  expect(detail.body.data).toMatchObject({ memberCount: 2, viewer: { membershipStatus: 'ACTIVE', role: 'Member' } });
});
