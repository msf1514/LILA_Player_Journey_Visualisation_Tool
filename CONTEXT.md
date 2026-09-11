# CONTEXT.md — LILA Games Written Test · Living Session Handoff

> **Purpose:** This file is the single source of truth for this project. If a session runs out
> of context, a fresh session must be able to read **only this file** and continue work with no
> loss of decisions, findings, or momentum.

---

## 0. HOW TO MAINTAIN THIS DOC (read this first)

**Update this file after every substantive response.** Not every message — but any response that
produces a finding, a decision, a correction, code, or progress.

### Rules

1. **Self-sufficiency.** A fresh session reading only this file must be able to continue.
   Never write "as discussed above" or "per the earlier analysis" — restate the fact.
2. **Evidence over assertion.** Every claim carries its number and how it was verified.
   Write `89,016 rows after dedupe (verified: pipeline/transform.test.mjs)`, never "the data is clean."
3. **Corrections are never deleted.** Wrong claims move to §3 Corrections Log with what replaced
   them. A future session must not re-derive a retracted conclusion and re-introduce the bug.
4. **Decisions carry rationale.** Record *why*, and what was rejected. Otherwise it gets relitigated.
5. **Status must be honest.** Never mark something DONE that is untested. Use the status vocabulary below.
6. **Newest changelog entry goes on top** (§10).
7. **Keep it tight.** Prune superseded detail; preserve every decision, number, and correction.
8. **Absolute dates only.** "Feb 10, 2026", never "yesterday" or "day 2".

### Status vocabulary

| Token | Meaning |
|---|---|
| `PROVEN` | Verified by running code; evidence cited |
| `ASSUMED` | Reasonable assumption, documented, not verified |
| `OPEN` | Unresolved; needs decision or investigation |
| `RETRACTED` | Was believed, now disproven — see §3 |
| `TODO` | Planned, not started |
| `WIP` | In progress |
| `DONE` | Complete **and** verified |

### Update checklist (run through this each time)

- [ ] §1 Current Status reflects reality
- [ ] New findings → §2 with evidence
- [ ] Anything disproven → §3 Corrections Log
- [ ] New decisions → §5 with rationale + rejected alternative
- [ ] Build progress → §7 checkboxes
- [ ] New questions → §8
- [ ] §10 Changelog entry added on top

---

## 1. CURRENT STATUS

**Project:** LILA Games — Product Engineer Written Test
**Deliverable:** Player Journey Visualization Tool + hosted URL + 3 docs, in ONE GitHub repo
**Deadline:** 5 days from receipt · **Effort budget:** no fixed hour cap (D19); deadline is the constraint
**Repo:** https://github.com/msf1514/LILA_Player_Journey_Visualisation_Tool (public)
**Live:** https://lila-pjvt.msf1514.workers.dev — Cloudflare Worker + Static Assets, auto-deploys on push to `main`
**Phase:** **Phases 0–6 COMPLETE.** Pipeline, runtime, canvas, layers, filters and the timeline verified; 63 tests green.
**Next action:** Phase 7 — difference view (share-normalised) and side-by-side compare

Docs: `CONTEXT.md` (facts/decisions) · `TASKS.md` (checklist) · `BUILD_LOG.md` (activity log w/ evidence)

### Required deliverables (from the PDF)

| Item | Status |
|---|---|
| Working tool, hosted, shareable link | `WIP` — hosted and auto-deploying; tool itself is at Phase 3 |
| `README.md` — stack, setup, env vars | `TODO` |
| `ARCHITECTURE.md` — 1 page, incl. coordinate mapping walkthrough | `TODO` |
| `INSIGHTS.md` — 3 insights w/ evidence + actionable metrics | `TODO` (content ready, see §9) |
| `WALKTHROUGH.md` — must be **in repo**; drive/doc links rejected | `TODO` |

### Core feature requirements (from the PDF)

Parse parquet · journeys on correct minimap · humans vs bots visually · distinct event markers ·
filter by map/date/match · timeline playback · heatmap overlays (kill/death/traffic) · hosted link

---

## 2. VERIFIED DATA FACTS

