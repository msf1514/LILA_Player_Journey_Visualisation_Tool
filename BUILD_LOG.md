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

## 2026-09-12 - Enhancements 1-4 (post-stage)
**Status:** DONE (uncommitted at time of writing)   **Tests:** 106 pass · 0 console errors · no new tsc errors

### 1. Side-by-side jitter
- Cause: `MapCanvas.onViewStateChange` propagated every emit to the shared view, including deck.gl
  clamp/echo emits; two linked maps with different zoom limits oscillated.
- Fix: propagate only user-driven changes (`interactionState.isDragging/isPanning/isZooming/isRotating`).
- Verified: mid-drag held + post-drag idle byte-stable (compare-by-map Ambrose/Grand Rift); linked
  pan still syncs; single-mode pan and diff unchanged. Files: `src/ui/MapCanvas.tsx`.

### 2. Level-of-detail marker clustering
- `MapCanvas` reports a half-step zoom bucket (`onZoom`); `clusterEvents` (layers.ts) bins per
  event type; `eventClusterLayer` (deckLayers.ts) draws size-scaled clusters below zoom 1,
  individuals above. Count on hover. Cell = 56px x 2^(-bucket); memo keyed on bucket, not pan.
- Course-correction: dropped per-cell count labels (noisier than the blob) for size + hover.
- Verified by looking: `c2_zoomedout.png` (legible clusters) vs `c2_zoomedin.png` (individuals);
  hover "42 x Loot pickup". Heat/hotspots/paths/diff/side untouched. `src/map/cluster.test.ts` (4).
- Files: `src/map/layers.ts` `src/map/deckLayers.ts` `src/ui/MapCanvas.tsx` `src/ui/MapStage.tsx`
  `src/App.tsx` (zoomBucket + cluster tooltip).

### 3. Deterministic insight layer
- `src/ui/insightsData.ts::computeInsights` reads 5 findings from the bundle; `src/ui/Insights.tsx`
  renders a new Insights tab; clicking applies the demonstrating ViewState via existing setters so
  the URL reflects it. `src/ui/insightsData.test.ts` (5).
- Verified: figures match recomputed store values; clicking volume-collapse lands on the day diff
  (`c3_volume.png`), unconcentration switches to Hotspots; URLs: `?l=traffic`,
  `?l=traffic&tm=window&t=655`, `?d=2026-02-10&c=diff&cd=day&cv=2026-02-09`.
- Naming: logic is `insightsData.ts` (Windows case clash with `Insights.tsx`).
- Files: those two + `src/App.tsx` (Insights tab + applyInsightView) + `controls.css`.

### 4. First-run guided walkthrough
- `src/ui/Walkthrough.tsx`: spotlight (box-shadow cutout) + tooltip over 8 anchors in order,
  Back/Next/Skip, arrow keys + Escape, focus managed, skips off-screen anchors. Replaces the old
  `OrientationHint` (removed from DataNotes.tsx). Shows once (localStorage `lila.tour.done.v1`,
  guarded), re-openable via header "Tour" button.
- Verified: all 8 spotlights geometrically aligned to targets; titles in order; dismiss persists
  across reload; Tour re-opens; no card overflow at 400px (`c4_step1/5.png`, `c4_mobile.png`).
- Files: `src/ui/Walkthrough.tsx` `src/App.tsx` (steps, tour state, Tour button, data-tour anchors)
  `src/ui/DataNotes.tsx` (removed OrientationHint) `controls.css`.

### Notes
- Scope held: only src/ui, src/map, src/App.tsx, src/ui/controls.css changed; pipeline/ and
  src/data/ untouched. Scripts/shots in `scratchpad/spike/` (c1test, c2test, c3test, c4test, jit*).

---

## 2026-09-12 - Stage 5 - Design pass (final stage)
**Tasks:** 10.2, 10.4   **Commit:** _(pending)_   **Status:** DONE

### Did
- Reviewed all major states together at 1440x900 (screenshots `spike/s5_*.png`).
- `src/App.tsx`: side-by-side splits only when a comparison exists; otherwise a single full-width
  map plus a prompt. Removed the empty right-half void.
- `src/ui/DataManager.tsx` + `controls.css`: styled the Add-a-map minimap file input to match the
  drop-zone affordance, with a filename readout.

### Verified (Playwright, real GL, 1440x900)
| State | Result |
|---|---|
| default / hotspots / filtered | coherent; map is the loudest element |
| difference | header legend + "choose to compare" note, side A shown as context |
| side-by-side, no choice | **fixed**: full-width map + prompt, no empty half |
| side-by-side, comparing | clean 1fr/1fr split, linked panning (566 vs 1 matches) |
| data notes / data manager | consistent modal styling |
| `npx vitest run` | **97 passed** |
| tsc | no new errors | 
| console errors | none in any state |

### Notes
- The pass was deliberately small: the UI already cohered from phases 2-9, so beyond the two
  genuine defects there was nothing to fix without inventing churn. No new colours, sizes or
  durations were introduced.

### Files
Modified: `src/App.tsx` · `src/ui/DataManager.tsx` · `src/ui/controls.css`

---

## 2026-09-12 - Stage 4 - Extensibility (drop zone, IndexedDB, map config)
**Tasks:** 11.1, 11.2 (11.3 partial)   **Commit:** _(pending)_   **Status:** DONE

