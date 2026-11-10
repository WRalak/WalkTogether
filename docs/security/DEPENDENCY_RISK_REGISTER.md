# Dependency risk register

`pnpm audit --prod --audit-level high` runs in CI. Advisories that cannot be fixed by an upgrade
today are listed here with their mitigation and are suppressed via `pnpm.auditConfig.ignoreGhsas`
in the root `package.json`. Review this register monthly and on every Dependabot run.

| Advisory | Package (path) | Exposure | Mitigation / plan |
| --- | --- | --- | --- |
| GHSA-mrhx-c7xc-m3w5 | `zod` 3.x (server + clients) | Memory exhaustion when validating *oversized* constrained collections | All JSON bodies are capped at 1 MB by `express.json`, every array schema has a `.max()`, and the largest array (GPS batch, 2 000 points) is far below the limit. **Plan:** migrate to Zod 4 (`@asteasolutions/zod-to-openapi` v8) in the next maintenance release. |
| GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | `image-size` (Expo → Metro bundler) | DoS in a build-time bundler parsing project images | Build tooling only; images in the repo are trusted. Clears when Expo ships a Metro upgrade. |
| GHSA-qr28-fpjm-wq7f | `decode-uri-component` (expo-router → query-string) | Quadratic DoS when parsing a crafted deep link on the device | Impact limited to slowing the user's own app; no server exposure. Clears with an expo-router upgrade. |

Fixed during Phase 9: `sharp` 0.34 → 0.35.5 (processes untrusted uploads), `nodemailer` 7 → 10.5,
`postcss` → 8.5.32, `deepmerge-ts` → 8 (override).
