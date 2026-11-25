# HarbourOS: Status, Fixes, and Next Steps

> ## UPDATE 2026-11-24: current state (verified against GitHub, not assumed)
>
> - **CI is green on `main`** (newest commit `485f1af`: only 2 Node-20 deprecation warnings). The CI/deploy fixes below are **already in `main`**, so the old `harbos-ci-deploy-fix.patch` is obsolete and has been removed.
> - **Playwright and the Docker step now count as verified**: they run after the scale gate, and that run passed on real CI. (They were UNVERIFIED in section 2.)
> - Your commit `24edf50` first failed at the **scale-fixture / EXPLAIN gate** (a new failure past the PgBouncer gate, which now passes in CI). `485f1af` rewrote `scripts/scale-fixture.ts` and fixed it. I did not diagnose why it failed in CI but passed locally for me.
> - **ZAP is still unproven.** The latest ZAP failure (run 11) ran on the *old* commit with the *old* pin. The new `v0.15.0` pin has not run yet. **Action: run `zap-nightly` via `workflow_dispatch`, download `zap_scan`, triage.**
> - **Dependabot PR #12-#17 runs still fail** at the scale gate because they branched from the broken state. Rebase or close (section 5).
> - **UI (updated):** Mobile shell, two-step login, Fisher passbook hero, Auction Pit Pad redesign, Buyer & Inspector touch-first redesigns, species glyphs across tables, raw-code cleanup, and skeleton loading states have been implemented in the workspace.

Repo: `THEJAS-KRISHNA-P-R/harbos` · Base: `main @ bfa291d` · Fix: `harbos-ci-deploy-fix.patch` (1 commit, 15 files)
Date of work: 2026-11-23

## 0. Read this first

- **CI and ZAP were red for two unrelated reasons. Both are fixed in the patch and verified locally. Neither is fixed on GitHub until you push.**
- **While fixing them we found the deploy path had never worked.** Both Cloud Run manifests crash on boot, the worker cannot start on Cloud Run, and the deploy workflow printed "Deployment successful" without deploying. All fixed and now gated in CI.
- **"Deployment-ready" is not the same as "works IRL".** The code and pipeline are now in a state we can prove. Production also needs accounts, registrations and a pilot that only you can do (section 6). Section 8 defines what done means so it is measurable instead.

## 1. Root causes found

| # | Symptom | Root cause | Evidence | Fix |
|---|---|---|---|---|
| 1 | CI red on runs 48-50 at "Strict PgBouncer Transaction-Mode Gate" | Test `C1 #7` injects a forged row hash by matching the SQL string `ORDER BY entry_seq ASC`. The query was refactored to `entries.entry_seq`, so the proxy never fired and the (correct) verifier reported a clean chain. **Test bug, not an app bug.** | Reproduced: 87/88, failing at the tamper assertion | Regex tolerant of table-qualified columns; asserts the proxy fired (`tamperHits > 0`) so a refactor fails loudly |
| 2 | ZAP nightly red, runs 9-10 | `zaproxy/action-baseline@v0.12.0` bundles the retired legacy artifact client. Annotation: *"Create Artifact Container failed: The artifact name zap_scan is not valid."* **Tooling failure, not a security finding.** | v0.12.0 bundle contains the legacy `pipelines/workflows/.../artifacts?api-version` client; v0.15.0 has the new `ArtifactService` client | Pin v0.15.0 at peeled commit `de8ad967d3548d44ef623df22cf95c3b0baf8b25` |
| 3 | Gitleaks: 3 findings | Fixtures: a fake bank ref (log-redaction test) and a stub MSG91 key | Present in HEAD and commit `0b8393e` | Inline `gitleaks:allow` on the 3 lines + per-finding fingerprints in `.gitleaksignore` (no whole-commit allowlists) |
| 4 | Runs ≤ 42 died in 6s; Dependabot PRs #11-#17 die in 6-16s | `setup-node` and `gitleaks-action` pinned to SHAs that don't exist | Annotation text on those runs | Already fixed on `main`; Dependabot branches are stale (section 5) |
| 5 | **Web manifest crashes on boot** | `SMS_PROVIDER` unset → defaults to `console`, which production config forbids. Also sets reserved `PORT`, and Kubernetes-style `secretKeyRef` (Cloud Run needs a secret ID plus a version) | Booted from a Docker-equivalent layout: `FATAL [config]: SMS_PROVIDER=console is forbidden...` | Rewrote manifest |
| 6 | **Worker manifest crashes on boot** | Missing `DATABASE_URL`, `JWT_ACCESS_SECRET`, `QR_HMAC_SECRET`, `MSG91_OTP_TEMPLATE_ID` | `FATAL [config]: JWT_ACCESS_SECRET must be at least 32 bytes` | Rewrote manifest |
| 7 | **Worker could never run on Cloud Run** | No HTTP listener; Cloud Run kills Service containers that don't listen on `$PORT` | Code read | `/healthz` listener, `unref()`'d, bind errors never crash the loop |
| 8 | **Deploy workflow was fake** | Deploy step was `echo "Deployment successful."`; all steps silently skipped when secrets were missing; no image build; migrations ran with the runtime role | `deploy.yml` read | Full pipeline (section 3) |
| 9 | Re-running `npm test` on a used DB failed (4× HTTP 429, then outbox tests) | `core.auth_rate_limits` and a PENDING backlog in `sync.outbox_events` persisted between runs (94 PENDING rows starved fresh test rows; worker claims FIFO in batches of 50) | Reproduced both | Hermetic bootstrap: reset limiter; reset PENDING outbox only when DB name contains `test` |
| 10 | Possible runner drift | `ubuntu-latest` is migrating to Ubuntu 26 (runner annotation) | Annotation text | Pinned `ubuntu-24.04` in all workflows |