### Did
- `src/data/merge.ts` (+ `merge.test.ts`, 5 tests): re-encode base + dropped rows into one
  bundle, deduped by match id, matchMeta/stats/elapsed mirrored from build.mjs.
- `src/data/persist.ts`: IndexedDB persistence for added rows + maps, fully guarded.
- `src/ui/DataManager.tsx`: header "Manage data" → drop zone + per-file report + add-a-map form
  + remove. hyparquet dynamically imported (own lazy chunk).
- `src/map/project.ts`: `registerMinimap` so runtime maps resolve their uploaded image.
- `src/App.tsx`: base+added → merged store via useMemo; onIngest/onAddMap/onClear; stale-map
  self-heal + guarded reads. `LayerPanel` shares the left stack. CSS in `controls.css`.

### Verified (Playwright, real GL, live DOM)
| Check | Result |
|---|---|
| Drop reports match pipeline | Feb_10: 437 files read, 33,687 rows, 0 dup, 0 unknown (pipeline ref identical) |
| Per-file failure reported | broken.nakama-0 → "parquet file invalid (footer != PAR1)" |
| 4th map added via UI renders | "New Map" in switcher, minimap renders, 0 rows (no data files exist) |
| Survives reload | added map present after reload (IndexedDB) |
| Removable | "Remove all added data" → map gone |
| Console errors | none |
| `npx vitest run` | **97 passed** |
| Initial JS chunk | 94.5 KB gz (deck.gl + hyparquet both lazy) |

### Notes
- **Merge, not two stores.** Re-encoding to the pipeline's exact columnar shape keeps one query
  path; the Store's sort/contiguity invariants are preserved (tested).
- **Bug caught by looking, not by compiling:** a `key={dataVersion}` remount closed the data
  panel the instant an import finished, so the report never showed and the harness timed out with
  no error. Removed the remount; the store already recomputes from the `added` dependency.
- **Second bug:** removing the map you are viewing crashed on `mapConfig[removedMap].label`.
  Fixed with a guarded `mapId`, a defensive EmptyState read, and a self-heal effect.
- **Honest dataset limits:** all provided telemetry is already in the base bundle, so real drops
  are duplicates (skipped) — parser parity shown via the report + shared transform + pipeline
  tests; and there are no 4th-map files, so data-on-new-map is unit-tested in `merge.test.ts`.
- Scope: new files under src/data (merge, persist) added; existing ingest/loader/store/query/
  types were NOT modified — ingest's parsing is untouched, as required.
- Scripts/shots: `scratchpad/spike/s4.mjs`, `hotprobe*` (n/a), `s4_report.png`, `s4_newmap.png`.

### Files
Created: `src/data/merge.ts` · `src/data/merge.test.ts` · `src/data/persist.ts` · `src/ui/DataManager.tsx`
Modified: `src/App.tsx` · `src/map/project.ts` · `src/ui/LayerPanel.tsx` · `src/ui/controls.css`

---

## 2026-09-12 - Stage 3 - Hotspots and drill-down
**Tasks:** 8.1 - 8.5 (8.6 cut)   **Commit:** _(pending)_   **Status:** DONE

### Did
- `src/map/hotspots.ts` (pure) + `src/map/hotspots.test.ts` (5 tests): threshold traffic grid at
  the 90th percentile of non-empty cells, 4-connected components, rank clusters by summed share,
  min 2 cells, cap 8.
- `src/ui/Hotspots.tsx`: three-depth panel (cluster list → journeys → run detail).
- `src/map/deckLayers.ts`: `hotspotCellsLayer` (pickable, onClick), `hotspotLabelLayer`
  (TextLayer), `runPathLayer`. `src/ui/MapStage.tsx`: overlay wired, built fresh each render.
- `src/App.tsx`: trafficGrid + computeHotspots memos, cluster/run selection, journeys and
  runDetail derivation, Layers/Hotspots tabs, tooltip extended for cells. `src/ui/LayerPanel.tsx`:
  de-absolute-positioned to share the left stack. CSS in `controls.css`.

### Verified (Playwright, real GL, live DOM read)
| Check | Result |
|---|---|
| Clusters listed | 8, each > 1 cell; every row shows share |
| Cluster count + top share | Ambrose 18 / 4.1% · Lockdown 16 / 3.8% · Grand Rift 10 / 7.1% |
| No dominant cluster | topShare < 0.10 on all maps (asserted in test) |
| Two clicks to one run | cluster 1 (4.1%/21c/202 journeys) → run b6d86df4, 12:05, 116 samples, 20 loot, 2 kills, 1 death |
| Hover a cell | "Cluster 5 · 41 players through this cell" |
| Footprint & path by looking | `s3_cluster.png` footprint under label 1; `s3_run.png` path passes through it |
| `npx vitest run` | **92 passed** |
| Console errors | none |

### Notes
- **Threshold choice is the whole game.** The 80th percentile the brief cites reproduces the
  cluster COUNTS (44/74/33 ≈ 43/78/36) but produces a single 13% / 85-cell blob as the top
  cluster — the "merged everything" failure. The 90th percentile keeps the same unconcentrated
  story while breaking that blob into nameable areas; the top cluster is then only 3.8-7.1%.
- Distance per run was left off the detail card: the 518s max sampling gap makes path length
  unreliable, and a confident wrong number is worse than an omitted one.
- Probes/shots: `scratchpad/spike/hotprobe*.mjs`, `s3.mjs`, `s3b.mjs`, `s3_*.png`.

