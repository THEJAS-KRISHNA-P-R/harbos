# HarbourOS Agent Operating Rules

Follow these rules in every session to keep builds deterministic, safe, and fast:

## 1. Execution & Timeout Discipline
- Never run a foreground shell command that takes longer than ~60 seconds.
- Background full test suites (`npm test`, `npm run check`) and wait for completion rather than blocking.
- Use `npm run check:fast` (~10–20s) for rapid feedback on lockfile sync, TypeScript, i18n, boundaries, WCAG contrast, and unit tests.
- Keep edits small, surgical, and limited to one phase per turn. Stop and report after each phase.

## 2. CI & Supply-Chain Hygiene
- Never type or guess a GitHub Action commit SHA from memory.
- Always resolve real peeled commit SHAs via `git ls-remote --tags https://github.com/<owner>/<repo>.git refs/tags/<tag>^{}` (falling back to `refs/tags/<tag>` for lightweight tags) and verify with `npm run check:actions`.
- Every `uses:` reference in `.github/workflows/*.yml` must be pinned to a full 40-char commit SHA with an inline `# vX.Y.Z` tag comment.
- Do not weaken checks, add `continue-on-error: true`, or skip gates to make CI green.

## 3. Code & Database Invariants
- Never modify already-shipped SQL migrations (`<= 014`), domain settlement math, or Act 16 of 2021 statutory citations.
- Do not add new runtime dependencies or literal secrets.
- Every tenant-scoped table must have `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a **PERMISSIVE** policy using `core.tenant_access_allowed(tenant_id)`.
- Keep SQL `.query()` calls strictly inside `src/server/modules/**/repo.ts`, `src/server/adapters/**`, `src/server/ports/db.ts`, or `src/server/platform/seed.ts`.
- Report evidence (actual command output) for every claim, and mark anything that cannot be executed locally as `UNVERIFIED` with the exact human command.
- Deploy manifests (`deploy/*.yaml`) are validated by `npm run check:deploy`, which boots the real production config with each manifest's exact env. Any env/secret change in config.ts must be mirrored in both manifests or CI fails.
