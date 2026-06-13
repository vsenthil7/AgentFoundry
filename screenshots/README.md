# Screenshots

This build environment is headless (no browser binary / display — the Playwright
chromium CDN is blocked here, see `docs/KNOWN_GAPS.md` §1), so screenshots are
**not** fabricated. Two honest paths give a reviewer the visuals:

1. **Live deploy** — follow `deploy/DEPLOY.md`; the app runs on the Vultr host at
   the override port (8096). Press **"Use demo account"** to land in a seeded
   tenant with live audit/breaker/run data.

2. **Local** — `cd web && npm install && npm run build && npm run preview`, then
   open the preview URL. To capture the full set automatically on a
   normal-network machine:

   ```bash
   cd web
   npx playwright install chromium
   npx playwright test responsive.spec.ts   # exercises auth + console at both viewports
   # screenshots land under web/test-results/ and web/playwright-report/
   ```

The numbered, per-screen walkthrough of what each screen shows (and how to reach
it by role) is in `docs/USER_GUIDE.md`. The cross-screen consistency checklist is
in `docs/VISUAL_QA.md`.