### Files
Created: `src/map/hotspots.ts` · `src/map/hotspots.test.ts` · `src/ui/Hotspots.tsx`
Modified: `src/App.tsx` · `src/ui/MapStage.tsx` · `src/map/deckLayers.ts` · `src/ui/LayerPanel.tsx` · `src/ui/controls.css`

---

## 2026-09-12 - Stage 2 - Data honesty (disclosure surface + hint)
**Tasks:** 10.1, 10.3   **Commit:** _(pending)_   **Status:** DONE

### Did
- `src/ui/DataNotes.tsx`: header "Data notes" button + modal panel; `OrientationHint` first-run
  nudge. All figures computed from `store.meta.stats` and `store.meta.matchMeta` at render.
- `src/App.tsx`: mounted `<DataNotes>` in the header (pushed right), `<OrientationHint>` in the
  canvas. `src/ui/controls.css`: `.data-notes-*`, `.dn-*`, `.orient-*` (tokens only).

### Verified (Playwright, real GL, 1440x900, figures read back from the live DOM)
| Check | Result |
|---|---|
| Figures shown = bundle | vs bots 2,410 · to bots 699 · storm 39 · **PvP 3** · matches 796 · solo-human 779/780 · multi-journey 53/796 · loot 12,866 · dup 1/1,243 (88 rows) · ambiguous 3 (1379,1402,1429) · OOB 0 |
| PvP caveat in words | lead states it plainly, before any number |
| Reads as caveat not boast | confirmed by looking (`spike/s2_panel.png`) |
| Dialog a11y | Escape closes; focus returns to trigger; Tab trapped |
| Hint appears once | visible first load; "Got it" → gone; still gone after reload |
| `npx vitest run` | **87 passed** |
| Console errors | none |

### Notes
- **PvP = `eventCounts.Kill` = 3**, NOT `sum(matchMeta.pvp)` = 6. The `pvp` per-match field
  counts Kill AND Killed (this player as killer or victim in a player encounter), so it
  double-counts. The honest "player-versus-player kills" figure is the Kill event count.
- localStorage is wrapped in try/catch on every read and write; if blocked, the hint simply
  does not show rather than nagging each load.
- Scripts/shots: `scratchpad/spike/s2.mjs`, `s2_panel.png`, `s2_firstload.png`.

### Files
Created: `src/ui/DataNotes.tsx`
Modified: `src/App.tsx` · `src/ui/controls.css`

---

## 2026-09-12 - Stage 1 - Load time (code split + skeleton)
**Tasks:** 12.3   **Commit:** _(pending)_   **Status:** DONE

### Did
- Split `src/map/layers.ts` (pure data prep, no deck.gl) from new `src/map/deckLayers.ts`
  (the only deck.gl import). `heatLayer`/`deadSpaceLayer`/`eventLayer`/`pathLayer`/`actorLayer`/
  `diffLayer` moved out; pure `heatPoints`/`trafficImage`/`collectEvents`/`buildPaths`/`diffImage`
  stayed, so App can filter, aggregate and bake textures with no deck.gl in the load path.
- New `src/ui/MapStage.tsx`: builds the layer arrays (fresh Layer instances each render, inputs
  memoised) and renders MapCanvas(es). App loads it via `React.lazy` behind `<Suspense>` and
  warms `import('./ui/MapStage')` at module scope, next to `loadBundle()`, so renderer + data
  download in parallel.
- `AppSkeleton` + `MapAreaSkeleton` reuse the real `.app` grid; CSS `.sk*` in `controls.css`,
  shimmer gated on `prefers-reduced-motion`.

### Verified
| Check | Result |
|---|---|
| `npx vite build` initial JS | **1,128 KB → 271 KB** (gzip 326 → 86 KB) |
| deck.gl chunk | lazy `MapStage` 858 KB (240 KB gz) |
| FMP, Fast-3G throttle | **2,052 ms blank → 860 ms full skeleton** |
| Time-to-map, warm localhost | **~1.1-2.2 s (< 3 s target)** |
| Time-to-map, Fast-3G | ~13.3 → 13.7 s (unchanged; same total bytes) |
| Map draws under real GL | yes (`spike/load_after_throttle_ready.png`) |
| `npx vitest run` | **87 passed** |
| Console errors | none in every Playwright run |

### Notes
- Measured with Playwright chromium (real GL, no `--use-gl=swiftshader`) against `vite preview`
  at 1440x900; before/after compared on the same harness by stashing the changes and rebuilding
  HEAD. Scripts and shots in `scratchpad/spike/` (`measure.mjs`, `load_*`).
- The split trades nothing for a much earlier first paint: total transfer is unchanged, so a
  bandwidth-bound viewer still waits the same time for the MAP, but sees the tool's shape in
  under a second instead of a blank screen. Cutting time-to-map means shrinking `bundle.bin`
  (under `pipeline/`, out of scope for these stages).
- `tsc -b` still reports the 5 pre-existing errors (import.meta.env in loader/project, unused
  ts-expect-error in ingest, unused `mapIdx` in query, a MapCanvas controller type); none are
  new and the build runs `tsc -b --noCheck`.

### Files
Created: `src/map/deckLayers.ts` · `src/ui/MapStage.tsx`
Modified: `src/App.tsx` · `src/map/layers.ts` · `src/ui/controls.css`

