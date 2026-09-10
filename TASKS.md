# TASKS.md — LILA Player Journey Tool · Master Checklist

> One of three docs: **`CONTEXT.md`** = what we know & why (facts, decisions) · **`TASKS.md`** = what to do (this file) · **`BUILD_LOG.md`** = what we did & how we verified it.
>
> This file is **execution only**.
> Tick items as they complete. Update status here + changelog in `CONTEXT.md` after each work block.
>
> **Status:** `TODO` · `WIP` · `DONE` (complete AND verified) · `CUT`
> **Size:** S ≈ <1h · M ≈ 1–2h · L ≈ 2–4h

---

## PHASE 0 — Project setup

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 0.1 | Create **PUBLIC** GitHub repo | S | ✅ https://github.com/msf1514/LILA_Player_Journey_Visualisation_Tool — created by user (no `gh` CLI here). Public per revised D18. README must note the data is LILA-supplied and UUID-anonymised. | `DONE` |
| 0.2 | Scaffold Vite + React + TypeScript | S | `npm create vite@latest -- --template react-ts`. TS for the data layer where typed arrays and index maps get error-prone. | `DONE` |
| 0.3 | Install deps | S | `deck.gl`, `hyparquet`. **DO NOT install `hysnappy`** — it throws `parquet decompressed page length 2 does not match header 40`. hyparquet's built-in Snappy works. Dev: `vitest`, `sharp` (minimap resize). | `DONE` |
| 0.4 | Copy `player_data/` into repo | S | 8.37 MB, 1,243 files + 3 minimaps. Committed so the pipeline is reproducible by the reviewer (D14). | `DONE` |
| 0.5 | `.gitignore` + npm scripts | S | Ignore `node_modules`, `dist`, `public/bundle.bin`, `public/minimaps/*.webp` (generated). Scripts: `build:data`, `build:maps`, `test`, `dev`, `build`. | `DONE` |
| 0.6 | Connect Cloudflare Pages to the repo | S | ✅ Linked by user. Build: `npm run build`, output `dist`. `prebuild` regenerates minimaps + bundle so a clean clone reproduces the deploy. | `DONE` |

---

## PHASE 1 — Data pipeline (build time)

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 1.1 | `pipeline/transform.mjs` — **the only place the traps live** | M | Shared by build **and** runtime drop-zone ingest. One implementation or they drift silently. Exports: `normalizeTs`, `isBot`, `worldToUV`, `normalizeRow`. | `DONE` |
| 1.1a | → Trap A: timestamps | S | `ts` is epoch **seconds** in a `timestamp[ms]` column. Correct value = `new Date(d.getTime() * 1000)`. Naive read gives 1970. True resolution is **1 second**. | `DONE` |
| 1.1b | → Trap B: bytes encoding | S | `event` is a binary column. hyparquet **auto-decodes to string** — free in JS. (Python would need `.decode('utf-8')`.) | `DONE` |
| 1.1c | → Trap C: bot detection | S | UUID `user_id` = human, numeric = bot. README's event-prefix rule is **wrong**. Flag the 3 contaminated accounts: `1429` (emits both `Position` and `BotPosition`), `1379`, `1402`. | `DONE` |
| 1.1d | → Trap D: coordinates | S | `u=(x-originX)/scale`, `v=(z-originZ)/scale`, `px=u*W`, `py=(1-v)*H`. Use **x and z only** — `y` is elevation. | `DONE` |
| 1.2 | `pipeline/mapConfig.json` | S | Ambrose 900/−370/−473 · GrandRift 581/−290/−290 · Lockdown 1000/−500/−500. **Data, not code** (D9) — a 4th map must not need a redeploy. Include a `version` field per map (D15). | `DONE` |
| 1.3 | `pipeline/build.mjs` — parquet → bundle | M | Walk 5 day-folders. **Dedupe by FILENAME** (one file duplicated across Feb 10/11, byte-identical, −88 rows → 89,016). **NEVER row-dedupe** — 2,364 identical `Loot` rows are legitimate (1-second ts resolution) and dropping them destroys ~18% of loot events. | `DONE` |
| 1.4 | Columnar binary encoding | M | Dictionary-encode users/matches/maps/events; typed arrays for the rest. Verified output: **1.96 MB → 1.04 MB gzipped** + 49 KB dictionaries. | `DONE` |
| 1.5 | `pipeline/minimaps.mjs` — image processing | S | Sources are **NOT 1024×1024** (README is wrong): Ambrose 4320², GrandRift **2160×2158 (not square)**, Lockdown 9000² JPG. Downscale to WebP, ~2048px, 24 MB → ~600 KB. Also emit a **playable-land mask** (luminance > 28) for the dead-space layer. | `DONE` |
| 1.6 | Precompute match metadata | S | Per match: map, date, duration, participant count, human count, bot count, has-combat, has-storm. Powers the match picker and lets us surface the **53 multi-participant matches**. | `DONE` |

