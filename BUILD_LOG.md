# BUILD_LOG.md — Activity log

> **Third of three project docs. Keep the separation clean:**
>
> | Doc | Answers | Contains |
> |---|---|---|
> | `CONTEXT.md` | *What do we know, and why did we decide that?* | Verified data facts, corrections log, decisions D1–D19, architecture |
> | `TASKS.md` | *What still needs doing?* | 14-phase checklist, ~90 tasks, cut order, risk register |
> | **`BUILD_LOG.md`** | *What did we actually do, and how do we know it worked?* | Chronological work blocks with verification evidence |
>
> **Write an entry per work block, newest first.** A work block = one coherent push of effort,
> usually one phase or a chunk of one.

## Entry template

```markdown
## YYYY-MM-DD · Phase N — <title>
**Tasks:** <ids from TASKS.md>   **Commit:** `<sha>`   **Status:** DONE | PARTIAL | BLOCKED

### Did
- what changed, in plain terms

### Verified
- command or check → actual result (paste real numbers, not "it worked")

### Notes
- gotchas, surprises, anything a future session would waste time rediscovering

### Files
- created / modified
```

**Rules**
1. **Evidence, not assertion.** "89,016 rows, 0 failures, 2.0s" — never "the pipeline works."
2. **Log failures too.** A dead end recorded is a dead end nobody repeats.
3. **Every entry names its TASKS.md ids** so plan and history stay linked.
4. **Never edit an old entry.** Add a new one that corrects it.
5. Mirror the one-line summary into `CONTEXT.md` §10 changelog.

---

## 2026-09-10 · Phase 2 — Data runtime + design foundation
**Tasks:** 2.1 – 2.5, 10.0   **Commit:** _(this commit)_   **Status:** DONE

### Did
**Data runtime** (`src/data/`)
- `types.ts` — columnar types. Rows are held in typed arrays, not row objects: at 89,016 rows
  an object-per-row would be ~89k allocations and roughly 20x the memory.
- `loader.ts` — two parallel fetches, then nine typed-array **views onto one ArrayBuffer**.
  No copying; memory cost is the 2.1 MB payload itself. Throws a clear, actionable error when
  `bundle.bin` and `meta.json` disagree on row count.
- `store.ts` — builds indices in one pass: contiguous map ranges, per-match row lists,
  1,242 journey runs, matches-by-date. Exposes `multiParticipantMatches()` so the UI can
  surface the 53 matches worth replaying instead of the 743 with a single lonely dot.
- `query.ts` — `filterRows` (narrows by map range first, then scans) and `aggregate` with
  three genuinely different modes, plus `diffGrids` and `deadSpace`.
- `ingest.ts` — drop-zone parsing that imports the **same `pipeline/transform.mjs`** the build
  uses. Collects per-file failures rather than throwing, so one truncated file in a dropped
  folder of 300 does not lose the other 299.
- `runtime.test.ts` — 25 tests proving the browser layer agrees with the pipeline.

**Design foundation** (`src/design/tokens.css`) — see decisions D20–D23.

### Verified
| Check | Result |
|---|---|
| `npm test` | **45 tests passed** (20 pipeline + 25 runtime), 3.94s |
| `tsc -b` | exit 0, clean |
| `npm run build` | ✅ 2.17s · JS 229.70 kB → **71.84 kB gz** · CSS 12.81 kB → 2.42 kB gz |
| Browser render (Playwright, built output) | **zero console errors**, page interactive in 1,994 ms |
| Bundle decode in-browser | **50 ms** for 89,016 rows |
| Store indices | 1,242 journeys (one per unique file) · 94 bots / 245 humans · 53 multi-participant matches · largest has 16 journeys |
| Event counts after round-trip | identical to the pipeline, event for event |

