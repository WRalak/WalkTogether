# Pull request security review

Use for any PR touching `server/src/modules/{auth,administration,payments,subscriptions,clubs,memberships}`,
`packages/validation`, `infrastructure/**`, `.github/**` or `security/**` (CODEOWNERS enforces review).

- [ ] **AuthN:** route uses `requireAuth` / `requireAdmin…` unless intentionally public (and then rate-limited)
- [ ] **AuthZ:** permission checked server-side from DB state, not from the request body or client flags
- [ ] **Tenant isolation:** every query filtered by the club/user the caller is authorised for (OWASP API1 BOLA)
- [ ] **Mass assignment:** Zod schema lists allowed fields; no spreading `req.body` into Prisma
- [ ] **Injection:** no `$queryRawUnsafe` / `$executeRawUnsafe` with interpolation; HTML output escaped
- [ ] **Secrets & logging:** nothing sensitive logged (passwords, tokens, OTPs, payment credentials, precise locations)
- [ ] **Payments:** state changes only from verified provider callbacks/status queries; idempotent
- [ ] **Errors:** no stack traces or internal details returned to clients
- [ ] **Mobile:** secrets only in SecureStore; deep links validated; no new permissions without justification
- [ ] **Infra:** least privilege; nothing new exposed publicly; scanners green without new skips (or skip justified)
- [ ] **Tests:** abuse case covered (wrong club, wrong role, replay, forged input)
