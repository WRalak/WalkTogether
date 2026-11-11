# WalkTogether mobile app (`mobile/`)

Android-first Expo (SDK 54) / React Native app for **everyone in a club** — members, club owners,
administrators, event organisers and moderators. The interface adapts to the user's permissions in each
club: GPS recording (background + offline), activity history, clubs, events with QR check-in, community
feed, messaging, challenges, achievements, step counts (Health Connect / HealthKit), Premium, and
**club administration** (members, events and attendance, challenges, announcements, analytics,
subscription, settings, moderation) without any separate website. **Shipped through app stores**
via EAS, not hosted. See [`../docs/deployment/HOSTING.md`](../docs/deployment/HOSTING.md).

## Layout

```
app/                  Expo Router screens
  (auth)/             sign in, sign up, phone OTP, forgot password
  (tabs)/             index (Home), activity (record), clubs, community, profile
  clubs/ activities/ challenges/ events/ messages/ settings/ posts/ users/ notifications.tsx
  admin/              club administration — shown only with an administrative club permission:
                        index (my managed clubs), new (create club),
                        [clubId]/ index (overview), members, invitations, roles, events/ (list, new,
                        [eventId] with rotating QR + attendance), attendance, activities, challenges,
                        announcements, analytics, subscription, settings, moderation, sponsorships
  sponsor/            sponsor portal (apply, campaigns, pay, aggregated reports)
components/           UI building blocks (cards, map adapter, post card…)
features/             feature logic (auth schemas; admin: use-admin-club, club form, pay flow…)
hooks/ services/      health, location task, push, socket, API client
store/                Zustand stores        utils/   formatting helpers
assets/               icons and splash
```

## Run locally

```bash
cp mobile/.env.example mobile/.env
```

```bash
pnpm --filter @walktogether/mobile start
```

Background location, Health Connect, the camera and the club-admin native pieces (date picker, QR,
share sheet) need a development build, not Expo Go:

```bash
pnpm --filter @walktogether/mobile build:dev
```

## Release

[`eas.json`](eas.json) has `development`, `preview` (internal APK → staging API) and `production`
(Play Store AAB → production API) profiles; each sets `EXPO_PUBLIC_API_URL`.

```bash
eas build --profile production --platform android
```

```bash
eas submit --profile production --platform android
```

Store declarations needed: background location justification, Health Connect (READ_STEPS) form,
data-safety form, account-deletion URL. Keep the API backwards-compatible with the previous app
version, because users update slowly.

## Test

```bash
pnpm --filter @walktogether/mobile test
```

CI: `.github/workflows/mobile.yml` (typecheck, Jest, Android JS bundle) runs when this folder or a
package it uses changes.