### Notes
- **Traffic and dwell are provably different layers, not a stylistic choice.** A test asserts
  their *peak cells differ* on the same filtered rows. Traffic counts each actor once per cell
  ("how many came through"); dwell weights by the gap each sample represents ("how long they
  stayed"). A corridor and a camp spot are opposite design problems, and one blended density
  map hides both. Dwell weight is capped at 30s per sample so a 518s gap cannot dominate a map.
- **The diff view normalises to share of total, and a test enforces it.** Halving the sample of
  an identical distribution must read as ~zero change (asserted `< 0.05`). Without this, the
  real volume decline from 98 to 47 daily players would paint every comparison "less
  everywhere", and a designer would read that as their map being abandoned.
- `deadSpace` returns the grid `size` it used alongside the coverage figure, because coverage
  is resolution-dependent (correction #7). A test confirms Lockdown ranks least-covered, which
  is the durable finding; the bare percentage is not.
- Two authoring slips caught and fixed before commit: a placeholder hex (`#1d3away`) in the
  token file and a stray `building:` label in `ingest.ts`. Both would have failed loudly, but
  they are logged because they were mine, not the data's.

### Files
Created: `src/design/tokens.css` · `src/data/{types,loader,store,query,ingest}.ts` ·
`src/data/runtime.test.ts`
Modified: `src/App.tsx` (Phase 2 checkpoint screen, replaced in Phase 3) · `src/main.tsx`
Removed: `src/index.css` (superseded by the token file)
Added deps: `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`

---

## 2026-09-10 · Tooling — Skill installation (curated)
**Tasks:** n/a (tooling)   **Commit:** _none — installed outside the repo_   **Status:** DONE

### Did
Installed **11 of the 55** available skills to the **user-level** directory
`C:\Users\msf15\.claude\skills\` — deliberately *not* into the repo, so the deliverable stays
clean and contains only the tool.

| Skill | Why it earns a slot on this project |
|---|---|
| `webapp-testing` | Playwright toolkit — already the method used to verify deck.gl registration and measure the 60 FPS scrub |
| `web-design-guidelines` | UI/accessibility review. We have a hard colour-blind-safety requirement (D: markers differ by shape as well as colour) |
| `writing-guidelines` | Four docs to write, and **Communication is an explicitly scored criterion** |
| `pick-ui-library` | Covers charts, virtualisation, command menus — the filter rail and match picker need real choices |
| `vercel-react-best-practices` | React performance patterns; host-agnostic despite the name |
| `refero-design` | Self-describes as primary for **dashboards and product screens**, which is exactly this tool. Degrades gracefully without its MCP |
| `design-taste-frontend` | Anti-slop pass — avoids the generic AI look that would undercut the polish score |
| `frontend-reviewer` | Self-contained 90-line review checklist (verified: no dependencies on uninstalled skills) |
| `emil-design-eng` | UI polish bar — the "feels finished" standard the brief rewards |
| `prototype` | Renders several genuinely different UI variants behind a picker; useful for settling the main layout |
| `prompt-master` | From `prompt-master-main.zip`; activates only on explicit prompt-engineering requests |

### Verified
- All 11 have valid `name:` + `description:` frontmatter.
- 18 user-level skills total, 989 KB.
- `refero-design` checked for a hard MCP dependency — it explicitly falls back to bundled craft
  references when the MCP is unavailable, so it is safe to install.
- `frontend-reviewer` / `frontend-designer` are "house skills for WeWood" (another org).
  `frontend-reviewer` grep'd for references to other skills: none — self-contained, so installed.

### Notes — why NOT all 55
Skill descriptions load into context every session, so an unfiltered install costs tokens and,
worse, causes misfires. Three exclusion groups:

1. **Contradictory design directions** — `gpt-taste` (AIDA landing-page structure), `minimalist-ui`
   (editorial), `industrial-brutalist-ui`, `high-end-visual-design`, `apple-design`,
   `stitch-design-taste`, `impeccable`, `frontend-designer`. Installing several taste skills at
   once pulls the UI in conflicting directions. This tool should read as a **professional dark
   instrument** (Figma/Linear/Unity), not a marketing page — so one dashboard-oriented direction
   (`refero-design`) plus one anti-slop pass (`design-taste-frontend`) is the coherent choice.
2. **Wrong stack** — `deploy-to-vercel`, `vercel-cli-with-tokens`, `vercel-optimize` (we deploy to
   **Cloudflare Pages**); `shadcn-ui-design-validator`, `component-aesthetic-checker`,
   `ask-sonner` (we build custom UI over deck.gl, not shadcn); `animate-expo`,
   `vercel-react-native-skills`, `write-swift` (not mobile/native).
   `edge-performance-optimizer` targets Cloudflare **Workers**; Pages here is static — skipped.
3. **Unrelated domain** — `competitive-ads-extractor`, `lead-research-assistant`, `brandkit`,
   `brand-guidelines`, `canvas-design`, `imagegen-*`, `mcp-builder`, `composio-app-automations`,
   `content-research-writer`, `conversation-analyzer`, `workflow-pattern-analyzer`.

Animation skills (`animate`, `improve-animations`, `review-animations`,
`vercel-react-view-transitions`) were judged marginal: deck.gl drives the timeline scrub and
playback natively. Easy to add later if motion polish needs them.

All 11 registered immediately (no session restart needed). Nine are model-invocable; two —
`pick-ui-library` and `prototype` — carry `disable-model-invocation: true` in their own
frontmatter, so by their authors' design they are **user-invoked only** via `/pick-ui-library`
and `/prototype`. Installed and working, just not auto-triggered.

### Files
Installed to `C:\Users\msf15\.claude\skills\` (outside the repo — nothing committed).
Source: `D:\Lila\skills\` (55 available) and `D:\Lila\prompt-master-main.zip`.

---

## 2026-09-10 · Phase 1 — Data pipeline + golden tests
**Tasks:** 1.1 – 1.6, T1 – T6   **Commit:** _(this commit)_   **Status:** DONE

### Did
- **`pipeline/transform.mjs`** — the single source of truth for interpreting the telemetry,
  imported by both the Node build and (later) the browser drop-zone, so the two paths can never
  drift. Holds all four traps, the event taxonomy with marker/tone metadata, `splitOnGaps`
  (path integrity, D12) and `countCombatInstants` (instant-not-row counting).
- **`pipeline/mapConfig.json`** — scale/origin as *data*, not code (D9), with real source image
  dimensions and a `version` field for map-geometry versioning (D15).
- **`pipeline/build.mjs`** — 1,243 parquet files → one columnar binary bundle. Dedupes by
  filename, computes match-relative elapsed time, emits per-match metadata and dataset stats.
- **`pipeline/minimaps.mjs`** — downscales art and derives the playable-land mask.
- **`pipeline/transform.test.mjs`** — the six golden tests, written against the real dataset
  rather than fixtures (a fixture would still pass if the real files changed shape).

### Verified
| Check | Result |
|---|---|
| `npm test` | **20 tests passed** across the 6 golden groups, 1.82s |
| Pipeline rows | **89,016** (89,104 − 88 duplicate) |
| Unique files | **1,242** of 1,243 on disk |
| Duplicate detected | `cfa03e9f-…_ac049b28-….nakama-0`, also in February_11, 88 rows, SHA-256 identical |
| Users / matches | **339 / 796** |
| Out-of-bounds | **0** |
| Ambiguous actors | **1379, 1402, 1429** — exactly the three expected |
| Date range | 2026-02-09 → 2026-02-14 |
| Event counts | Position 51,284 · BotPosition 21,712 · Loot 12,866 · BotKill 2,410 · BotKilled 699 · KilledByStorm 39 · Kill 3 · Killed 3 |
| Combat instants | 3,098 |
| `bundle.bin` | 2.14 MB → **1.09 MB gzipped** |
| `meta.json` | 209 KB → **41 KB gzipped** |
| Minimaps | 24 MB → **544 KB** total (183 / 168 / 200 KB WebP) |
| Full `npm run build` | clean from scratch, 1.2s pipeline + 762ms Vite |

Event deltas from the removed duplicate sum to exactly 88 (Position −63, Loot −19, BotKill −5,
BotKilled −1), confirming the dedupe removed that file and nothing else.

### Notes
- **New finding — coverage % is grid-resolution dependent.** Measured against the shipped 256²
  mask at a 64×64 analysis grid: Ambrose **83%**, GrandRift **65%**, Lockdown **55%**. Earlier
  Python figures (87 / 84 / 65%) used a 32×32 grid and a separately-derived mask. Finer grids
  always read lower. The *ranking is stable* — Lockdown is consistently worst — which is the
  actual insight, but **INSIGHTS.md must state the grid resolution rather than quote a bare
  percentage**, and the dead-space layer must use one fixed resolution consistently.
- GrandRift shows 61 visited cells just outside the mask at 64×64 (vs 1 at 32×32). This is a
  boundary artifact — small cells straddling the coastline fail the 25% playable test while
  still containing points — not a registration error. Registration itself remains 0 OOB.
- Binary layout is 24 bytes/row, ordered widest-first (f32 x/z/y + u32 tSec, then u16
  user/match/elapsed, then u8 map/event) so every typed array lands on its natural alignment.
  `t` is stored as epoch **seconds** in a Uint32 — epoch ms overflows u32 and the source
  resolution is one second anyway, so nothing is lost.
- `masks.json` is generated and gitignored; `build:data` warns rather than fails without it, so
  the data pipeline can run standalone during development.

### Files
Created: `pipeline/transform.mjs` · `pipeline/mapConfig.json` · `pipeline/build.mjs` ·
`pipeline/minimaps.mjs` · `pipeline/transform.test.mjs`
Generated (gitignored): `public/bundle.bin` · `public/meta.json` · `public/minimaps/*.webp` ·
`pipeline/masks.json`

---

## 2026-09-10 · Phase 0 — Project scaffold
**Tasks:** 0.1 – 0.6   **Commit:** `a62721f`   **Status:** DONE

### Did
- Scaffolded the project **manually** rather than with `npm create vite@latest` — the template
  scaffolder prompts interactively, which a non-interactive shell can't answer, and hand-writing
  the config avoided pruning template cruft afterwards.
- Created `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, minimal `src/App.tsx`
  shell, and the dark-theme CSS token set (`--human` cyan / `--bot` amber / `--danger` / `--storm`
  / `--loot`) that the layer colour system in Phase 4 will consume.
- Directory skeleton: `src/{data,map,ui,state}`, `pipeline/`, `public/minimaps/`.
- `.gitignore`: `node_modules`, `dist`, generated `public/bundle.bin` + `public/meta.json` +
  `public/minimaps/`, `tsconfig.tsbuildinfo`, and `*.pdf` (the assignment brief is not a deliverable).
- `.gitattributes`: LF normalisation plus **binary markers for `*.nakama-0`** — without this Git
  would corrupt the parquet files on a Windows checkout via CRLF translation.
- npm scripts with a `prebuild` chain so `npm run build` regenerates minimaps and the data bundle
  before Vite runs. This is what makes the Cloudflare build reproducible from a clean clone.
- `git init` + first commit; remote set to the public GitHub repo.

### Verified
| Check | Result |
|---|---|
| Installed versions | react 19.3.0 · react-dom 19.3.0 · deck.gl 9.4.0 · hyparquet 1.30.0 · vite 7.3.6 · typescript 5.9.3 · vitest 3.2.7 · sharp 0.34.5 |
| **`hysnappy` absent** | ✅ confirmed missing — it breaks Snappy decompression on these files |
| `npx tsc -b --noCheck` | exit 0, clean |
| `npx vite build` | ✅ built in 1.16s · 222.88 KB → **69.51 KB gzipped** shell |
| `git log` | `a62721f`, **1,259 files** staged, `.git` = 29 MB |
| `player_data/` size | 34 MB (8.4 MB parquet + 24 MB minimaps) — well under GitHub limits |

### Notes
- **Repo decision reversed to PUBLIC** (revised D18). Reviewer GitHub usernames were unobtainable,
  and a private repo link 404s for them — which reads as a broken submission. Privacy also bought
  less than it appears: the deployed site serves `bundle.bin` to the browser, so the telemetry is
  downloadable by anyone with the site URL regardless of repo visibility. README must disclose that
  the data is LILA-supplied and UUID-anonymised, and offer to strip it on request.
- `gh` CLI is **not installed** on this machine. Repo creation was done by the user in the browser.
  Git 2.53.0 is available, configured as `msf1514 / msf1514@gmail.com`.
- Package name set to `lila-player-journey-visualisation-tool` to match the repo.
- `tsconfig.tsbuildinfo` was accidentally staged on the first `git add`; removed from the index and
  added to `.gitignore` before committing.

### Files
Created: `package.json` · `tsconfig.json` · `vite.config.ts` · `index.html` · `.gitignore` ·
`.gitattributes` · `src/main.tsx` · `src/App.tsx` · `src/index.css` · `BUILD_LOG.md`
Directories: `src/data` · `src/map` · `src/ui` · `src/state` · `pipeline` · `public/minimaps`

### Blocked / handed to user
- **0.1** GitHub repo — ✅ created: https://github.com/msf1514/LILA_Player_Journey_Visualisation_Tool
- **0.6** Cloudflare Pages — ✅ linked by user. Build command `npm run build`, output `dist`.