## 2. Verification evidence

All run locally in CI order on a **fresh** Postgres 16.15 + PgBouncer 1.22 + Node 22, on the final committed code.

| Gate | Result |
|---|---|
| Action pins vs `git ls-remote` (9/9) | PASS |
| Lockfile sync · `npm audit --omit=dev` (0 vulns) | PASS |
| `tsc --noEmit` · i18n · empty-catch grep · boundaries · contrast | PASS |
| **`check:deploy` (new)**: boots real prod config with each manifest's exact env | PASS (and **10 failures on the original manifests**) |
| Gitleaks full history + working tree | PASS (0 leaks) |
| `actionlint` on all 3 workflows | PASS |
| Migrations 14/14 (owner) · seed | PASS |
| PgBouncer transaction-mode gate: 88/88 tests + `verify-rls` (33 tables) | PASS; **also 88/88 twice back-to-back on a dirty DB** |
| Owner-mode RLS gate (`NOBYPASSRLS`, Cloud SQL path) | PASS |
| Production 5-var boot / fail-closed smoke | PASS |
| Build + budget (1083 of 1500 KB) · no demo phones in bundle | PASS |
| Scale fixture (>100k ledger rows) + 13 EXPLAIN plans (index scans, p95 < 10ms) | PASS |
| 60s two-instance load: overall p95 175ms (< 500), 0×5xx, zero oversell 10/10, ledger chain clean | PASS |
| Web + worker boot from Docker-equivalent layout with manifest env: web `/healthz` + `/readyz` 200, worker `/healthz` 200, clean exit on SIGTERM | PASS |
| Response headers on prod server (SPA, hashed asset, 404, API JSON, CORS preflight): strict CSP (no `unsafe-inline`), `frame-ancestors 'none'`, XFO DENY, nosniff, COOP/CORP/COEP, Permissions-Policy, no `Server`/`X-Powered-By`, no cookies, no CORS allow | PASS (manual passive review) |

### UNVERIFIED: not run, with the exact human command

| Not verified | Why | Command |
|---|---|---|
| **Real ZAP findings** | Needs the ZAP container | Run workflow `zap-nightly` via `workflow_dispatch`, download artifact `zap_scan`, read the report |
| **The new deploy workflow against real GCP** | No GCP project | Deploy to `staging` first (section 4) |
| Cloud Run actually accepting the manifests | Same | `gcloud run services replace` on staging |
| Whether `ubuntu-24.04` has Docker + `gcloud` + `jq` preinstalled | Assumption from runner image docs | First staging deploy will show it |

## 3. What changed (15 files)

