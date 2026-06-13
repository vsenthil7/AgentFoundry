# AgentFoundry — Visual QA Checklist (S104)

A cross-screen consistency pass run before the submission snapshot. This is the
checklist a reviewer can re-run against the live deploy. Items marked ✅ are
verified in code (design-system primitives + tokens guarantee them structurally);
items marked 👁 require a human eyeball on the rendered page and are listed so the
reviewer knows exactly what to look at.

## Design-system consistency (✅ structural)

- ✅ Every screen reads colour/space/radius/shadow/type from `ui/tokens.css` — no
  hard-coded hex except the two intentional on-brand/danger button text colours.
- ✅ Every interactive control is a design-system primitive (Button / Tabs / Field
  / Input / Modal / Banner / Badge / Table) — no bespoke buttons or inputs remain
  on the redesigned screens (auth, profile, users, platform, reviews, dashboard,
  cockpit, Golden Thread console).
- ✅ Buttons use exactly four variants (primary / secondary / ghost / danger);
  destructive actions (Reject, Deactivate, Suspend, breaker Reset) are `danger`.
- ✅ Status uses Badge tones consistently: success = green, warn = amber,
  danger = red, brand = role/identity, neutral = inactive, info = one-time secrets.
- ✅ Every async screen has the same three states: loading text, an error Banner,
  and an empty state with a human sentence (not a blank table).
- ✅ One-time secrets (temp passwords) always appear in a dismissible `info`
  Banner with "shown once" wording — never persisted, never re-displayed.

## Accessibility (✅ structural)

- ✅ Focus ring: `.af-focusable` + the primitives expose a visible focus outline
  from the token palette.
- ✅ Tabs use `role="tablist"`; modals trap the overlay click and expose a
  labelled Close control; banners expose an "Dismiss" aria-label.
- ✅ Tap targets ≥ 44px on coarse-pointer (touch) viewports (S103, `responsive.css`).
- 👁 Contrast: the light-first neutral palette targets WCAG AA; spot-check the
  `ink-faint` secondary text on `surface-2` (the lowest-contrast pairing) at the
  deployed zoom level.

## Per-screen eyeball pass (👁)

- 👁 **Auth** — card centred at 380px and 1280px; password-strength text changes
  colour as you type; demo button only in login mode.
- 👁 **Golden Thread console** — the stepper marks done stages with ✓ and the
  active stage in brand colour; cards align in a 2-up grid on desktop, single
  column on mobile; the audit log is monospace and scrolls.
- 👁 **Profile** — three stacked cards; the change-password button enables only
  when the form is valid; the mismatch error shows under the confirm field.
- 👁 **Users / Platform** — table rows align; per-row action clusters wrap and
  left-align on mobile; modals are reachable and dismissible.
- 👁 **Reviews** — score badge tone matches the threshold; the reject reason field
  gates the confirm button.
- 👁 **Dashboard** — the state pill colour matches the worst active flag; progress
  bars never exceed 100% (zero-total guarded); flag banners order most-severe-first.
- 👁 **Cockpit** — the four tabs switch without layout shift; the error-rate and
  verdict badges colour correctly.

## Responsive (✅ S103 + 👁)

- ✅ No horizontal overflow on auth or console at the Pixel-7 width (asserted by
  `responsive.spec.ts`).
- ✅ Multi-column grids collapse to one column under 700px; the stepper scrolls
  horizontally under 400px.
- 👁 Rotate / resize between 380px and 1280px and confirm nothing clips or
  overlaps.

## Deploy parity (✅ verified)

- ✅ Base `docker-compose.yml` publishes **no** host port (`expose: 8080` only);
  `deploy/docker-compose.override.example.yml` owns the host mapping
  (`8096:8080`) — `docker compose config` resolves to `published: 8096 → target:
  8080` with `AF_SEED=1` and the durable `/data` volume. No port-merge collision.
- ✅ `AF_DATA` + the named volume make auth/users durable across restarts (the
  S89 login-persistence fix).
- 👁 On the live host: `cp deploy/docker-compose.override.example.yml
  docker-compose.override.yml && docker compose up -d --build`, then load the app,
  press **Use demo account**, and confirm the console renders with seeded data.
