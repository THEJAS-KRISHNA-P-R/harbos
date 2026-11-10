# Security Policy (`SECURITY.md`)

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `1.0.x` | Yes |
| `< 1.0.0` | No (pre-hardening demo builds) |

## Reporting a Vulnerability

Do **not** open a public issue for security vulnerabilities.

1. Email security reports to the HarbourOS platform operator (`security@harbouros.invalid` — replace before public launch per `OPEN-15`).
2. Include the affected route or table, reproduction steps (`curl` or test case), and impact assessment.
3. Reports are acknowledged within 24 hours and triaged by severity:
   - **P0 (Auth bypass, cross-tenant data leak, ledger tamper):** patched within 24 hours.
   - **P1 (Authorization, validation, DoS):** patched within 72 hours.

## Security Architecture Highlights
- **Authentication:** Salted SHA-256 OTP challenges in PostgreSQL (`core.otp_challenges`) with 5-attempt lockout, 15-minute HS256 access JWTs (`iss`/`aud` verified + active user check), and rotating `httpOnly; Secure; SameSite=Strict` refresh tokens in `core.sessions` with family reuse detection.
- **Tenant Isolation:** Fail-closed PostgreSQL Row-Level Security (`USING (tenant_id = core.current_tenant_id())`) enforced via `withTenant` session context (`set_config('app.tenant_id', ...)`).
- **Ledger Integrity:** Append-only `ledger.journals` and `ledger.entries` (`BEFORE UPDATE OR DELETE OR TRUNCATE` triggers), deferred `SUM(D) = SUM(C)` constraint trigger, and verifiable FIPS 180-4 SHA-256 hash chain.