- **Tests:** `c1-backend-compliance.test.ts` (tamper proxy), `pilot-completeness.test.ts` (fixture marker), `helpers/pg-bootstrap.ts` (hermetic state).
- **CI:** `ci.yml` (runs `check:deploy`, `ubuntu-24.04`), `zap-nightly.yml` (v0.15.0), `.gitleaksignore`, `playwright.config.ts` (webServer startup timeout 30s → 90s; in-memory PGlite boot measured at 18.5s locally, which left too little headroom on slower runners. No assertion weakened).
- **Deploy:** `deploy/cloud-run-web.yaml`, `deploy/cloud-run-worker.yaml`, `src/server/entry/worker.ts`, `scripts/check-deploy.ts`, `package.json`, `deploy.yml`.
- **Docs:** `docs/RUNBOOK.md` section 4, `AGENTS.md` rule.

New `deploy.yml` pipeline: preflight (fails loudly on missing secrets) → static gates → build + budget → build/push `harbouros:<sha>` → **migrate as owner before the new revision** → record previous revision → render manifests → `gcloud run services replace` (web, worker) → smoke (`/readyz`, `/healthz`, CSP header, worker Ready) → **auto-rollback of web traffic on failure**. It still refuses to run unless `ci.yml` succeeded for that exact commit.

## 4. Do these in this order

1. **Run `zap-nightly` manually** once CI is green. Download `zap_scan`. Triage every alert: fix, or add to `.zap/rules.tsv` with a written reason. Only then set `fail_action: true` so ZAP can fail the build (right now alerts alone never fail the job).
2. **Turn on branch protection** for `main` requiring the CI check. CI was red for 9+ consecutive runs on `main`; nothing enforced it.
3. **Do the one-time GCP setup** (`docs/RUNBOOK.md` section 4): Artifact Registry repo, 6 Secret Manager secrets, runtime service account, Workload Identity Federation, Cloud SQL (PostgreSQL 16, `RLS_PLATFORM_MODE=owner`), 3 GitHub Environments with secrets. `npm run check:deploy` prints the exact secret list.
4. **Deploy to `staging` first** via `workflow_dispatch`. Do not tag a release until staging passes the smoke step and you have used the app end to end from a phone.
5. **Clean up Dependabot** (section 5).

## 5. Dependabot PRs #11-#17

All branched from the broken pins, so they fail in seconds regardless of content.
- **Close** #11 (`google-github-actions/auth` 2→3), #13 (`@google/genai` 2→3), #14 (`lucide-react` 0→1): major bumps your config now ignores.
- **Do not merge** #12 (ZAP bump); the patch already does it correctly, with a SHA verified against the tag.
- **Rebase or recreate** the rest (`@dependabot rebase`) after `main` is green, and review each action SHA with `npm run check:actions`.

## 6. What only you can do (this is the gap between "pipeline works" and "works IRL")

- **SMS delivery (MSG91).** Real OTP and notification delivery needs an MSG91 account and, for commercial SMS in India, DLT sender-ID and template registration. Test with real phones on real networks. A working OTP flow is the login for every user.
- **Real database operations.** Backups and tested restore, point-in-time recovery, connection limits behind the pooler, and a migration rehearsal on a copy of production-shaped data.
- **Monitoring and alerting.** The code emits logs; nothing here proves anyone gets paged. Set uptime checks on `/readyz`, alerts on 5xx rate, outbox backlog (PENDING age), `DEAD_LETTER` count, and the daily ledger anchor/verify job.
- **Legal and compliance.** Get a lawyer to sign off on settlement/ledger obligations, DPDP Act data handling (including how an immutable ledger interacts with erasure requests), and the user-facing terms.
- **A pilot with real users.** Auction settlement involves money. Run one harbour with a human fallback and the `FIRST_MORNING`/`PILOT_KIT` docs, reconcile every day against their books, and compare ledger totals to cash.
- **Domain, TLS, and public exposure.** The workflow grants `allUsers` invoker on the web service. Confirm that is intended and put a domain and managed certificate in front.
- **Security beyond a baseline scan.** ZAP baseline is passive. Before public launch, get an authenticated active scan or a pentest focused on tenant isolation, OTP abuse, and the money paths.
- **Support and incident process.** Who answers a failed-settlement call at 6am, and what is the rollback decision rule.

## 7. Known risks and observations

