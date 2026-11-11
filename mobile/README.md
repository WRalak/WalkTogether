# WalkTogether mobile app (`mobile/`)

Android-first Expo (SDK 54) / React Native app for members: GPS recording (background + offline),
activity history, clubs, events with QR check-in, community feed, messaging, challenges,
achievements, step counts (Health Connect / HealthKit) and Premium. **Shipped through app stores**
via EAS, not hosted. See [`../docs/deployment/HOSTING.md`](../docs/deployment/HOSTING.md).

## Layout

```
app/                  Expo Router screens
  (auth)/             sign in, sign up, phone OTP
  (tabs)/             index (home), explore, record, community, profile
  clubs/ activities/ challenges/ events/ messages/ settings/ posts/ users/ notifications.tsx
components/           UI building blocks (cards, map adapter, post card…)
features/             feature logic (tracking session, offline sync, QR parsing…)
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

Background location, Health Connect and the camera need a development build, not Expo Go:

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