### 1.7 — The 6 golden tests (`pipeline/transform.test.mjs`) — carries the "attention to detail" score

| # | Test | Asserts | Status |
|---|---|---|---|
| T1 | Timestamp | `ts × 1000` lands in **Feb 2026**, not 1970 | `DONE` |
| T2 | Coordinates | README's own worked example: Ambrose `x=−301.45, z=−355.55` → **pixel (78, 890)** | `DONE` |
| T3 | Bounds | 0 of 89,016 rows fall outside UV [0,1] on all 3 maps | `DONE` |
| T4 | Bot detection | UUID→human, numeric→bot; the 3 contaminated accounts flagged | `DONE` |
| T5 | Dedupe | Removes exactly **88** rows; loot rows preserved (no row-dedupe) | `DONE` |
| T6 | Combat counting | Counted by distinct `(file, ts)` instant, **not** row (42 instants carry 2 `BotKill` rows, 6 carry 3) | `DONE` |

**Pipeline acceptance:** 89,016 rows · 339 users · 796 matches · 0.00% OOB · bundle < 1.2 MB gz · all 6 tests green.

---

## PHASE 2 — Data runtime (browser)

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 2.1 | `src/data/loader.ts` | S | Fetch `bundle.bin` + `meta.json`, decode into typed arrays. Single request, no backend. | `DONE` |
| 2.2 | `src/data/store.ts` | M | In-memory columnar store + prebuilt indices: by map, by match, by date, by event, by actor type. 89k rows — indices keep filtering sub-5ms. | `DONE` |
| 2.3 | `src/data/query.ts` | L | `filter(criteria) → Uint32Array of row indices`, then `aggregate(indices, mode) → grid`. Aggregation modes: **traffic** (unique player-passes) vs **dwell** (time-weighted) — see 4.1/4.2. | `DONE` |
| 2.4 | `src/data/ingest.ts` — drag-drop | M | Accept `.nakama-0` files or a folder. Runs the **same `transform.mjs`**. Merge into store, persist in IndexedDB. Proves the pipeline is real, not a hardcoded fixture. | `DONE` |
| 2.5 | Unknown-event tolerance | S | Unrecognised event names render as neutral markers and appear in the legend — never throw (D10). There is **no `Extracted` event** today; when LILA adds one, the tool must not break. | `DONE` |

---