- **Hot-lot tail latency.** 200 concurrent allocations on one lot: that scenario's p95 was **2.5-3.1s** across runs (overall p95 is 130-175ms). CI gates only the overall figure, so this tail is invisible. Correctness is fine (zero oversell); the contended path is slow. Worth a dedicated budget before real auctions.
- **Run 47** failed in 38s with no error annotation; the cause is unconfirmed. Gitleaks is plausible but unproven.
- **Runs 44-46 and older ZAP runs 6-8** were not investigated. The ZAP runs failed in 19-29s, which points to a different cause than the artifact bug. If ZAP still fails after v0.15.0, read those logs.
- **`.gitleaks.toml` still allowlists four whole commits.** That hides everything in them, including any future real secret. Prefer per-finding fingerprints.
- **The deploy workflow assumes the DB is reachable from the GitHub runner** for `npm run migrate` (public IP/authorized network, or a self-hosted runner/private path). This is a design choice you must make for Cloud SQL.
- **`robots.txt` and `sitemap.xml` return the SPA HTML with 200.** Harmless for a private app; wrong if you want search indexing control.
- **Single image for web and worker.** Fine now; if worker scaling diverges, split them.

## 8. Definition of done (measurable)

Call it launch-ready only when **all** are true:

1. `main` CI green on three consecutive runs, branch protection on.
2. ZAP run produces a report you have triaged; `fail_action: true` is set.
3. Staging deploy via the workflow succeeds, including smoke and a deliberate rollback drill.
4. Playwright and Docker steps pass in CI.
5. A restore from backup has been performed and timed.
6. Alerts fire on a synthetic failure (kill the worker; confirm someone is paged).
7. Real OTP SMS delivered on real phones (DLT-registered).
8. Legal review complete.
9. A pilot has run for at least two weeks with daily reconciliation and zero unexplained ledger differences.

---

## UI work (mobile shell, login, fisher passbook, auction pit pad, buyer/inspector & copy pass)

### Completed in the UI overhaul
- **Mobile bottom navigation & compact header** (`src/web/ui/index.tsx`, `src/web/app/App.tsx`): `>=56px` safe-area bottom tab bar for multi-workspace roles, compact top bar, desktop-only command palette, icon-only mobile Ledger trigger, scrollable `Tabs` with auto-scroll-to-active and scroll fade, and `WorkspaceSkeleton` loading placeholders.
- **Two-step bilingual login** (`src/web/app/components/LoginPortalScreen.tsx`): single-screen phone -> 6-digit OTP flow with `tel`/`one-time-code` keyboards, 56px CTA, hero illustration preserved, technical internals removed, and dev role switcher collapsed behind `<details>`.
- **Fisher passbook** (`src/web/workspaces/fisher/index.tsx`): hero "You receive" amount card and plain-language "where each sale goes" segmented bar (`₹95 / ₹2 / ₹1 / ₹1 / ₹1`) in English and Malayalam.
- **Auction Pit Pad redesign** (`src/web/workspaces/pit/index.tsx`): replaced the 5-dropdown form with visual lot cards (with `SpeciesGlyph`), tappable buyer paddle cards, large box stepper (`-`/`+`/`1`/`2`/`All`), live sale preview spotlight with floor-price check, numeric keypad + one-tap confirm, and collapsible secondary options.
- **Buyer & Inspector touch-first redesigns** (`src/web/workspaces/buyer/index.tsx`, `src/web/workspaces/inspector/index.tsx`): Buyer available trading limit hero + quick bid/box steppers; Inspector visual lot cards + 4-button grade picker + `±0.5°C` temperature stepper.
- **Plain-language copy, `humanizeCode()`, and species glyphs**: removed statute/ADR/spec cross-references across workspaces, replaced `[UNVERIFIED-HARDWARE]` with honest plain-language disclosure (`Digital scale indicator (hardware not yet verified · 25 kg / box)`), humanized `beneficiary_kind` and role/action codes, added `SpeciesGlyph` to Harbour, Weighing, Pit, Buyer, and Inspector lists, and added semantic icons & entrance animation to `Toast`.

### Still remaining before field launch
1. **Full Malayalam i18n sweep**: all new shell, login, fisher, pit, buyer, and inspector strings are bilingual (100% EN/ML key parity), while some legacy office-table column headers in Harbour/Platform remain English-only.
2. **Real-device field testing**: verify on low-end Android devices for Malayalam font shaping, soft-keyboard overlap, offline QR scanning, and flaky dockside networks.
