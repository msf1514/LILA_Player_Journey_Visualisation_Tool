# LILA BLACK player journey visualisation tool

**Live tool:** https://lila-pjvt.msf1514.workers.dev

A browser-based instrument for reading LILA BLACK match telemetry. It turns 1,243 raw
`.nakama-0` files into a single map view where you can see where players go, where they
linger, where they loot, fight and die, trace individual journeys, rank the busiest
areas, and compare one day, map or actor type against another. It runs entirely in the
browser with no backend, so there is nothing to cold-start and nothing to fall over
while it is being evaluated.

The tool opens on the full dataset and invites you to narrow it, rather than presenting a
pre-filtered story. Where the shipped data can mislead, it says so on screen. A short
guided tour runs on first visit, and the Insights panel arrives with findings already
read from the data.

## What it shows

- **Layers.** Traffic and dwell heat, loot, kills, deaths, dead space, player and bot
  paths, and raw positions, each toggled independently with a legend that names every mark.
- **Filters.** Map, day, individual match, actor type (humans, bots, or both) and event
  type, applied together.
- **Timeline.** Scrub match-elapsed time with a survivorship curve, so a thinning late-game
  map reads as matches ending rather than players leaving.
- **Hotspots.** The densest areas, ranked by share, with two clicks from a hot cell down to
  one player's route.
- **Compare.** Two maps side by side, or a difference view that shows where traffic share
  rose or fell between two selections.
- **Insights.** Findings computed from the data, each opening the exact view that proves it.
- **Bring your own data.** Drop new `.nakama-0` files or register a new map in the browser,
  with no redeploy. Added telemetry is called out in the picker, the stats and as a filter.

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript 5.9 |
| Build and dev server | Vite 7 |
| Rendering | deck.gl 9 on a single WebGL context |
| Data reading | hyparquet (parquet reader, no native addons) |
| Data pipeline | Node scripts, `sharp` for minimap processing |
| Fonts | IBM Plex Sans and Mono |
| Hosting | Cloudflare Workers static assets, auto-deployed on push to `main` |
| Tests | Vitest |

No backend and no database. The whole dataset ships to the client as one compact binary
bundle and is aggregated in the browser.

## Running it locally

Requires Node 20 or newer (developed on Node 24).

```bash
npm install          # install dependencies
npm run build:maps   # prepare minimaps and the playable-land mask
npm run build:data   # encode the parquet files into the bundle the app fetches
npm run dev          # start the dev server at http://localhost:5173
```

The two build steps are required before `npm run dev`, because the dev server does not run
the pipeline itself and the app fetches the generated bundle at startup. The raw
`player_data/` is committed to this repository, so the bundle can be regenerated from a
clean clone without any external download.

For a production build, `npm run build` runs both pipeline steps automatically through its
`prebuild` hook, then type-checks and bundles into `dist/`:

```bash
npm run build        # prebuild (maps + data) then tsc and vite build
npm run preview      # serve the production build locally
```

Run the test suite with:

```bash
npm test
```

## Regenerating the data bundle

The two pipeline scripts are the only things that touch the raw telemetry. Both read from
`player_data/` and write into `public/`, which is git-ignored and rebuilt on demand.

- **`npm run build:maps`** (`pipeline/minimaps.mjs`) downscales the supplied minimap art
  to web size and derives a 256x256 playable-land mask per map. The mask is what lets the
  dead-space measurement count only real, reachable ground instead of the black void around
  each map. It writes `public/minimaps/<Map>.webp` and a mask file the data build embeds.
- **`npm run build:data`** (`pipeline/build.mjs`) parses all 1,243 parquet files, removes
  one exact duplicate file, and encodes the result into a columnar binary. It writes
  `public/bundle.bin` (about 2.1 MB, roughly 1.1 MB gzipped) and `public/meta.json`. Raw
  rows are kept rather than precomputed aggregates, so the tool can drill from any hot cell
  down to the individual runs beneath it.

`npm run prebuild` runs both in order and fires automatically before `npm run build`.

## Data provenance

The telemetry was supplied by LILA Games for this assessment. Player and match identifiers
are UUIDs, so the data is already anonymised at source, with no names, accounts or personal
information present. The tool distinguishes humans from bots by identifier format, which is
the actual signal in the data.

Because the tool has no backend, the deployed site necessarily serves the data bundle to
the browser, so anyone with the live URL can download it regardless of repository
visibility. If LILA would prefer the public deployment not carry the dataset, the author
can strip it from the bundle or take the deployment down on request.

To try the bring-your-own-data feature, open Manage data and drop one of the files in
[sample_data/](sample_data/): `AmbroseValley_sample.nakama-0` merges into an existing map,
and `SampleMap_new.nakama-0` uses an unknown map id so the tool prompts you to register it.

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md): how the data flows from parquet to pixels, the
  coordinate mapping, the assumptions made, and where the browser-only approach stops scaling.
- [INSIGHTS.md](INSIGHTS.md): what the data says, with evidence and design recommendations.
- [WALKTHROUGH.md](WALKTHROUGH.md): an annotated tour of every feature.

## Author and license

Built by Sufiyan. Contact: mohd.sufiyan.km@gmail.com

This repository is a submission for the LILA Games Product Engineer assessment. It is
provided to LILA Games for evaluation only. LILA Games and its assessors may run, read and
evaluate the work to assess this submission; all other rights, including any use,
deployment, modification or distribution beyond evaluation, are reserved by the author and
require the author's written permission. See [LICENSE](LICENSE) for the full terms.