---

## 2026-09-11 - Phase 9 - URL state and copy link
**Tasks:** 9.1 - 9.3   **Commit:** _(this commit)_   **Status:** DONE

### Did
- `src/state/url.ts` - pure encode/decode. Encodes only what differs from the default, so an
  unfiltered view produces a bare URL. `decodeState` validates every value against the
  CURRENT data and returns a `dropped` list rather than throwing.
- `src/state/url.test.ts` - 17 tests, round-trip plus stale-link degradation.
- `src/ui/useUrlState.ts` - history sync. Derives push-versus-replace by comparing encoded
  params, so no component has to remember to flag itself as continuous.
- `src/ui/CopyLink.tsx` - copy control with a manual fallback when the clipboard is refused.
- `src/App.tsx` - all state seeded from the address bar on first render; popstate restores.

### Verified
| Check | Result |
|---|---|
| `npm test` | **86 passed** (69 + 17 new) |
| `npx tsc -b` | exit 0 |
| Default view URL | **empty query string** |
| 4 discrete changes | history 2 -> 7, one entry each |
| **Full timeline drag, 29 changes** | **0 history entries added** |
| Back button | steps back through discrete changes in order |
| Fresh browser from copied link | stat strip identical: `Lockdown rows 1,206 loot 0 kills vs bots 12 deaths 20 journeys 21 coverage 22%` |
| Chips after restore | `Up to 13:20 / 11 Feb / Bots only / 6 of 8 event types` |
| Playback after opening a link | paused |
| Layer round trip | `?l=dwell,paths,traffic` restored Traffic, Dwell, Paths |
| Stale link | `?m=Lockdown&a=human&x=not-a-real-match&e=Loot,Extracted` restored Lockdown and reported both drops |
| Console errors | none |

### Notes
- **Match ids are written out in full, deliberately.** A dictionary index would cost two
  characters instead of 45, but dictionary order comes from the build. Rebuild the bundle with
  a day of fresh telemetry and index 214 is a different match: every link already pasted into
  a document would point somewhere else, with no error, still looking valid. Stable
  identifiers cost length; indices cost correctness.
- **Push versus replace is derived, not declared.** `onlyTimeChanged` compares the encoded
  parameters of the previous and next state. A component added later cannot forget to mark
  itself continuous, because nothing asks it to.
- **Playback is never encoded.** A shared view that starts playing takes control away from
  whoever opened it. Position travels; motion does not.
- Test-harness flaw worth recording: `.layer-row` is used by BOTH the layer panel and the
  rail's event list, so the first pass clicked event checkboxes while believing it was
  toggling layers. The URL was correct throughout; the test was reading the wrong control.
  Re-verified with `aside[aria-label="Layers"] .layer-row`.
- A patch hunk silently failed to match (the state block had been reordered in Phase 6) while
  a dependent hunk applied, leaving a reference to an undeclared `initial` and blanking the
  app. Fourth crash of this shape on this project. Verify every hunk applied, not just that
  the script exited zero.

### Files
Created: `src/state/url.ts` - `src/state/url.test.ts` - `src/ui/useUrlState.ts` -
`src/ui/CopyLink.tsx`
Modified: `src/App.tsx` - `src/ui/controls.css`

---

## 2026-09-11 - Phase 7 - Comparison
**Tasks:** 7.1 - 7.4   **Commit:** _(this commit)_   **Status:** DONE

### Did
- `src/map/layers.ts` - `diffImage` bakes a signed grid into a diverging texture, symmetric
  about zero, transparent where nothing changed, with a support threshold. `diffLayer` draws it.
- `src/ui/CompareBar.tsx` - mode control (single / difference / side by side), a B side
  defined as "A with one dimension swapped" (day, map, actor or match), both sides' match
  counts, and a thin-sample warning.
- `src/ui/MapCanvas.tsx` - optional controlled view state, so two canvases pan together.
- `src/App.tsx` - comparison state, diff computation, split canvas layout.

### Verified
| Check | Result |
|---|---|
| `npm test` | **69 passed** (63 + 6 new diff invariants) |
| `npx tsc -b` | exit 0 |
| Console errors | none across mode switches and both sides changing |
| Match counts shown | "201 vs 78 matches", "201 vs 24 matches" |
| Thin-sample warning | fires at 24 matches: "one side has under 30 matches, so treat small differences as noise" |
| Side by side | two canvases, panning one moves both |

Measured diff magnitudes (Ambrose Valley, traffic, 64x64 grid):

| Comparison | max share delta | traffic totals |
|---|---|---|
| **Same day against itself** | **0.00000** | 10,879 / 10,879 |
| Feb 10 vs Feb 11 | 0.00158 | 10,879 / 6,157 |
| Feb 10 vs Feb 13 | 0.00202 | 10,879 / 3,464 |
| **Feb 10 vs Feb 14** (201 vs 24 matches) | **0.00488** | 10,879 / 1,439 |
| Humans vs bots | 0.00329 | 18,413 / 7,374 |

**Looked at it:** Feb 10 against Feb 13 shows red and blue both present in plausible places -
blue through the centre and main routes, red at the edges and the north-west compound. Not one
flat colour, which is what a volume-reading diff would produce.

### Notes
- **The zero is the proof.** A day compared against itself gives a max delta of exactly
  0.00000. If the diff were secretly reading raw counts that would still be zero, so it is
  paired with the Feb 10 vs Feb 14 case: traffic totals differ by 7.5x while the share delta
  stays at 0.0049.