Dataset: `D:\Lila\player_data\` — 1,243 files across `February_10` … `February_14`, plus `minimaps/`.

### Headline numbers — `PROVEN`

| Metric | Value | Note |
|---|---|---|
| Files on disk | 1,243 | 1,242 unique basenames — one exact duplicate |
| Rows (raw) | **89,104** | matches README's "~89,000" |
| Rows after dedupe | **89,016** | −88 from the duplicated file |
| Unique users | 339 | = 245 humans + 94 bots (README's "339 players" includes bots) |
| Unique matches | 796 | zero `match_id` collisions; all suffix `.nakama-0` |
| Raw parquet size | 8.37 MB | |
| Real date range | **2026-02-09 23:58 → 2026-02-14 15:01 UTC** | |

Cross-validated: Python/pyarrow and JS/hyparquet produce **identical** counts on every field.

### The four traps (the PDF explicitly warns: *"coordinate mapping, bytes encoding, bot detection, timestamps"*)

**A. Timestamps — `ts` is epoch SECONDS stored in a `timestamp[ms]` column.** `PROVEN`
- Naive read → `1970-01-21`. Correct: **multiply by 1000**.
- Proof: interpreting the integer as seconds aligns dates to folder names at **99.5%** across 5 folders.
- **The README is wrong** where it says ts is "time elapsed within the match, not wall-clock." It is wall-clock.
- Side effect: true resolution is **1 second** (sub-second decimals are an artifact).

**B. Bytes encoding — `event` is a binary column.** `PROVEN`
- Python: needs `.decode('utf-8')`. JS/hyparquet: **auto-decodes to string, free.**

**C. Bot detection — only `user_id` shape is reliable.** `PROVEN` (99.2%)
- UUID = human, numeric = bot. **The README's event-prefix rule is wrong**: bots emit 636 `Position`
  and 115 `Loot`; humans emit 403 `BotKilled`.
- **3 contaminated accounts** (751 rows, 0.84%) — must be handled explicitly:
  - `1429` — emits BOTH `Position` and `BotPosition`, plus `Loot`/`BotKill`. 890 rows, 17 matches. Only such account.
  - `1379`, `1402` — numeric IDs but only human-type events.

**D. Coordinate mapping — the documented formula is CORRECT.** `PROVEN` by four independent methods.

```
u = (x - originX) / scale
v = (z - originZ) / scale
pixel_x = u * W
pixel_y = (1 - v) * H          # Y flipped: image origin is top-left
# use x and z only. y is ELEVATION, not a 2D coord.
```

| Map | Scale | Origin X | Origin Z |
|---|---|---|---|
| AmbroseValley | 900 | -370 | -473 |
| GrandRift | 581 | -290 | -290 |
| Lockdown | 1000 | -500 | -500 |

Four proofs:
1. **0.00% out-of-bounds** across all 89,104 rows on all 3 maps
2. **Visual registration** — hotspots land inside buildings; traffic traces follow roads; on GrandRift
   they sit exactly on the labeled POIs (*Burnt Zone, Labour Quarters, Gas Station, Engineer's Quarters*)
3. **99.3%+ containment** in an independently-derived playable-land mask (3 / 1 / 0 strays)
4. **Physically plausible speeds** — median 2.52 m/s, p99 6.42, max 12.65, zero teleports.
   Confirms **world units are metres.**

### Minimaps — README's "1024×1024" is WRONG `PROVEN`

| File | Actual size | Note |
|---|---|---|
| `AmbroseValley_Minimap.png` | 4320 × 4320 | 9.7 MB |
| `GrandRift_Minimap.png` | **2160 × 2158** | **not square** |
| `Lockdown_Minimap.jpg` | 9000 × 9000 | 11.8 MB |

→ Never assume 1024. Normalise to UV, scale to render size. Total 24 MB must be downscaled for web.

### Duplicate file — dedupe by FILE, never by ROW `PROVEN`

- `cfa03e9f-81f6-41ef-a0fa-30c7e830f4ed_ac049b28-8116-4ff1-9e60-4be0537b8cc9.nakama-0` exists in BOTH
  `February_10` and `February_11`, **byte-identical (same SHA-256)**, 88 rows.
- **DO NOT call `drop_duplicates()` on rows.** 2,865 rows are byte-identical *legitimately* — 2,364 of
  them `Loot` across 449 files — because `ts` has 1-second resolution and a player can loot several
  items in one second. Naive row-dedupe silently destroys **~18% of all loot events**.

### Event inventory — `PROVEN`

| Event | Rows | Distinct `(file, ts)` instants |
|---|---|---|
| `Position` | 51,347 | 51,137 |
| `BotPosition` | 21,712 | 21,712 |
| `Loot` | 12,885 | 11,561 |
| `BotKill` | 2,415 | 2,361 |
| `BotKilled` | 700 | 697 |
| `KilledByStorm` | 39 | 39 |
| `Kill` | 3 | 3 |
| `Killed` | 3 | 3 |

**Count combat by distinct `(file, ts)` instant, NOT by row** — 42 instants carry 2 `BotKill` rows, 6 carry 3.

### Structural findings — `PROVEN`

**The game is 1 human + N bots. PvP is structurally near-impossible.**
- **779 of 780 human-bearing matches contain exactly ONE human.** Exactly one match has two. Max = 2.
- Bots per match cluster at 6, 7, 14, 15.
- `Kill`/`Killed` are **two rows for ONE incident** in the *same* file at the same instant → **3 PvP
  incidents, not 6.** All 3 sit in matches with no opponent file.
- Not an export artifact: **91% of human runs (712/781) contain a `BotKill`.** Combat logging works fine.
- PvE : PvP ≈ **787 : 1**.
- Cause is **population, not a matchmaker bug**: median concurrent human matches = **1**; 2+ humans
  online simultaneously only 38% of the time (same-map: Ambrose 32%, Lockdown 9%, GrandRift **2%**).
- Rate is 0.6 PvP/day → ~167 days needed for a usable PvP heatmap. **More data will not fix this.**

**The dataset is a PARTIAL export.** `PROVEN`
- **689 of 743 single-file matches contain `BotKill`/`BotKilled`** — you cannot kill a bot that isn't
  in the match. Bots were present; their files weren't exported.

**Storm has a hard activation floor at ~655s elapsed.** `PROVEN`
- Zero storm deaths before 655s, ever. Only **140/796 matches (18%)** last long enough; 39 produce a death.
- **82% of matches end before the storm exists as a mechanic.**

**Loot dominates.** `PROVEN` — **80.3% of all non-position events.** Median human run = 16 pickups.

**Map usage vs PLAYABLE land** (not whole image) `PROVEN`

| Map | Coverage of playable land | Matches | Share |
|---|---|---|---|
| AmbroseValley | **87%** | 566 | 71.1% |
| GrandRift | **84%** | 59 | 7.4% |
| Lockdown | **65%** | 171 | 21.5% |

**The map did NOT change during the 5 days.** `PROVEN`
- Playable extents are stable across all 5 days on all 3 maps (e.g. Ambrose X −325→~278, Z −380→~355 every day).
- Apparent "cells lost" on later days track **sample size**, not geometry (Feb 14 Ambrose = 3,238 pts vs Feb 10 = 24,079).
- There is **no map-version field** in the telemetry and only one minimap image per map.
- → With this dataset we can compare **behaviour across days**, but NOT map geometry versions.
  The tool is still built map-version aware (see D15) so it works when LILA does ship a change.

**Retention / engagement** `PROVEN`
- **84% of humans (205/245) played on exactly one day.** Daily humans: 98 → 80 → 59 → 47 → 12.
- Decline is REAL, not truncation: each day covers a full 22–24h. (Feb 14 is genuinely partial, 15h.)
- New humans first seen per day: 97 → 65 → 43 → 32 → 7.

**Other verified facts**
- Zero nulls. Zero `(0,0,0)` origin artifacts. Zero negative time steps. No match spans >1 map.
- No user appears in two files of the same match. Exactly 8 event types — no hidden ninth.
- Position sampling: median gap **5s**, mean 6s, p99 25s, **max 518s** → paths MUST break on large gaps.
- Match duration: median **382s**, p90 720s, max 890s.
- Folder names align to **UTC** days at 99.5% (minor midnight bleed; 3 matches span 2 UTC dates).
- `y` is elevation: Ambrose 100–163, GrandRift 8–47, Lockdown 33–71. Correlates with x/z on Lockdown (−0.64) → sloped map.

### Telemetry GAPS worth naming in ARCHITECTURE.md
**No `Extracted` event** in a game the README calls an extraction shooter. No health, weapon, team,
damage, or win/loss. **This telemetry cannot tell you whether anyone succeeded.**

---

## 3. CORRECTIONS LOG — do not re-derive these

| # | Was claimed | Reality | Cause |
|---|---|---|---|
| 1 | "6 PvP kills" | **3 incidents.** `Kill`+`Killed` are two rows for one event in the same file | Counted rows, not instants |
| 2 | "Every day-folder spills into the next day" | **False.** Folders align to UTC at 99.5% | My own IST timezone conversion in the check |
| 3 | "Players use only 33–43% of each map" | **False.** 87% / 84% / 65% of *playable land* | Counted ocean/void as unused map |
| 4 | "743 solo matches = low concurrency" | **Partial export.** 689 of them contain `BotKill` | Assumed export completeness |
| 5 | "Negative space is the headline feature" | **Demoted.** Only Lockdown (65%) qualifies | Followed from correction #3 |
| 6 | "Use `hysnappy` for Snappy decompression" | **Breaks it.** hyparquet's built-in works | Assumed the companion lib was needed |
| 8 | "60 FPS locked" from the deck.gl perf spike | **Worthless measurement.** It ran under `--use-gl=swiftshader`, where deck.gl fires `onAfterRender` and logs no error but **draws nothing** — so it timed an empty loop. Real pacing while panning (1280x900, real GL): median **16.7 ms**, p90 31.7 ms with no data overlay, 94.1 ms with 9,739 raw points. Conclusion unchanged (median ~60 fps) but the original evidence was not evidence. **Never pass GL flags to Playwright when verifying deck.gl output.** | Trusted frame timings without looking at the rendered frame |
| 11 | A playback clock can safely sync its position from React state each render | **No.** Doing so made playback run at exactly half speed: each rAF frame advanced the ref, called setState, then a render-phase effect wrote the older uncommitted value back over it. A clock must own its position; callers push in only when they seek. | Treated a real-time integrator like derived state |
| 10 | Filtering whole journeys is correct for every filter | **Not for time.** Map, date and actor choose WHICH journeys to draw. Time must clip points: filtering by journey drew a complete twelve-minute route while the clock read 01:00, so the map contradicted the timeline. | Generalised a rule that was only right for non-temporal filters |
| 9 | Memoising deck.gl `Layer` instances is a safe optimisation | **False, and silently destructive.** Layers are single-use descriptors; reusing an instance breaks the lifecycle and the layer stops drawing with **no error**. It also corrupted a perf measurement, since not-drawing looks fast. Cache the expensive *input* (an image, a data array); construct layers fresh every render. | Assumed React memoisation rules applied to deck.gl objects |
| 7 | "Map coverage is 87 / 84 / 65% of playable land" — quoted as a bare figure | **Resolution-dependent.** At 64×64 with the shipped 256² mask: **83 / 65 / 55%**. At 32×32: 87 / 84 / 65%. Finer grids always read lower. **Ranking is stable — Lockdown is consistently worst — and that is the real insight.** INSIGHTS.md must state the grid resolution; the dead-space layer must use one fixed resolution. | Treated a grid-dependent statistic as an absolute |

---

## 4. SPIKE RESULTS — both risks retired `PROVEN`

Spike dir: `C:\Users\msf15\AppData\Local\Temp\claude\d--Lila\0614ff63-754d-40c7-afd0-d9a748ecbfd7\scratchpad\spike`
Python pickle of the full dataset: `…\scratchpad\all.pkl`

**Spike 1 — JS can read the parquet natively.** `hyparquet@1.30.0`
- All 1,243 files parsed, **0 failures, 2.0 seconds**.
- Exact match with Python on rows / users / matches / files / every event count / 0.00% OOB.
- **CRITICAL GOTCHA: do NOT install or pass `hysnappy`.** It throws
  `parquet decompressed page length 2 does not match header 40`. Use hyparquet's built-in Snappy —
  i.e. call `parquetReadObjects({ file })` with **no `compressors` option**.
- Files are parquet v1.0, `parquet-go`, SNAPPY + PLAIN/RLE_DICTIONARY — vanilla, fully supported.
- Schema root is named `parquet_go_root` (harmless).
- `ts` arrives as a JS `Date`; correct value = `new Date(d.getTime() * 1000)`.

**Spike 2 — deck.gl registration is pixel-perfect.**
- `OrthographicView({flipY:false})`, world space = 1024×1024, `X = u*S`, `Y = v*S`,
  `BitmapLayer` bounds `[0,0,S,S]`. Render matches the Python reference exactly. Zero console errors.

**Spike 3 — payload size**

| Encoding | Size |
|---|---|
| Raw parquet, 1,243 files | 8.37 MB |
| Naive JSON | 15.45 MB (2.40 MB gz) |
| **Columnar typed-array binary** | **1.96 MB → 1.04 MB gzipped** |
| Dictionaries (users/matches/maps/events) | 49 KB |

**Spike 4 — playback performance**
- 180-frame scrub, heatmap rebuilding every frame over 48,691 points:
  **60 FPS locked**, median frame 16.7 ms, worst 18.7 ms — **on software rendering (SwiftShader), no GPU.**

---

## 5. DECISIONS (with rationale)

| # | Decision | Rejected | Why |
|---|---|---|---|
| D1 | **Static site, no backend** | FastAPI+React; Streamlit | 8 MB of data. No cold starts, nothing to break during evaluation. Streamlit free tier sleeps → 30s spinner on first open. |
| D2 | **Client-side parquet parsing (hyparquet)** | Precomputed JSON | ONE code path shared by build + drop-zone ingest. Two implementations would drift silently. |
| D3 | **deck.gl rendering** | Canvas 2D; SVG; Pixi | `HeatmapLayer`(weighted)/`PathLayer`/`TripsLayer` map 1:1 to three requirements. SVG dies at 73k points. Verified 60 FPS. |
| D4 | **Ship raw rows, aggregate client-side** | Ship precomputed aggregates | Preserves drill-down + arbitrary filters. 1 MB is free. |
| D5 | **Timeline normalised to MATCH-ELAPSED time (0→~15min)** | Wall-clock timeline | Matches are independent sessions; only relative time aligns. Lets one scrubber aggregate "where is everyone at minute 3" across all matches. |
| D6 | **No modes — layer checkboxes + one global time window** | Separate Pressure/Journeys/Replay modes | Designers need paths *on top of* heatmaps. One time model drives every layer. |
| D7 | **Traffic and Dwell are SEPARATE layers** | Single density heatmap | Time-based sampling conflates "everyone passes" with "one person camped" — opposite design problems. |
| D8 | **All state in the URL** | Local state only | Paste-into-Slack is the single highest-leverage adoption feature. |
| D9 | **Map config is DATA (JSON + UI), not code** | Hardcoded constants | A 4th map must not require a redeploy. This is what makes it a tool, not a viewer. |
| D10 | **Unknown event types render as neutral markers** | Throw / ignore | No `Extracted` event exists yet; the tool must not break when LILA adds one. |
| D11 | **Label layers "Kills (vs Bots)"** | Bare "Kill Zones" | Implying PvP would be a lie; trust dies once and silently. |
| D12 | **Paths BREAK on sampling gaps >~30s** | Interpolate through | Max gap is 518s. Drawing strides the player never took destroys trust permanently. |
| D13 | **Deploy on Day 4, not Day 5** | Deploy last | Deployment is where take-homes die. Buffer > features. |
| D14 | **Commit raw data + run pipeline at build** | Commit only the bundle | Makes the pipeline reproducible and verifiable by the reviewer. |
| D15 | **Map-version aware from day one** — multiple minimap images per map, data taggable to a version | Single image per map | The map didn't change in this data, but level designers ship map changes constantly. Cheap now, painful to retrofit. |
| D16 | **DIFFERENCE view is the primary comparison UI**; side-by-side is secondary | Side-by-side only | Human eyes are poor at diffing two heatmaps. A delta map (red = more, blue = less, grey = no change) makes the *change itself* the picture. Build both; the delta is the one that earns its keep. |
| D17 | **"All days combined" is the DEFAULT view** | Default to a single day | Designers should see everything on open; narrowing to one day is the deliberate action. |
| D18 | **PUBLIC GitHub repo + Cloudflare Pages** *(revised 2026-09-10)* | Private repo | Originally private, but reviewer GitHub usernames are unobtainable (Q4) and a private link 404s for them — which looks like a broken submission. **A working link beats a careful one.** Materially, privacy bought little anyway: the deployed site necessarily serves `bundle.bin` to the browser, so the telemetry is downloadable by anyone with the URL regardless of repo visibility. README must note the data is LILA-supplied and UUID-anonymised, and offer to strip it on request. Can be flipped private later at no cost. |
| D19 | **No fixed hour budget; the 5-day deadline is the constraint** | Cap at 10–15h | User instruction (2026-09-10). Extra time goes to **polish, correctness, and docs — NOT feature sprawl.** "Quality over quantity" is their stated evaluation principle, not a time-saving compromise. |
| D20 | **IBM Plex Sans + IBM Plex Mono**, self-hosted via `@fontsource` | Inter; Geist; a display face (Clash/Cabinet/Outfit) | Inter is the default of defaults and reads as unconsidered. Display faces earn their keep in a hero; here every string is an 11–13px label, count or timestamp, where character is a liability. IBM drew Plex for technical/data-dense interfaces: humanist so it reads warm not clinical at small sizes, unambiguous numerals, and Plex Mono is a true metric companion. **All numbers are set in tabular figures** — proportional numerals make two values in a stats panel impossible to compare by eye. Self-hosted to avoid a Google Fonts round-trip and FOUT. |
| D21 | **Two separate colour systems: chrome vs data** | One accent colour (the usual rule) | The "max one accent" rule is written for marketing pages. A data instrument must separate six categories at a glance, so hues here are *semantic encodings*, not brand colours. Chrome = cool neutrals + one accent (`#3a8fd9`) for selection/focus only. Data = **Okabe-Ito**, engineered to stay distinguishable under protanopia, deuteranopia and tritanopia. Colour is never the only channel — every marker also differs by shape. Purple (`#b06cff`) dropped for storm: too close to the AI-purple tell, and yellow carries "environmental hazard" better. |
| D22 | **Low motion budget; ceiling 220ms** | Standard 300ms UI ceiling | A designer toggles layers and scrubs the timeline dozens of times a minute. Animating high-frequency actions fights the user. Data being read never moves for style. Named easing curves so timing stays coherent; `prefers-reduced-motion` honoured globally. |
| D23 | **Full-viewport layout, high density** | `max-w-7xl` centred container (the landing-page convention) | Constraining a map tool to 1440px wastes a designer's monitor. Target VISUAL_DENSITY is cockpit-level (~8), not the airy 4 that suits marketing pages. |

