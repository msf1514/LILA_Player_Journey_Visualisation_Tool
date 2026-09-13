# Architecture

This is a static, backendless tool. Every parquet file is encoded once, at build time, into
a single binary bundle. The browser fetches that bundle in one request and does all filtering,
aggregation and rendering locally. There is no server to cold-start and no database to query,
which is deliberate: the whole thing has to run reliably while it is being evaluated, from a
link, on someone else's machine.

## Data flow, parquet to screen

```
player_data/  1,243 .nakama-0 files (8.37 MB on disk)
      │
      │  build:maps  (pipeline/minimaps.mjs)
      │     downscale minimap art to 2048 square webp
      │     derive a 256x256 playable-land mask per map
      │
      │  build:data  (pipeline/build.mjs)
      │     parse every file with hyparquet
      │     drop one exact-duplicate file (-88 rows, 89,104 -> 89,016)
      │     normalise ts, actors, events, coordinates (pipeline/transform.mjs)
      │     encode into a columnar binary + dictionaries
      ▼
public/bundle.bin  (~2.1 MB, ~1.1 MB gzipped)  +  public/meta.json
      │
      │  one fetch at startup (src/data/loader.ts)
      ▼
Store  (src/data/store.ts)  typed columnar arrays, one row range per map
      │
      │  filter + aggregate in the browser (src/data/query.ts)
      │  single-digit milliseconds on 89k rows
      ▼
deck.gl layers on ONE WebGL context  (src/ui/MapStage, src/map)
      ▼
screen
```

The bundle keeps raw rows rather than precomputed heatmaps. Precomputing would be smaller,
but it would freeze the set of filter combinations and destroy drill-down from a hot cell to
the individual runs beneath it. Aggregating 89,016 rows on demand is cheap enough that there
is nothing to gain by giving that up.

## Coordinate mapping

The single most important thing to get right in a tool like this is placement: if a point
lands in the wrong spot, every conclusion drawn from the map is wrong, and the error is
invisible until someone who knows the map notices a firefight in the ocean. So the projection
lives in one place, `src/map/project.ts`, as pure functions shared by the heat, the markers
and the paths, and it is covered by tests against a Python reference.

**The world is x and z. The y axis is elevation and never affects 2D placement.** A player
standing on a roof and a player in the street below it occupy the same point on the map.

**World to normalised UV.** Each map carries a `scale`, `originX` and `originZ`:

```
u = (x - originX) / scale
v = (z - originZ) / scale
```

These constants come from the dataset README and were independently verified four ways: 0 of
89,016 rows fall outside UV [0, 1] on any map; hotspots land inside buildings rather than in
open ground; 99.3% or more of visited cells fall within the playable-land mask derived from
the art; and the resulting movement speeds are physically plausible (median 2.52 m/s, max
12.65), which confirms world units are metres.

**UV to render space.** deck.gl draws into a fixed square of S by S units (S = 1024):

```
renderX = u * S
renderY = v * S
```

V is not flipped here. The `OrthographicView` is configured with `flipY: false`, so render Y
grows upward exactly as world Z does, and the `BitmapLayer` bounds place the minimap the same
way. The tempting mistake is to flip V here and also flip the image: the two cancel out and
look correct on a symmetric map while being wrong on every asymmetric one, which is the worst
possible way for this to fail. There is exactly one flip in the codebase, and it is for image
pixels only.

**UV to image pixels.** When addressing a raster directly (the mask, offline renders, tests)
the origin is top-left, so Y is flipped once, here and nowhere else:

```
px = u * width
py = (1 - v) * height
```

**Worked example.** Take the dataset README's own sample point on Ambrose Valley, where
`scale = 900`, `originX = -370`, `originZ = -473`:

```
x = -301.45,  z = -355.55
u = (-301.45 - (-370)) / 900 =  68.55 / 900 = 0.0762
v = (-355.55 - (-473)) / 900 = 117.45 / 900 = 0.1305

image pixel (1024 reference):  px = 0.0762 * 1024 = 78
                               py = (1 - 0.1305) * 1024 = 890
render space:                  x = 78.0,  y = 133.6
```

The pixel result, (78, 890), is exactly the figure the dataset README documents, which is how
the projection was first confirmed before the full-dataset checks above.

## Assumptions where the data was ambiguous

The supplied dataset README is wrong in several places. Each disagreement was resolved by
measuring the data, not by trusting the document, and the resolution is recorded here.

| Question | What the README said | What the data showed | Resolution |
| --- | --- | --- | --- |
| Timestamp units | milliseconds | `ts` is epoch seconds in a millisecond-typed column; read naively it reports 1970 | multiply by 1000, verified every row lands in the Feb 2026 window |
| Human vs bot | bots are named by event prefix | bots emit `Position` and `Loot`; humans emit `BotKilled`; the prefix rule is false | UUID id is human, short numeric id is bot; three genuinely ambiguous accounts are flagged |
| Minimap sizes | all 1024x1024 | 4320x4320, 2160x2158 (not square) and 9000x9000 | never assume a size; work in UV, normalise art to 2048 square (GrandRift stretches 0.09%, sub-pixel) |
| Day boundaries | not stated | folder days align to UTC at 99.5%, with 3 matches spanning two UTC dates | treat folder names as UTC days |
| Unused space | not stated | measuring against the whole square counts ocean and void as unused map | measure dead space only against a playable-land mask (coverage is 87/84/65%, not 43/37/33%) |
| Solo matches | implies low concurrency | 743 solo matches, but 689 of them contain `BotKill`, which needs an opponent file | treat single-file matches as a partial export, not proof of an empty lobby |

## Design tradeoffs

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Transport | one columnar binary bundle | JSON | 2.1 MB versus 15.45 MB; the whole dataset ships in a single request |
| Granularity | raw rows | precomputed aggregates | keeps every filter combination and drill-down; browser aggregation costs single-digit ms |
| Backend | none, static hosting | an API | nothing to cold-start or fall over during evaluation; caps scale (see below) |
| Timeline | match-elapsed time | wall-clock | matches are independent sessions, so only relative time aligns "where is everyone at minute 3" |
| Colour | chrome neutrals plus Okabe-Ito data palette | one brand accent | six data categories must stay separable at a glance and under colour blindness; shape is a second channel |
| Side by side | one WebGL context, two viewports | two deck.gl canvases | two contexts caused GPU compositing flicker on filter and timeline changes |
| Y handling | flip once, for image pixels only | flip in both render and image space | a double flip is correct on symmetric maps and silently wrong on the rest |

## Where the browser-only approach stops

The client-side design is correct up to roughly 2 to 5 million rows, about 50 times the
current 89,016. Aggregation is linear in row count and runs in single-digit milliseconds
today, so there is comfortable headroom for far more maps, more days, or higher sampling
rates without any change.

Beyond that band the browser is the wrong place to aggregate: the bundle would grow past what
is reasonable to ship in one request, and per-frame filtering would start to drop frames. The
change at that point is to move aggregation off the client rather than to optimise it further:
either precompute spatial tiles and stream the ones in view, or put the columnar data behind a
query engine (an in-browser engine such as DuckDB-WASM for a mid-sized jump, or a small backend
for a large one) and fetch aggregates instead of rows. The projection and the UV contract in
`src/map/project.ts` stay exactly as they are; only the source of the numbers behind each layer
changes.