- **The small-sample trap is now measured, not assumed.** Feb 14 has the LARGEST delta against
  Feb 10 of any day (0.0049 against 0.0016 for Feb 11), purely because 24 matches is a thin
  sample where one player's route is a large share. A test asserts this ordering, so the
  reason the support threshold and the match-count display exist is encoded rather than
  described.
- **Test thresholds came from measurement after one failed on a guess.** An early assertion
  used `> 0.005` for the human-vs-bot shift; the real value is 0.0033. Share deltas spread
  across ~1,600 cells are small in absolute terms even when the shift is real, so the
  magnitudes were measured in a standalone script and the thresholds set from them.
- **Difference mode draws the delta and nothing else.** Caught by looking at a screenshot:
  side A's green loot markers were sitting on top of an A-versus-B delta, and a designer would
  reasonably read them as part of the comparison. Every other layer is built from one side
  alone, so none of them belong in a diff.
- Third temporal-dead-zone crash of the project: the comparison block was inserted below the
  `layers` memo that consumes it, blanking the app with only "Cannot access 'Xt' before
  initialization". Moved above. Worth a standing habit: in a long component, declare derived
  state above every memo that reads it.

### Files
Created: `src/ui/CompareBar.tsx`
Modified: `src/map/layers.ts` - `src/ui/MapCanvas.tsx` - `src/App.tsx` -
`src/ui/controls.css` - `src/data/runtime.test.ts`

---

## 2026-09-11 - Phase 6 - Timeline and playback
**Tasks:** 6.1 - 6.5   **Commit:** _(this commit)_   **Status:** DONE

### Did
- `src/ui/Timeline.tsx` - scrubber on match-elapsed time with play/pause, 1x/2x/4x/8x,
  mm:ss clock, cumulative vs last-30s mode, a survivor density band along the track, a
  storm marker at 10:55 and a live "N of M matches still running" readout.
- `src/ui/usePlayback.ts` - rAF clock integrating real elapsed time, plus `useThrottled`
  so the expensive recomputation follows the scrubber instead of blocking it.
- `src/App.tsx` - the time window writes into the existing Filter, so every layer, count
  and stat responds through the one path built in Phase 5.

### Verified
| Check | Result |
|---|---|
| `npm test` | 63 passed |
| `npx tsc -b` | exit 0 |
| Console errors | none |
| Playback rate | 1x advanced 00:00 to 00:04 in 4s; 8x then advanced 25s in 3s |
| Keyboard | Home 00:00, End 14:50, ArrowLeft steps, Space toggles play |
| Scrub responsiveness | median 35.4 ms (28 fps), p90 110 ms, under an aggressive synthetic drag |

Survivor counts fall exactly as the durations predict (Ambrose Valley, 566 matches):

| T | live matches | rows | journeys | coverage |
|---|---|---|---|---|
| full range | all 566 | 60,925 | 986 | 83% |
| 01:00 | 563 | 9,287 | 824 | 43% |
| 05:00 | 346 | 41,977 | 902 | 80% |
| 10:56 | 95 | 59,353 | 978 | 82% |
| 11:40 | 64 | 60,105 | 981 | 82% |

Cumulative vs last-30s at the same 05:00: 41,977 rows against 2,829, coverage 80% against
38%. Visibly different maps - the whole map lit versus a handful of live clusters.

### Notes
- **Three bugs found by verification, none of which the compiler could catch.**
  1. **Paths ignored the time window.** `buildPaths` filtered whole journeys, correct for map
     or date, but for time it drew a player's complete twelve-minute route while the clock
     read 01:00. The map was flatly contradicting the timeline. Now clips per point.
     This meant editing `src/map/layers.ts`, which the phase brief had scoped out; shipping a
     route nobody had walked yet was the worse option. Minimal additive change.
  2. **Playback ran at exactly half speed.** An effect synced the clock ref from React state
     on every render, so each frame advanced the ref, called setState, then had the older
     uncommitted value written back over it. The clock now owns its value and callers push
     into it only when seeking.
  3. **The survivor note fired at the default view**, reading "the rest have ended, so the map
     thins" when nothing was narrowed at all. Now reads "Showing all 566 matches, full duration".
- Two self-inflicted crashes during the fix, both worth remembering: returning a fresh object
  literal from `usePlayback` made it unusable as an effect dependency and looped forever, and
  placing the seek effect above the `const clock = ...` declaration blanked the entire app with
  only "Cannot access 'ne' before initialization" in the console.
- 28 fps during a synthetic drag is the honest number, not 60. The scrubber itself stays
  immediate; the throttle is what the map follows.

### Files
Created: `src/ui/Timeline.tsx` - `src/ui/usePlayback.ts`
Modified: `src/App.tsx` - `src/ui/FilterChips.tsx` - `src/ui/controls.css` - `src/map/layers.ts`

---

## 2026-09-11 - Phase 5 - Filter rail
**Tasks:** 5.1 - 5.6   **Commit:** _(this commit)_   **Status:** DONE

### Did
- `src/ui/FilterRail.tsx` - map, day, match, actor and event filters in a left rail.
- `src/ui/FilterChips.tsx` - one clearable chip per active filter, plus clear-all. Renders
  nothing when nothing is filtered.