### Guiding principles
- **Describe precisely. Never prescribe falsely.** No invented severity scores or fake AI recommendations —
  we have no ground truth on designer intent.
- **Trust is a feature you build, not a property you claim.**
- **Quality over quantity** — the brief says 4 well-executed features beat 10 half-working ones.

### Architecture validity limit
Correct up to ~**2–5M rows** (≈50× headroom). Beyond that the browser is the wrong place to aggregate →
switch to a backend with columnar storage or precomputed tiles. **State this in ARCHITECTURE.md.**

---

## 6. ARCHITECTURE

### Data flow

```
1,243 .nakama-0 files (8.37 MB)
   │  [BUILD — node pipeline/build.mjs]
   ▼  hyparquet, built-in Snappy (NEVER hysnappy)
transform.mjs  ◄── THE ONLY PLACE THE TRAPS LIVE
   · dedupe duplicated FILE (−88 rows → 89,016)   · NEVER row-dedupe
   · ts × 1000   · isBot(user_id)   · worldToUV(x, z, cfg)
   │
   ├─► public/bundle.bin   1.96 MB → 1.04 MB gz
   ├─► public/meta.json    dictionaries + map config (49 KB)
   └─► public/minimaps/    WebP, 24 MB → ~600 KB
   │  [RUNTIME — static, no backend]
   ▼  fetch → typed arrays → indices (map/match/day/event)
filter → grid aggregate → deck.gl layers → screen
   ▲
   └── drag-drop .nakama-0 → SAME transform.mjs
```

