# Bwyd Bro'r Garreg Las: working notes

Demo prototype of a local food network (buyers, producers, operator; English/Welsh; switchable operating models in `/lab`).
See `README.md` (overview), `demo.md` (how to give the demo), `DEPLOY.md` (AWS), `data/README.md` (editing the fictional organisations).

## Commands
- `npm run db:up` starts DynamoDB Local (Docker, in memory). `npm run dev` runs the API (:3001) and web app (:5173).
- `npx tsc --noEmit`; `npx vitest run` (unit + DynamoDB Local integration); `npx playwright test` (desktop and tablet projects).
- Deploy: `npm run aws -- <deploy|warmup|status|destroy|validate|help>`; `npm run deploy` runs the tests first and refuses to deploy if they fail.
  Live deploy: `npx tsx scripts/deploy.ts deploy --yes --stage demo --budget-email alan@cameronwills.org`.

## Release routine
Change, test locally, then commit, push and deploy, but only when asked: the user says "commit", "push", "deploy" separately.
Commit messages end with the Co-Authored-By line given in the session's attribution reminder.

## Gotchas
- **Slow or timing-out tests: restart DynamoDB Local** (`docker restart foodnet-dynamodb-1`). It is in memory and every test run adds sessions;
  after a day of runs, reseeding slows and tests hit the 20 s timeout (full run 650 s instead of 215 s). After restarting, wait for it
  to come up: if it is not ready, the database tests are **skipped** (e.g. "81 passed | 93 skipped"), and the deploy gate then passes without
  really testing. Re-run `npx vitest run` and check for 174 passed.
- Do not run Playwright while Vitest runs, or two Playwright runs at once: they share the local server and DynamoDB, and flake.
- The AWS account's **Lambda concurrency limit is 10**. A burst of more than a few simultaneous requests can get 503/429. Warm up with
  `--concurrency 4`. The web app retries throttled GETs. Ask AWS Service Quotas for 100+ if more people will join.
- No sign-in on the live site: anyone with the URL can use it, and the operator view can reset a session.
- Names with an apostrophe ("Bro'r") need care: use double quotes in TS/JS strings, and `''` inside single-quoted CloudFormation strings.
- Vite proxy key is `'^/api/'` (plain `/api` also matches `/api.ts`).
- Bash tool: heredocs containing apostrophes fail; write files with the Write tool, or use a small Python patch script.
  In Python patch strings, `\n` inside a normal (non-raw) string becomes a real newline: use raw strings.
- A real `deploy` or `destroy` is outward-facing: only run it when the user has asked.

## Design notes
- Sessions are isolated datasets (`?s=`), persona via `?as=`; DynamoDB single table, keys prefixed `${session}#KIND`.
- Model options live in `src/shared/models.ts` (`capabilities`, `sanitiseConfig`, presets). Older sessions are upgraded in place (`SEED_VERSION`, `upgradeSession`); new config fields need a default in `DEFAULT_CONFIG`.
- Reset takes a lock and marks the session `resetting`; readers wait. First seeding of a session also takes a lock.
- Delivery rules, shelf life and special deliveries: `src/shared/delivery.ts`, `availability.ts`. Requests accept any future date; producers may bid with their own date.
- Welsh text is machine-translated (`src/web/i18n.ts`); keep both languages in step.