- `src/App.tsx` - a single `Filter` object in state, ONE `filterRows` call, every layer,
  count and stat derived from that one result. Map selector moved out of the header.
- App shell is now a CSS grid: header, rail, canvas, stats strip.

### Verified
| Check | Result |
|---|---|
| `npm test` | 63 passed |
| `npx tsc -b` | exit 0 |
| Console errors | none across every filter combination exercised |
| Filter change, both heatmaps on | **160 ms median** over five day switches |
| Keyboard | first Tab lands on the map group, arrows cycle Ambrose to Grand Rift to Lockdown, exactly one tab stop |

Filters narrow monotonically and compose correctly:

| Filter | rows | loot | kills | journeys | coverage |
|---|---|---|---|---|---|
| Default (all days) | 60,925 | 9,936 | 1,794 | 986 | 83% |
| + 10 Feb | 23,985 | 3,669 | 738 | 376 | 77% |
| + bots only | 6,126 | 33 | 57 | 137 | 56% |
| + one match | 932 | 4 | 3 | 15 | 16% |

Chips tracked exactly: `10 Feb`, `Match 41d4555d`, `Bots only`, `Clear all`.
Empty state confirmed on Grand Rift plus 9 Feb: "No events on Grand Rift with the selected
day", with buttons to clear the day or clear everything.

### Notes
- **Event counts exclude the event filter itself.** Verified: unchecking every type except
  Loot left the other counts unchanged (Kill vs player still reads 2). If the filter applied
  to its own counts, a zero would mean "you switched it off" rather than "none of these
  happened here", and on this data the second reading is the one that matters.
- **Bug found and fixed during verification: coverage claimed 0%.** Filtering events down to
  Loot removes all position rows, and coverage is computed from position data, so the strip
  read "coverage 0% of playable land". That states a measurement that was never taken and
  reads as "players visited none of this map". Now returns null and the strip says
  "coverage needs position events".
- Paths filter by whole journey, never by trimming points. A part-filtered path would draw a
  fragment and imply the player stopped where the filter did.
- Framing follows the map, not the filter: re-fitting on every filter change would make the
  map jump and make two filtered views impossible to compare by eye.
- The day filter is single-select although the data layer supports a range. Six days means a
  designer picks one or looks at everything; two range dropdowns would be fiddlier for a case
  that barely arises. Range support stays in the query layer for Phase 7's comparison view.
- `Position` and `BotPosition` have no marker style, so they were falling back to raw names in
  the event list. Given friendly labels in the rail rather than editing `layers.ts`, which was
  outside this phase's scope.

### Files
Created: `src/ui/FilterRail.tsx` - `src/ui/FilterChips.tsx`
Modified: `src/App.tsx` - `src/ui/controls.css`

---

## 2026-09-10 - Phase 4 - Data layers
**Tasks:** 4.1 - 4.10   **Commit:** _(this commit)_   **Status:** DONE

### Did
- `src/map/theme.ts` - reads colours from the CSS tokens at runtime and caches them, so the
  legend and the canvas cannot drift. Builds a marker-shape icon atlas on a canvas, plus the
  matching inline SVG so the legend draws exactly what the map draws.
- `src/map/layers.ts` - pure layer factories: heat images, dead space, event markers,
  journey paths, live actors.
- `src/ui/LayerPanel.tsx` - eight toggles with counts and an always-visible legend.
- `src/App.tsx` - layers composed in a fixed draw order, stats strip, tooltips. Phase 3's
  debug point overlay deleted.

### Verified
| Check | Result |
|---|---|
| `npm test` | 63 passed |
| `npx tsc -b` | exit 0 |
| Console errors | none, with every layer enabled |
| Pan, all 8 layers on | **median 57 fps** (criterion was >30) |
| Traffic + all markers + paths | 57 fps |
| All markers, no heat | 57 fps |

**Registration, by looking (Ambrose Valley):**
- **Traffic** traces the road network as continuous routes between places.
- **Dwell** is discrete blobs sitting on buildings; the roads all but vanish.
- **Loot** green squares cluster inside buildings and compounds.
- **Kills** orange triangles cluster on the same compounds.
- **Dead space** grey cells hug the island fringe, none in the black void.

The traffic/dwell contrast is the headline result and it is visually unmistakable:
**corridors versus destinations**, from identical rows.

### Notes
- **HeatmapLayer was unusable here and had to be replaced.** deck.gl re-aggregates it on
  every viewport change and drags the whole layer stack through the recomputation. Measured
  while panning: traffic + paths **2 fps**, traffic + loot **11 fps**, traffic + kills 25 fps,
  all markers with no heatmap 58 fps. The cost scaled with the object count of whatever was
  drawn beside the heatmap, which is precisely the case a designer needs. Replaced with a
  heat field rasterised once to a canvas and shown as a BitmapLayer: per-frame cost is now
  constant and independent of point count. **1 fps to 57 fps.**
- **Self-inflicted bug worth remembering: never memoise a deck.gl Layer.** Caching layer
  instances to avoid rebuilding them stopped the icon layers rendering entirely, silently and
  with no error. deck.gl layers are single-use descriptors; reusing an instance breaks the
  lifecycle. Worse, it briefly made the perf numbers look good because the layers were not
  drawing. Cache the *image*; build layers fresh each render, they are cheap.
- `pickingRadius` is a Deck prop, not a Layer prop. Setting it on IconLayer threw an
  initialisation assertion; setting it on the React `DeckGL` component threw as well in this
  version. Removed; default picking works.