### Repo structure

```
pipeline/
  build.mjs            parquet → bundle
  transform.mjs        ◄ shared with runtime; all 4 traps live here
  transform.test.mjs   ◄ golden tests
  minimaps.mjs         downscale to WebP
src/
  data/    loader.ts · ingest.ts · store.ts · query.ts
  map/     config.ts (data-driven) · project.ts · layers.ts
  ui/      FilterRail · LayerPanel · Timeline · ContextPanel · MapCanvas
  state/   url.ts
public/    bundle.bin · meta.json · minimaps/
ARCHITECTURE.md  INSIGHTS.md  WALKTHROUGH.md  README.md  CONTEXT.md
```

### The 6 golden tests (these carry the "attention to detail" score)

| # | Test | Asserts |
|---|---|---|
| T1 | Timestamp | `ts × 1000` lands in **Feb 2026**, not 1970 |
| T2 | Coordinates | README's own worked example: Ambrose `x=-301.45, z=-355.55` → **pixel (78, 890)** |
| T3 | Bounds | 0 of 89,016 rows fall outside UV [0,1] |
| T4 | Bot detection | UUID→human, numeric→bot; the 3 contaminated accounts flagged |
| T5 | Dedupe | removes exactly **88** rows; loot rows preserved (no row-dedupe) |
| T6 | Combat counting | counted by `(file, ts)` instant, not row |

