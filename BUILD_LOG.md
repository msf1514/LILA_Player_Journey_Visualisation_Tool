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