- Heat is normalised to the 98.5th percentile rather than the maximum, so one extreme cell
  (a spawn, or a player idling in a corner) cannot flatten the whole map to near-black.
- Diagnostic path that worked: bisect by enabling one layer at a time and measuring. Layer
  totals were 37/36 fps for the heatmaps and 58-63 for everything else, but all-on was 1 fps,
  which immediately ruled out a simple additive cost and pointed at an interaction.

### Known limitation
Enabling all eight layers at once is visually unreadable: 986 paths and roughly 12,000
markers bury the map. Individually every layer is legible. This is what Phase 5's filters
exist to solve, so it is recorded rather than patched over.

### Files
Created: `src/map/theme.ts` - `src/map/layers.ts` - `src/ui/LayerPanel.tsx`
Modified: `src/App.tsx` - `src/ui/MapCanvas.tsx` - `src/ui/controls.css`

---

## 2026-09-10 · Phase 3 fix — Map framing
**Tasks:** 3.3 (revisit)   **Commit:** _(this commit)_   **Status:** DONE

### Did
Fixed a real defect spotted from a screenshot on a 1920-wide monitor: the map drew at a
**fixed size regardless of viewport**, leaving most of a wide screen empty.

Two separate causes:
1. `initialViewState` hardcoded `zoom: 0`. Orthographic zoom is log2, so zoom 0 means one
   world unit = one CSS pixel, and the map drew at exactly 1024px on every screen. That
   clips a short viewport and floats in emptiness on a wide one. Replaced with `fitZoom`
   derived from the measured element, via `ResizeObserver`.
2. Even fitted, the framing was wrong: the minimap art is a square canvas with the island
   painted inside it, so roughly a quarter of every image is empty margin. Now frames the
   **UV bounds of the data** for that map instead of the image square.

Zoom limits are now anchored to the fitted zoom rather than absolutes, so a small window can
still frame the whole map and a large one cannot zoom out to a speck. A `touched` ref keeps
a deliberate pan through a resize while still re-framing when the user has not moved.

### Verified
| Viewport | Before | After |
|---|---|---|
| 1920x900 | 776x844 drawn, **100% tall (clipped)**, 40% wide | 656x768, **91% tall**, 34% wide |
| 1440x900 | 776x844, 54% wide | 656x768, 91% tall, 46% wide |
| 1280x720 | 772x664, 60% wide | 512x604, 90% tall, 40% wide |

Drawn size now scales with the viewport (656px at 848px tall, 512px at 668px tall) where
before it was constant. 63 tests pass, `tsc` clean.

### Notes
- Remaining horizontal margin is geometric, not a bug: the data region is roughly square and
  the viewport is 21:9. Phase 5 fills those sides with the filter rail and context panel.
- Framing is computed from **all rows on the map**, not the filtered set, so changing a
  filter does not make the view jump around.
- Three new tests cover it: fit scales with viewport, degrades safely at zero size (before
  measurement), and limits anchor to fit rather than to constants.

### Files
Modified: `src/map/project.ts` (`fitZoom`, `fitViewState`, `padBounds`, `UVBounds`) ·
`src/map/project.test.ts` · `src/ui/MapCanvas.tsx` · `src/App.tsx`

---

## 2026-09-10 · Phase 12 (early) — Deployment fixed and verified live
**Tasks:** 12.1, 12.1a, 12.2   **Commits:** `fa8d901`, `2322633`, `d57bb47`   **Status:** DONE

### Did
Discovered the live site had been serving **Phase 0 code for three phases**. It had been
deployed by hand once, so pushing to GitHub did nothing. Diagnosed and fixed properly:

1. Added `wrangler.jsonc` declaring the static-assets Worker.
2. Connected the repo to Cloudflare Workers Builds (user action in the dashboard).
3. First CI run failed in **0s**: `assets.directory does not exist: /opt/buildhome/repo/dist`.
   The log ran `npm clean-install` then went straight to `npx wrangler deploy` — **no build
   step at all**, because the dashboard had a deploy command but an empty build command.
4. Fixed by declaring `build.command` in `wrangler.jsonc` rather than asking someone to fill
   in a dashboard field. Config that lives only in a web UI is invisible to the repo, cannot
   be reviewed, and breaks silently when the project is re-created.

### Verified
| Check | Result |
|---|---|
| CI build `d57bb47` | **success in 90s** |
| Live JS hash | `index-DtZ-Mpgn.js` — matches the local Phase 3 build |
| `/meta.json` | 209,227 B `application/json`; rows/matches/OOB identical to local |
| `/bundle.bin` | 2,136,384 B `application/octet-stream` — a real binary, not an HTML fallback |
| Minimaps | 182,762 / 167,976 / 199,664 B, all `image/webp` |
| Unknown path | **404** — confirms `not_found_handling: "none"` is doing its job |
| Canvas present | true |
| All three maps render | screenshotted live; Lockdown shows points on the ring road and **none in the ocean** |
| Console errors | none |
| Time to interactive | **7.0s** ⚠️ against a < 3s target |

### Notes
- **How the staleness was caught:** the URL returned `200` and served the right title, which
  is exactly why "the link works" is not evidence. What exposed it was diffing the deployed
  JS hash against the local build, then grepping the deployed bundle: it contained the
  Phase 0 placeholder string `"Scaffold ready"` and **zero** references to `bundle.bin` or
  `OrthographicView`. Verify by asset hash, not by HTTP status.