### UI layout

```
┌──────────┬────────────────────────────────────┬──────────────┐
│ FILTERS  │                                    │  CONTEXT     │
│ Map      │          MAP CANVAS                │ default:     │
│ Date     │        (deck.gl, dominant)         │ ranked       │
│ Match    │      ┌──────────────┐              │ hotspots     │
│ Actor    │      │ Layers panel │              │ on select:   │
│ Events   │      └──────────────┘              │ zone/run     │
├──────────┼────────────────────────────────────┴──────────────┤
│          │  ▶  ├────────●──────────────┤  match minute 3:42  │
└──────────┴───────────────────────────────────────────────────┘
```

### Layers

| Layer | Signal | Instants |
|---|---|---|
| Traffic | unique player-passes / cell | 72,849 |
| Dwell | time-weighted occupancy | 72,849 |
| Loot | pickup density | 11,561 |
| Kills *(vs Bots)* | player kills | 2,361 |
| Deaths | split bot / storm / PvP | 739 |
| Dead space | playable cells, zero visits | — |
| Paths | journeys, human vs bot | 1,242 runs |
| Live actors | moving dots during playback | — |

Humans = cyan, bots = amber. Markers differ by **shape as well as colour** (colorblind-safe).
Context panel defaults to a **ranked hotspot list** (thresholded density grid → connected components),
each row showing traffic % · kills · loot % · first-seen time. Click → fly to zone → click → individual runs.

---

## 7. BUILD PLAN & PROGRESS

> **Execution checklist lives in `TASKS.md`** — 14 phases, ~90 tasks, with the cut order and risk
> register. This section holds the day-level shape; `TASKS.md` holds the item-level detail.

