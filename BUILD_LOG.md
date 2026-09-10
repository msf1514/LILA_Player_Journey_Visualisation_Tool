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
