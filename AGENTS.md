# Craft AI — agent working rules

## Source of truth

- **`main` is the only production source of truth.**
- Amvera (`attached-assets`) must be deployed **from `main`**, never from a feature branch that forked before previous work landed.
- Open draft PRs that were never merged do **not** count as shipped — if it is not on `main`, the next feature branch will overwrite it on Amvera.
- Check live tip via `GET /api/health` → `gitSha` (set at deploy).

## Required workflow for every change

1. Branch from **up-to-date `main`**: `git fetch origin && git checkout -b cursor/<name>-1645 origin/main`
2. Implement + commit on the feature branch.
3. Open a PR → get it **merged into `main`** (draft is fine while working; merge before deploy).
4. Deploy Amvera **only after merge**, from `main`:
   ```bash
   git checkout main && git pull origin main
   APP_GIT_SHA=$(git rev-parse --short HEAD) python3 scripts/deploy-amvera.py
   ```
5. Do **not** upload random files from a feature branch that is behind `main`.

## Amvera notes

- **`AMVERA_TOKEN`** lives in Cursor Cloud Agent Secrets (not in the repo). Add it at [cursor.com/dashboard/cloud-agents](https://cursor.com/dashboard/cloud-agents) → Secrets so every agent session can deploy. Without it, `scripts/deploy-amvera.py` cannot run. Token comes from Amvera account → MCP / API access token.
- Keep **both** `amvera.yaml` and `amvera.yml` in sync at repo root. The UI warning about missing config often flashes during rebuild while files sync — if both exist on `master` and status becomes RUNNING, ignore the transient banner.
- `persistenceMount: /data` is required. Media lives under `/data/storage` — never write uploads only to the container FS.
- Per-file Amvera uploads: when changing create-modal / interactive UI, always deploy the full set (`dashboard.tsx`, `interactive-style-cards.tsx`, `trigger-look.ts`, `routes.ts`, …) from **current main**, not a stale branch copy.
- **Yandex auto-clouds:** when a storage pool hits soft bucket limit, the app auto-creates a new cloud+folder+SA+keys (`YC_BILLING_ACCOUNT_ID` + `YC_SERVICE_ACCOUNT_KEY`). `YC_ORG_ID` is resolved from the existing cloud if the env value is stale.

## Why previous deploys “rolled back”

Amvera stores the last uploaded version of each file. Uploading `dashboard.tsx` / `routes.ts` / `editor.tsx` from a branch based on stale `main` silently replaces earlier fixes that lived only on Amvera.

## Hot files (extra care)

These are touched by most features — merge conflicts here are expected; never “force upload” an older copy:

- `client/src/pages/dashboard.tsx`
- `client/src/pages/editor.tsx`
- `client/src/components/interactive-style-cards.tsx`
- `server/routes.ts`
- `server/trigger-look.ts`
- `server/auth.ts`
- `amvera.yaml` / `amvera.yml`