| Day | Hrs | Deliverable | Done when | Status |
|---|---|---|---|---|
| 1 | 3 | Pipeline, `transform.mjs`, 6 tests, bundle, minimaps | Tests green; bundle <1.2 MB gz | `TODO` |
| 2 | 4 | Canvas, map config, filters, 5 heatmap layers | All 3 maps register | `TODO` |
| 3 | 3 | Timeline (match-elapsed), playback, paths w/ gap breaks, human-vs-bot | Scrub feels smooth | `TODO` |
| 4 | 2 | Hotspot ranking, drill-down, URL state, **DEPLOY** | Live link works from clean browser | `TODO` |
| 5 | 3 | ARCHITECTURE · INSIGHTS · README · WALKTHROUGH | Checklist ticked | `TODO` |

*(Plan predates D19 — no fixed hour budget; the 5-day deadline is the constraint. Day 6 added below.)*

| 6 | — | Difference view, side-by-side compare, drop-zone ingest, map-config UI, polish | Delta view reads clearly | `TODO` |

### Cut line

**Ship no matter what:** correct registration · 5 heatmaps · map/date/match filters · human vs bot ·
timeline + playback · deep links · **difference view** · **all-days default** · the 4 docs.

**Now above the line (promoted 2026-09-10):** difference view (D16) · side-by-side compare ·
map-version awareness (D15) · drop-zone ingest · map-config UI.

**Cut in this order if short on time:** zone naming → multi-actor replay for the 53
multi-participant matches → map-config UI.

**Top risk: scope overrun**, not technology. Both technical risks are already retired (§4).
With the hour cap lifted (D19), extra time goes to **polish, correctness and docs — not more features.**

---

## 8. OPEN QUESTIONS

All three original questions were **resolved by the user on 2026-09-10**:

| # | Question | Resolution |
|---|---|---|
| Q1 | Does **A/B comparison** earn a slot above the cut line? | `DONE` — **Yes, above the line.** Upgraded: the primary UI is a **difference view** (D16), with side-by-side as secondary. Plus map-version awareness (D15) and "all days" default (D17). |
| Q2 | Does the **retention finding** go in INSIGHTS.md? | `DONE` — **Yes**, as a clearly-labeled 4th "beyond level design" item. The 3 main insights stay level-design-focused. |
| Q3 | Repo public or private? | `DONE` — **Private**, deployed via **Cloudflare Pages**. Reviewers added as collaborators *before* sending. Submission must disclose that the deployed site serves the dataset publicly (see D18). Can be flipped to public later at no cost. |

| Q4 | Reviewer GitHub usernames for private-repo access | `DONE` (2026-09-10) — **unobtainable → repo is PUBLIC.** See revised D18. |

### Still open

*(none)*

### Environment notes
- `gh` CLI is **not installed**. Repo creation and the initial push must be done by the user, or
  `gh` installed first. Git is available (2.53.0) and configured as `msf1514 / msf1514@gmail.com`.

### Do NOT ask LILA about the data
The PDF explicitly pre-authorises self-resolution: *"Document your assumptions. If something is
unclear, make a reasonable assumption and note it. **Don't get blocked.**"* Every trap found so far
falls inside the four nuances the PDF itself names. Asking would signal an inability to operate
under ambiguity — the ambiguity *is* the test.

---

## 9. INSIGHTS.md — candidate content (evidence ready)

Each needs: what caught the eye · concrete backing · actionable items + affected metrics · why a designer cares.

**Insight 1 — The storm is not a mechanic for 82% of players.**
Hard activation floor at ~655s elapsed; zero storm deaths before it. Only 140/796 matches (18%) reach
it; 39 produce a death. Median match is 382s. → Actionable: pull activation earlier or shorten matches.
Metrics affected: match duration distribution, storm-death rate, extraction-timing pressure.

**Insight 2 — This is a single-player PvE looting game, not an extraction shooter.**
779/780 human-bearing matches have exactly ONE human. PvE:PvP ≈ 787:1 (2,361 vs 3 instants).
Loot = 80.3% of all non-position events. Population-bound, not matchmaker-bound: median concurrency 1;
GrandRift has 2+ humans online only 2% of the time. → Actionable: bot encounter placement *is* the
combat design; consider merging map rotation to concentrate population.

**Insight 3 — Lockdown wastes a third of its playable space; the other two maps don't.**
Coverage of playable land: Ambrose 87%, GrandRift 84%, **Lockdown 65%**. → Actionable: identify cold
zones in Lockdown, add loot/objective pull or cut the area. Metrics: coverage %, traffic distribution.

**Bonus (labeled, beyond level design) — 84% one-and-done retention.** 205/245 humans played exactly
one day; daily humans 98→80→59→47 across full-coverage days.

---

## 10. CHANGELOG (newest first)

### 2026-09-11 - PHASE 6 COMPLETE (timeline and playback)
- Scrubber on MATCH-ELAPSED time with playback, speed control, cumulative vs last-30s mode,
  survivor density band, storm marker at 10:55, and a live "N of M matches still running" count.
- **The survivorship disclosure is the point of this phase.** Scrubbing past the median match
  duration empties the map, but because matches ended, not because players went quiet. Verified
  on Ambrose: 563 of 566 live at 01:00, 346 at 05:00, 95 at 10:56, 64 at 11:40. Without the
  count a designer would read "late-game traffic collapses" and be wrong.
- **Correction #10: buildPaths ignored the time window.** It filtered whole journeys (right for
  map/date/actor) but for time that drew a full twelve-minute route under a clock reading 01:00.
  Time must clip per point. Fixed; journeys now move 824 -> 902 -> 978 across the scrub instead
  of a flat 986.