## PHASE 3 — Map rendering

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 3.1 | `src/map/project.ts` | S | world → UV → render-space. Never assume image pixel dimensions (they differ per map and one isn't square). | `TODO` |
| 3.2 | `src/ui/MapCanvas.tsx` | M | deck.gl `OrthographicView({flipY:false})`, world space 1024×1024, `X=u*S`, `Y=v*S`, `BitmapLayer` bounds `[0,0,S,S]`. **Verified pixel-perfect in the spike.** | `TODO` |
| 3.3 | Pan / zoom / reset | S | `controller: true`. Reset-view button. Zoom limits so users can't get lost. | `TODO` |
| 3.4 | Verify registration on all 3 maps | S | Compare against the Python reference renders. Hotspots must land inside buildings; on GrandRift they must sit on the labeled POIs (*Burnt Zone, Labour Quarters, Gas Station, Engineer's Quarters*). | `TODO` |

---

## PHASE 4 — Layers (checkboxes, not modes — D6)

| # | Layer | Size | Detail | Status |
|---|---|---|---|---|
| 4.1 | **Traffic** | M | Unique player-passes per cell. 72,849 instants. Answers "where do people go." | `TODO` |
| 4.2 | **Dwell** | M | Time-weighted occupancy. **Separate from traffic (D7)** — sampling is time-based, so a player standing 60s emits ~12 points vs a sprinter's 2. High traffic + low dwell = corridor. Low traffic + high dwell = camp spot or geometry snag. | `TODO` |
| 4.3 | **Loot** | S | 11,561 instants — **80.3% of all non-position events.** The actual gameplay loop. | `TODO` |
| 4.4 | **Kills (vs Bots)** | S | 2,361 instants. **Label must say "vs Bots" (D11)** — implying PvP would be a lie, and trust dies once and silently. | `TODO` |
| 4.5 | **Deaths** | S | 739 instants, split by cause: bot (697) · storm (39) · PvP (3). Distinct markers per cause. | `TODO` |
| 4.6 | **Dead space** | M | Playable cells with zero visits, using the mask from 1.5. Coverage: Ambrose 87% · GrandRift 84% · **Lockdown 65%**. | `TODO` |
| 4.7 | **Paths** | L | `PathLayer` per journey. **Break the path on gaps > ~30s (D12)** — median gap is 5s but max is **518s**; drawing strides the player never took destroys trust permanently. Humans solid, bots dashed. | `TODO` |
| 4.8 | **Live actors** | M | Moving dots during playback. Humans cyan, bots amber. | `TODO` |
| 4.9 | Layer control panel | S | Floating over canvas, map-app style. Opacity slider per layer. Legend always visible. | `TODO` |
| 4.10 | Colour + shape system | M | **Colorblind-safe: markers differ by shape as well as colour.** Humans cyan / bots amber. Kill = triangle, death = X, storm = hexagon, loot = small square, PvP = diamond. | `TODO` |

---

## PHASE 5 — Filters

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 5.1 | Map selector | S | Ambrose (566 matches) · Lockdown (171) · GrandRift (59). Show match counts so under-tested maps are visible. | `TODO` |
| 5.2 | Date range | S | **Default = ALL DAYS combined (D17).** Narrowing to one day is the deliberate action. Derive dates from `ts`, not folder names. | `TODO` |
| 5.3 | Match selector | M | Searchable. **Surface the ~53 multi-participant matches** — 743 of 796 are single-file, so a naive picker drops designers into a lonely single dot. | `TODO` |
| 5.4 | Actor filter | S | Humans / bots / both. | `TODO` |
| 5.5 | Event-type toggles | S | Per event type, with live counts. | `TODO` |
| 5.6 | Filter rail UI + active-filter chips | M | Left rail. Chips showing what's active, each clearable. Reset-all button. | `TODO` |

---

## PHASE 6 — Timeline & playback

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 6.1 | **Match-elapsed normalisation (D5)** | M | Timeline runs 0 → ~15 min of match time, **not wall-clock**. Matches are independent sessions; only relative time aligns. Lets one scrubber show "where is everyone at minute 3" **aggregated across every match in the filter**. This is the centrepiece. | `TODO` |
| 6.2 | Scrubber + play/pause/speed | M | 1× / 2× / 4× / 8×. Time readout as `mm:ss`. Time window filters **every** layer simultaneously. | `TODO` |
| 6.3 | Cumulative vs sliding-window mode | S | Cumulative = accumulation from match start to T. Window = what's happening *now*. Both useful; toggle between them. | `TODO` |
| 6.4 | Single-match replay | M | When one match is selected, the same control becomes a literal replay of that match. | `TODO` |
| 6.5 | Storm-window marker | S | Mark ~655s on the timeline — the storm's hard activation floor. **82% of matches end before it.** Makes the insight visible in the UI itself. | `TODO` |

---

## PHASE 7 — Comparison (promoted above the cut line, 2026-09-10)

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 7.1 | **Difference view — PRIMARY (D16)** | L | One map, colour = *change*. 🔴 more now · 🔵 less now · ⬛ no meaningful change. Human eyes are poor at diffing two heatmaps side by side; the delta makes the change itself the picture. | `TODO` |
| 7.2 | Side-by-side compare — secondary | M | Two canvases, shared or unlinked filters. Good for context, weaker for detection. | `TODO` |
| 7.3 | Comparison dimensions | S | Date vs date · map vs map · humans vs bots · match vs match. | `TODO` |
| 7.4 | Normalisation in diffs | M | **Critical:** daily volume falls 98→47 players, so raw counts always show "less." Normalise to *share of traffic*, not absolute counts, or every diff is a lie. | `TODO` |

---

## PHASE 8 — Context panel & drill-down

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 8.1 | Hotspot ranking (default panel) | L | Threshold the density grid → connected components → rank. Each row: traffic % · kills · loot % · first-seen time. **The tool arrives with an opinion** instead of a blank map. | `TODO` |
| 8.2 | Zone detail on click | M | Fly to zone, scope filters to it, show its stats. | `TODO` |
| 8.3 | Drill to individual runs | M | Zone → the runs that made it hot → one player's journey → that moment on the timeline. **Aggregate → individual in two clicks.** This is what makes it an instrument, not a poster. | `TODO` |
| 8.4 | Run detail card | S | Duration, distance, loot count, kills, deaths, human/bot, map, date. | `TODO` |
| 8.5 | Hover tooltip | S | Cell stats on hover: traffic, dwell, events. | `TODO` |
| 8.6 | Zone naming (nice-to-have) | S | Let a designer name a zone; persist in URL/localStorage. **First to cut.** | `TODO` |

---

## PHASE 9 — State & sharing

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 9.1 | URL state encode/decode (D8) | M | Map, dates, filters, layers, time window, selection, compare mode — all in the URL. | `TODO` |
| 9.2 | "Copy link" button | S | Copies current view. **The single highest-leverage adoption feature** — tools without it get used by their author and nobody else. | `TODO` |
| 9.3 | Browser back/forward | S | History integration so navigation feels native. | `TODO` |

---

## PHASE 10 — Trust, polish, accessibility

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 10.1 | **Data honesty banner** | S | Visible counts including the uncomfortable ones: **3 PvP events · 39 storm deaths · 779/780 matches have 1 human.** Never hide the gaps. | `TODO` |
| 10.2 | Empty / loading / error states | M | "No data for this filter" with a reset action. Skeleton on load. Graceful parse-failure message. | `TODO` |
| 10.3 | Onboarding hint | S | First-open tooltip: what am I looking at, what should I click. Designers, not data scientists. | `TODO` |
| 10.0 | **Design foundation** (tokens: type + colour + motion) | M | ✅ `src/design/tokens.css`. IBM Plex Sans/Mono self-hosted; Okabe-Ito colour-blind-safe data palette; chrome/data colour systems kept separate; motion budget capped at 220ms. | `DONE` |
| 10.4 | Visual design pass | L | Dark theme (matches game tooling). Consistent spacing, type scale, restrained colour so the *map* is the loudest thing on screen. | `TODO` |
| 10.5 | Performance check | S | Verified 60 FPS on software rendering in the spike. Re-verify with all layers live. | `TODO` |
| 10.6 | Keyboard shortcuts | S | Space = play/pause, arrows = scrub, `R` = reset. | `TODO` |
| 10.7 | Responsive layout | M | Must work on a laptop screen. Not mobile-first — this is a desk tool. | `TODO` |

---

## PHASE 11 — Extensibility

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 11.1 | Drop-zone UI | M | Visible affordance for adding `.nakama-0` files. Proves the pipeline is real. | `TODO` |
| 11.2 | Map-config UI | M | Add a 4th map: upload minimap, enter scale + origin, save. **No redeploy needed (D9)** — this is what makes it a tool rather than a viewer of three specific maps. | `TODO` |
| 11.3 | Map-version support (D15) | M | Multiple minimap images per map; data taggable to a version. The map didn't change in this data, but designers ship changes constantly. Cheap now, painful to retrofit. | `TODO` |

---

## PHASE 12 — Deploy (DO THIS ON DAY 4, NOT LAST — D13)

| # | Task | Size | Detail | Status |
|---|---|---|---|---|
| 12.1 | Cloudflare Pages production deploy | S | Free tier, handles private repos (GitHub Pages does **not** without a paid plan). | `TODO` |
| 12.2 | Verify from a clean browser | S | Incognito, no cache, different machine if possible. **"Can we open it and use it without your help?"** is an explicit evaluation criterion. | `TODO` |
| 12.3 | Check payload + load time | S | Target < 3s to interactive on a normal connection. Bundle is 1.04 MB gz. | `TODO` |
| 12.4 | Verify deep links work in production | S | Paste a copied URL into a fresh browser; it must restore the exact view. | `TODO` |

---

## PHASE 13 — Documentation

| # | Doc | Size | Must contain | Status |
|---|---|---|---|---|
| 13.1 | `README.md` | M | Tech stack · setup steps · env vars · **deployed URL prominently** · how to regenerate the bundle · note on data provenance. | `TODO` |
| 13.2 | `ARCHITECTURE.md` — **one page** | L | What built with + why · data flow parquet→screen · **coordinate mapping walkthrough (they call this "the tricky part")** · assumptions where data was ambiguous · **tradeoffs table** · the ~2–5M-row validity limit. | `TODO` |
| 13.3 | `INSIGHTS.md` | L | 3 insights + labeled 4th. Each: what caught the eye · concrete backing · actionable items + affected metrics · why a level designer should care. Content ready in `CONTEXT.md` §9. | `TODO` |
| 13.4 | `WALKTHROUGH.md` | M | **Must live in the repo** — "doc links or drive links will not be accepted." Annotated screenshots or embedded GIFs covering every major feature. | `TODO` |
| 13.5 | Keep `CONTEXT.md` current | S | Update after each work block. | `WIP` |

### 13.2a — ARCHITECTURE.md assumptions section (do not omit any)

- `ts` is epoch seconds despite the ms-typed column and the README's "elapsed time" claim
- Minimaps are not 1024×1024; GrandRift isn't even square
- One file duplicated across Feb 10/11; deduped by filename, **not** by row
- Identical same-second `Loot` rows are legitimate stack pickups, kept deliberately
- Bot detection via `user_id` only; 3 contaminated accounts documented
- `Kill`+`Killed` are one incident, not two; combat counted by instant
- Dataset is a **partial export** (689 solo matches contain `BotKill` — bots existed but weren't exported)
- **No `Extracted` event** in an extraction shooter; no health/weapon/team/damage/win-loss
- Solo-match dominance stated as observation, not diagnosis

---

## PHASE 14 — Submission (their exact checklist)

| # | Their requirement | Status |
|---|---|---|
| 14.1 | Tool is live at the hosted URL | `TODO` |
| 14.2 | Player paths render correctly on the minimap | `TODO` |
| 14.3 | Can tell humans apart from bots visually | `TODO` |
| 14.4 | Kill, death, loot **and storm** events are marked | `TODO` |
| 14.5 | Filtering by map / date / match works | `TODO` |
| 14.6 | Timeline or playback shows match progression | `TODO` |
| 14.7 | Heatmaps show kill zones, death zones **and** traffic | `TODO` |
| 14.8 | Architecture doc covers coordinate mapping approach | `TODO` |
| 14.9 | Three insights with supporting evidence | `TODO` |
| 14.10 | Walkthrough covers all major features | `TODO` |
| 14.11 | Single GitHub repo contains everything (no drive/doc links) | `TODO` |
| 14.12 | Reviewers added as collaborators (private repo) | `TODO` |
| 14.13 | Final pass: clone fresh → `npm i` → `npm run build` → works | `TODO` |

---

## CUT ORDER (if time runs short)

1. Zone naming (8.6)
2. Multi-actor replay for the 53 multi-participant matches (6.4 partial)
3. Map-config UI (11.2)
4. Map-version support (11.3)
5. Side-by-side compare (7.2) — **keep the difference view (7.1)**
6. Keyboard shortcuts (10.6)

**Never cut:** correct registration · the 5 core heatmaps · filters · human-vs-bot · timeline ·
deep links · the 4 docs · deployment.

---

## RISK REGISTER

| Risk | Mitigation |
|---|---|
| **Scope overrun** — the top risk | Cut order above. Deploy Day 4. Hour cap lifted (D19) but "quality over quantity" still governs: extra time → polish and docs, **not** more features. |
| Diff view misleads via volume decline | Normalise to share-of-traffic, never raw counts (7.4) |
| Private repo 404s for reviewers | Add collaborators before sending; fall back to public (Q4) |
| Hotspot clustering rabbit-holes | Time-box; fixed-grid ranking is the fallback |
| deck.gl / hyparquet failure | Both already proven in spikes (`CONTEXT.md` §4) |
| Docs rushed at the end | Draft ARCHITECTURE + INSIGHTS from `CONTEXT.md` §2/§9, which are already written |
