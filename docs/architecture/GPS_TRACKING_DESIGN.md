# GPS Tracking Design (Phase 3)

Status: **designed; implementation starts in Phase 3.** Phase 1 ships the location-permission UX, the
app configuration for background location (Android foreground service, iOS background mode), and
privacy defaults (`hideStartEndPoints = true`, privacy-zone radius).

## 1. Requirements recap

Record walks and runs reliably on low-end Android phones, in the foreground and background, offline, with
battery awareness; survive app kills; compute distance/pace/speed/elevation honestly; never trust the
client blindly; protect home/work locations by default.

## 2. Mobile architecture

```
┌──────────── Record screen (UI) ─────────────┐
│ live stats from TrackingStore (Zustand)      │
└──────────────▲───────────────────────────────┘
               │ subscribe
┌──────────────┴───────────────────────────────┐
│ TrackingEngine (pure TS, unit-tested)         │
│  state machine: idle → recording ⇄ paused → finished
│  filters: accuracy, duplicates, timestamps,   │
│  impossible speed, drift/jitter; distance;    │
│  pace smoothing; auto-pause (optional)        │
└──────────────▲───────────────────────────────┘
               │ location batches
┌──────────────┴───────────────────────────────┐
│ Location source                               │
│  foreground: Location.watchPositionAsync       │
│  background: TaskManager task registered via   │
│  Location.startLocationUpdatesAsync with       │
│  Android foreground-service notification       │
└──────────────┬───────────────────────────────┘
               │ every accepted point appended
┌──────────────▼───────────────────────────────┐
│ Local store: expo-sqlite (WAL)                │
│  activities(local_id UUID, status, type, …)   │
│  points(local_id, seq, t, lat, lng, acc, alt) │
│  sync_queue(local_id, next_seq, attempts, …)  │
└──────────────┬───────────────────────────────┘
               │ SyncWorker (NetInfo + app foreground + BackgroundFetch)
               ▼
           API: POST /activities (client UUID) → POST /activities/:id/gps-points (batches, seq)
                → POST /activities/:id/complete
```

* **Background tracking requires a development/production build** (`expo run:android` / EAS). Expo Go
  cannot run background location tasks. Android 14+ requires the `FOREGROUND_SERVICE_LOCATION`
  permission (already declared) and a visible notification while recording.
* Permission flow: foreground permission first, explain value; request background ("Allow all the
  time") only when the user starts their first recording with the screen-off option, with a rationale
  screen, and degrade gracefully to foreground-only if declined.
* **Interrupted session recovery:** the engine state and every point are persisted immediately; on app
  start, an activity in `recording` state offers *Resume* or *Finish*.
* **Battery:** `Accuracy.BestForNavigation` only while recording; `distanceInterval` 5 m (walk) /
  8 m (run), `timeInterval` 2–3 s; `deferredUpdatesInterval` batching; stop updates when paused.

## 3. Point filtering (client and server use the same rules from a shared package)

| Rule | Default |
| --- | --- |
| Reject invalid coordinates | `|lat| ≤ 90`, `|lng| ≤ 180`, not `(0,0)` |
| Reject poor accuracy | horizontal accuracy > 30 m (walk) / 25 m (run); first fix waits for ≤ 20 m |
| Reject duplicates | same timestamp, or < 1 m from previous within 1 s |
| Timestamp validation | strictly increasing; not in the future (> 2 min skew); within activity window |
| Impossible speed | segment speed > 7 m/s for walks, > 12 m/s for runs → point dropped and flagged |
| Drift while stationary | movement below `max(accuracy, 3 m)` while speed ≈ 0 does not add distance |

Distance = sum of Haversine segment lengths between accepted points (PostGIS `ST_Length` on the
geography line server-side). Pace = moving time / distance (paused time excluded); current pace uses a
rolling 30–60 s window. Elevation gain only when altitude accuracy is reported and smoothed with a
hysteresis threshold (≥ 3 m); otherwise elevation is omitted. Calories are an estimate
(MET × weight × duration), labelled as such; no step counts unless from Health Connect / HealthKit.

## 4. Server ingestion and integrity

* `POST /activities` with a **client-generated UUID** (unique per user) → idempotent create.
* `POST /activities/:id/gps-points` accepts ordered batches with `seq`; duplicates (same `seq`) are
  ignored (`ON CONFLICT DO NOTHING`), gaps are allowed until completion.
* `POST /activities/:id/complete` triggers a **server-side recomputation job**: re-applies filters,
  computes all statistics in PostGIS, stores `route_simplified` (`ST_Simplify` for display), and sets
  anomaly flags (impossible speeds, teleports, time gaps, too-perfect lines, mock-location flag from the
  client). Client-submitted statistics are only hints; the server values are authoritative.
* Anomalous activities are kept for the owner but excluded from leaderboards/challenges pending review.
  GPS validation reduces but **cannot fully prevent spoofing**; this is stated in challenge terms.

## 5. Privacy

* Each activity has a visibility (`PUBLIC`, `FOLLOWERS`, `PRIVATE`) plus explicit club shares
  (`activity_visibility` rows). Clubs never get implicit access.
* **Privacy zones:** the first and last `privacyZoneRadiusMeters` (default 200 m) of every route are
  trimmed from anything shown to others, plus user-defined zones (home/work). Trimming is applied
  server-side when serving routes to non-owners, so raw points never leave the server for other viewers.
* Users can delete activities (hard delete of points; aggregates recomputed).

## 6. Storage and scale

GPS points live in `activity_gps_points` (one row per point; never a JSON blob), range-partitioned by
month with BRIN (time) and GIST (location) indexes. A 1-hour walk at 1 point / 3 s ≈ 1,200 rows. After
`route_simplified` is stored, raw points beyond a retention window (e.g. 24 months) can be down-sampled.

## 7. Testing plan

* Unit tests for the engine with recorded fixture tracks (Nairobi walks, tunnels, urban canyons,
  pauses, GPS jumps, spoofed tracks).
* Offline sync tests: kill/restart mid-activity, duplicate batches, network flaps.
* Real-device testing on low-end Android (2–3 GB RAM, Android 11–15) with screen off for 60+ minutes;
  measure battery drain and distance error against measured routes.