- **Correction #11: playback ran at exactly half speed** because an effect synced the rAF clock
  ref from React state every render, overwriting half of each step with a stale value. A clock
  must own its own position; callers push in only on seek.
- Verified: 1x advances 4s in 4s, 8x advances 25s in 3s, Home/End/arrows/Space all work,
  scrub holds 28 fps median under an aggressive synthetic drag, zero console errors.
- **Next: Phase 7 - difference view (normalised to share, never raw counts) and side-by-side.**

### 2026-09-11 - PHASE 5 COMPLETE (filter rail)
- Filter rail (map, day, match, actor, events) + active-filter chips + empty state.
  One `filterRows` call per change; every layer, count and stat derives from that one result.
- Verified narrowing: all days 60,925 rows / 83% coverage -> +10 Feb 23,985 / 77% ->
  +bots only 6,126 / 56% -> +one match 932 rows, 15 journeys / 16%. Chips tracked exactly.
- Filter change with both heatmaps on: **160 ms median**. Keyboard: one tab stop per group,
  arrows cycle. 63 tests pass, tsc clean, zero console errors.
- **Bug found in verification:** filtering events to Loot only removed all position rows, and
  the strip then claimed "coverage 0% of playable land" - stating a measurement never taken.
  Now reports "coverage needs position events" instead.
- Match picker surfaces the 53 multi-participant matches first with journey counts, so a
  designer can tell a 15-journey match from a 1-journey one before clicking.
- Event counts deliberately exclude the event filter itself, so a zero means "none here", not
  "switched off". Matters given 12,866 loot events against 3 PvP kills.
- **Next: Phase 6 - timeline on match-elapsed time, plus playback.**

### 2026-09-10 - PHASE 4 COMPLETE (data layers)
- Eight composable layers with an always-visible legend: traffic, dwell, loot, kills (vs bots),
  deaths (split by cause), dead space, paths, positions. Debug scaffolding removed.
- **Traffic vs dwell is visually unmistakable**: traffic traces the road network, dwell sits
  as discrete blobs on buildings. Corridors versus destinations, from identical rows.
- **deck.gl HeatmapLayer replaced with a baked texture.** It re-aggregates on every viewport
  change and drags the whole layer stack with it: traffic + paths measured **2 fps**,
  traffic + loot 11 fps. Rasterising the heat field once to a canvas made per-frame cost
  constant. **1 fps to 57 fps** with all layers on.
- **Correction #9: never memoise a deck.gl Layer instance.** Doing so silently stopped the
  icon layers rendering, with no error, and briefly made perf numbers look good because
  nothing was drawing. Layers are single-use descriptors. Cache the image, not the layer.
- 63 tests pass, tsc clean, zero console errors with every layer on.
- Known limitation: all eight layers at once is unreadable. That is what Phase 5 filters fix.
- **Next: Phase 5 - filters (map, date, match, actor, event type).**

### 2026-09-10 — DEPLOYMENT LIVE AND VERIFIED
- **Live URL: https://lila-pjvt.msf1514.workers.dev** (Cloudflare Worker + Static Assets).
- Found the live site had been serving **Phase 0 code for three phases** — deployed by hand
  once, so GitHub pushes never redeployed. Caught by diffing the deployed JS hash against the
  local build, not by HTTP status: the URL returned 200 the whole time.
- First CI run failed in 0s (`assets.directory does not exist`): the dashboard had a deploy
  command but an **empty build command**, so it deployed a `dist/` that was never built.
  Fixed by declaring `build.command` in `wrangler.jsonc` — config in the repo, reviewable,
  and immune to dashboard drift.
- CI build `d57bb47` succeeded in 90s. Verified live: JS hash matches local, `bundle.bin`
  serves 2,136,384 B as `application/octet-stream`, unknown paths 404, canvas present,
  all three maps render, zero console errors.
- **New open gap: 7.0s time-to-interactive** vs a <3s target (deck.gl 284 KB gz + 2.1 MB
  bundle). Logged as TASKS 12.3 for Phase 10; needs lazy deck.gl loading.
- **Lesson recorded:** verify deployments by asset hash and rendered output, never by status code.

### 2026-09-10 — PHASE 3 COMPLETE (map canvas)
- `src/map/project.ts` (pure projection) + `src/ui/MapCanvas.tsx` (deck.gl OrthographicView,
  clamped zoom, keyboard controls) + map switcher as a real radiogroup.
- **60 tests pass** (20 pipeline + 25 runtime + 15 projection). `tsc` clean. Build clean.
- **Registration verified by looking, on all three maps.** Grand Rift is the decisive case:
  its POI names are printed on the art, and samples land exactly on Mine Pit, Engineer's
  Quarters, Labour Quarters, Burnt Zone and Gas Station. Lockdown has **zero points in the
  ocean**; Ambrose has none in the surrounding void.
- **Correction #8 added:** the earlier "60 FPS locked" spike figure was measured under
  SwiftShader, which renders nothing — it timed an empty loop. Real numbers now recorded.
  This also caused an hour of false debugging: the app looked broken when only the test
  harness was.
- **Next: Phase 4 — data layers (traffic, dwell, loot, kills, deaths, dead space, paths).**

### 2026-09-10 — PHASE 2 COMPLETE (data runtime + design foundation)
- `src/data/{types,loader,store,query,ingest}.ts` built. **45 tests pass** (20 pipeline + 25
  runtime). Typecheck clean. Browser render verified via Playwright: **zero console errors**,
  bundle decodes in **50 ms**.