- **New performance finding (12.3):** 7.0s to interactive, well over target. deck.gl is
  973 KB of JS (284 KB gzipped) and `bundle.bin` is another 2.1 MB. Both load before the
  first useful paint. Fix is lazy-loading deck.gl and showing the shell before data lands.
  Logged for Phase 10 rather than fixed now; it is a real gap, not a rounding error.
- `npm run deploy` reduced to `wrangler deploy`, since wrangler now runs the build itself.

### Files
Created: `wrangler.jsonc` · `.nvmrc` (Node 22)
Modified: `package.json` (deploy scripts), `TASKS.md`

---

## 2026-09-10 · Phase 3 — Map canvas
**Tasks:** 3.1 – 3.4   **Commit:** _(this commit)_   **Status:** DONE

### Did
- `src/map/project.ts` — pure projection, no React or deck.gl imports. `worldToUV`,
  `uvToWorld`, `uvToWorldSpace`, `worldToWorldSpace`, `worldSpaceToUV`, `uvToPixel`,
  `isInBounds`, `minimapUrl`, zoom clamps and `initialViewState`.
- `src/map/project.test.ts` — 15 tests, including the dataset README's worked example and
  the measured coordinate extremes of all three maps.
- `src/ui/MapCanvas.tsx` — deck.gl `OrthographicView({flipY:false})` into a fixed 1024-unit
  square, `BitmapLayer` at `[0,0,S,S]`, clamped zoom, keyboard-operable controls, plus a
  clearly-marked `debugPointsLayer` scaffold for Phase 4 to replace.
- `src/ui/controls.css` — control styling built only from existing tokens.
- `src/App.tsx` — map switcher as a real `radiogroup` (arrow keys move, single tab stop)
  and a toggle for the position-sample overlay.

### Verified
| Check | Result |
|---|---|
| `npm test` | **60 tests passed** (20 pipeline + 25 runtime + 15 projection), 2.38s |
| `npx tsc -b` | exit 0 |
| `npm run build` | clean, 17s |
| **Registration, by looking** | See below. All three confirmed against map art. |
| Console errors | none, on all three maps |
| Keyboard | Tab reaches the switcher; ArrowRight cycles Ambrose → Grand Rift → Lockdown; exactly one tab stop in the group; focus ring visible in a screenshot |
| Zoom / reset | zoom-in disables at max; reset returns to the framed view |
| Pan frame pacing (real GL, 1280x900) | points off: median 16.7 ms, p90 31.7, worst 40.8 · points on (9,739): median 16.7 ms, p90 94.1, worst 111.4 |

**Registration evidence (this is the acceptance criterion that matters):**
- **Grand Rift** — the decisive one, because its POI names are baked into the art. Samples
  cluster exactly on **Mine Pit**, **Engineer's Quarters**, **Labour Quarters**,
  **Burnt Zone** and **Gas Station**, and trace the roads between them.
- **Ambrose Valley** — samples sit inside the stadium, the compounds and the southern town,
  follow the road network, and none fall in the surrounding void.
- **Lockdown** — samples follow the ring road and fill the buildings, with **zero points in
  the teal ocean** at the top of the map. A projection offset would put points in the water.

### Notes
- **The blank-canvas failure, and why the "confirm by looking" rule earned its keep.**
  First screenshots came back completely empty: clean compile, zero console errors, correct
  canvas size, working WebGL context. Nothing on screen. Isolating it (controlled vs
  uncontrolled viewState, then PNG vs WebP at 1024 vs 2048) ruled out the code entirely —
  all four image variants were blank, including the exact PNG that had rendered in the
  original spike. The cause was the **test harness**: I launched Chromium with
  `--use-gl=swiftshader --enable-unsafe-swiftshader`. Under SwiftShader deck.gl reports
  `onAfterRender` and logs no error, but draws nothing. Removing those flags rendered all
  three maps correctly. **Never pass GL flags to Playwright when verifying deck.gl output.**
- **This invalidates the earlier "60 FPS locked" spike figure** (BUILD_LOG, Phase 0 spike 4).
  That number was measured under SwiftShader, i.e. on a renderer drawing nothing, so it
  measured an empty loop. Real measured pacing is in the table above. The architecture
  conclusion is unchanged — the median holds ~60 fps — but the original evidence was worthless.
- The p90 tail comes from the raw 9,739-point debug overlay, confirmed by measuring with it
  off (31.7 ms) and on (94.1 ms). It is scaffolding; Phase 4's layers aggregate to grids.
- **Scope violation, caught and fixed:** I first appended control styles to
  `src/design/tokens.css`, which the Phase 3 brief explicitly forbids touching. Reverted and
  moved to `src/ui/controls.css`. Better separation anyway: tokens are the vocabulary,
  component CSS is a sentence written with it.
- Panning is deliberately not eased (`transitionDuration: 0`); only reset animates, at 220ms.
- `getComputedStyle(el, ':focus-visible')` returns nothing — pseudo-class styles are not
  readable that way. Focus was verified by screenshot instead.

### Files
Created: `src/map/project.ts` · `src/map/project.test.ts` · `src/ui/MapCanvas.tsx` ·
`src/ui/controls.css`
Modified: `src/App.tsx` · `src/main.tsx`

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