- Store indices: 1,242 journeys · 94 bots / 245 humans · **53 multi-participant matches**
  (of 796) surfaced so the match picker never strands a designer on a single lonely dot.
- **Traffic vs dwell proven distinct by test** (their peak cells differ on identical rows).
- **Diff view normalises to share, enforced by test** — halving an identical distribution must
  read as ~zero change. Without it the real 98→47 daily-volume decline would fake a
  "traffic collapsed everywhere" result on every comparison.
- Design foundation locked: **D20–D23** (IBM Plex Sans/Mono w/ tabular figures · separate
  chrome vs Okabe-Ito data colour systems · 220ms motion ceiling · full-viewport density).
- **Next: Phase 3 — map canvas (deck.gl OrthographicView, all 3 maps registering).**

### 2026-09-10 — PHASE 1 COMPLETE (data pipeline)
- Built `transform.mjs` (shared by build + future browser ingest), `mapConfig.json` (data, not
  code), `build.mjs`, `minimaps.mjs`, and the 6 golden tests. **20 tests pass in 1.82s.**
- Pipeline verified: **89,016 rows** · 1,242/1,243 unique files · duplicate caught (SHA-256
  identical, 88 rows) · 339 users · 796 matches · **0 out-of-bounds** · ambiguous actors exactly
  `1379, 1402, 1429` · combat instants 3,098.
- Payload: `bundle.bin` 2.14 MB → **1.09 MB gz**; `meta.json` → 41 KB gz; minimaps 24 MB → **544 KB**.
- `npm run build` runs clean end-to-end from scratch (pipeline 1.2s + Vite 762ms).
- **Correction #7 added:** map-coverage % is grid-resolution dependent (83/65/55 at 64×64 vs
  87/84/65 at 32×32). Ranking is stable; absolute figures are not. See §3.
- **Next: Phase 2 — browser data runtime (loader, store, query).**

### 2026-09-10 — PHASE 0 COMPLETE (local)
- **Q4 resolved: repo is PUBLIC** (revised D18). Reviewer usernames unobtainable; a private link 404s
  for them. Privacy bought little anyway — the deployed site serves `bundle.bin` to the browser
  regardless of repo visibility.
- Scaffolded at `D:\Lila` (repo root): Vite 7.3.6 · React 19.3 · TypeScript 5.9.3 · deck.gl 9.4.0 ·
  hyparquet 1.30.0 · vitest 3.2.7 · sharp 0.34.5. **`hysnappy` verified absent.**
- Manual scaffold rather than `npm create vite` — avoids interactive prompts in a non-interactive
  shell and keeps exact control of config.
- Dirs: `src/{data,map,ui,state}`, `pipeline/`, `public/minimaps/`.
- `.gitignore` (node_modules, dist, generated bundle + minimaps, the assignment PDF, tsbuildinfo) and
  `.gitattributes` (LF normalisation, binary types incl. `*.nakama-0`).
- Verified: `tsc -b` clean · `vite build` succeeds (222 KB → 69.5 KB gz shell).
- `git init` + first commit `a62721f`, 1,259 files, .git = 29 MB.
- **BLOCKED ON USER:** 0.1 create the GitHub repo (no `gh` CLI installed) and 0.6 connect Cloudflare Pages.
- **Next: Phase 1 — `transform.mjs`, `build.mjs`, `minimaps.mjs`, 6 golden tests.**

### 2026-09-10 — Session 1 (cont. 2)
- Created **`TASKS.md`** — full execution checklist: 14 phases, ~90 tasks, sizes, cut order, risk
  register, and LILA's own 13-point submission checklist. Every data gotcha is inlined at the task
  that needs it so it can't be lost.
- **New task surfaced that wasn't in prior planning:** diff-view normalisation (7.4). Daily player
  volume falls 98→47, so raw-count diffs would always read "less everywhere." Diffs must normalise
  to *share of traffic*. Without this the comparison feature would be actively misleading.

### 2026-09-10 — Session 1 (cont.)
- **Tested whether the map changed across the 5 days: it did NOT** (§2). Extents stable on all 3 maps;
  apparent cell loss is a sample-size effect. No map-version field exists in the telemetry.
- Resolved all three open questions (§8): A/B **above the line**, retention **included as labeled 4th
  item**, repo **private on Cloudflare Pages**.
- Added decisions **D15–D19**: map-version awareness · **difference view as primary compare UI** ·
  all-days default · private repo + Cloudflare Pages (with the disclosure that it does NOT hide the
  data, since the site serves `bundle.bin` to the browser) · **no fixed hour budget**.
- Corrected the user's premise on map overlay (not possible with this data) while adopting the
  underlying requirement; corrected the assumption that a private repo protects the telemetry.
- **Next: Day 1 — pipeline, `transform.mjs`, 6 golden tests.**

### 2026-09-09 — Session 1
- Read the assignment PDF and `player_data/README.md`; profiled all 1,243 files in Python.
- Found and verified all four planted traps; **corrected 6 of my own claims** (see §3) — most
  importantly that map coverage is 87/84/65% of playable land, which demoted "negative space" from
  headline feature.
- Established the game is 1-human-per-match PvE (779/780) and the export is partial (689 orphan-combat matches).
- Ran 4 technical spikes: hyparquet parses all files exactly (2.0s, `hysnappy` must NOT be used);
  deck.gl registration pixel-perfect; payload 1.04 MB gz; 60 FPS locked on software rendering.
- Locked architecture (D1–D14) and the 5-day build plan.
- Created this file.
- **Next: Day 1 — pipeline, `transform.mjs`, 6 golden tests.**
