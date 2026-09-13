# Insights

Four findings read from five days of LILA BLACK telemetry (89,016 rows, 796 matches across
three maps). Each one is something the tool surfaces on screen, with the numbers behind it,
what it implies for design, and the metric it should move. The first three are level-design
findings. The fourth sits outside level design but is too large to leave out.

Every figure below is measured from the shipped dataset and can be reproduced in the tool.

## 1. The storm is not a mechanic for most of the playerbase

**What caught the eye.** Scrubbing the timeline, the storm marker sits far to the right of
where most matches end. The survivorship curve has already collapsed by the time the storm
can do anything.

**The evidence.** Storm deaths have a hard floor at about 655 seconds of match-elapsed time
(10:55). There is not a single storm death before it. Only 140 of 796 matches (18%) last long
enough to reach that floor, and just 39 of them produce a storm death. The median match runs
382 seconds, so 82% of matches are over before the storm exists as a threat.

**What to do about it.** Pull the storm's activation earlier, or shorten the match, so the
mechanic applies to the bulk of sessions rather than the tail. The metrics to watch are the
match-duration distribution, the storm-death rate, and the extraction-timing pressure the
storm is meant to create.

**Why a level designer cares.** A closing play space is one of the main tools for forcing
movement and confrontation late in a match. If it activates after most matches are finished,
that pressure is never felt, and the pacing of the final minutes is being shaped by something
players almost never see.

**See it in the tool.** Open the timeline and watch the survivorship curve against the storm
marker (the stat strip shows storm onset at 10:55). Insight one in the Insights panel jumps
straight to this view.

## 2. This plays as a single-player PvE looting game, not an extraction shooter

**What caught the eye.** Filtering to humans only, then to player-versus-player kills, the map
goes almost empty. The combat on screen is overwhelmingly against bots, and looting dominates
everything else.

**The evidence.** 779 of 780 human-bearing matches contain exactly one human; only a single
match ever had two. There are three player-versus-player kills in the entire five days,
against thousands of encounters with bots, a player-versus-environment to player-versus-player
ratio of roughly 787 to 1. Looting is 80.3% of all non-position events. This is a population
effect, not a matchmaking fault: median concurrency is one human, and Grand Rift has two or
more humans online only 2% of the time.

**What to do about it.** Design for the game as it is actually experienced. Bot encounter
placement is the combat design, so it deserves the same care a competitive map's sightlines
would get. If genuine player-versus-player is a goal, concentrate the population by merging
map rotation rather than spreading a thin playerbase across three maps. The metrics are
encounter rate per match, concurrency per map, and the PvE to PvP mix.

**Why a level designer cares.** A map built for player-versus-player firefights, drop
contests and third-partying will be tuned for encounters that are not happening. The same
floor plan judged as a PvE looting route, pacing and bot-ambush layout is a different and more
useful design conversation.

**See it in the tool.** Set the actor filter to humans only and toggle the kills and loot
layers, or open insight two in the Insights panel. The stat strip separates kills against bots
from the handful against players.

## 3. Lockdown wastes a third of its playable space, the other two maps do not

**What caught the eye.** Switching between maps with the dead-space layer on, Lockdown shows
noticeably more unused playable ground than Ambrose Valley or Grand Rift.

**The evidence.** Measured against a playable-land mask, so ocean and out-of-bounds void are
not counted, traffic covers 87% of Ambrose Valley and 84% of Grand Rift, but only 65% of
Lockdown. Roughly a third of Lockdown's reachable ground goes unvisited.

**What to do about it.** Find Lockdown's cold zones with the dead-space layer and either give
them a reason to exist, with loot, an objective or a routing pull, or cut them so the play
space matches how the map is actually used. The metrics are coverage percentage and the
evenness of the traffic distribution.

**Why a level designer cares.** Unused space is wasted authoring effort and it dilutes
encounters by spreading players thinner than the layout intends. Coverage that sits well below
comparable maps is a direct, spatial signal of where a level is not paying for itself.

**See it in the tool.** Turn on the dead-space layer and compare Lockdown with Ambrose Valley,
either by switching maps or with side-by-side compare. The coverage figure is in the stat
strip. Insight three opens this view.

## 4. Retention is one-and-done for most players (beyond level design)

This is a product and live-operations finding rather than a level-design one, but it is the
largest single fact in the data and it frames all three findings above.

**The evidence.** 205 of 245 humans (84%) played on exactly one day. The daily human count
falls from 98 to 80 to 59 to 47 across the four full-coverage days, a steady decline rather
than a one-off dip.

**What to do about it.** This points at onboarding, first-session payoff and return hooks, not
at any single map. It is included because it sets the stakes: the pacing and combat problems in
findings one and two are exactly the kind of first-session experience that decides whether a
player comes back, so fixing them is a retention lever as much as a design one.

**Why it matters here.** A level designer cannot fix retention alone, but the shape of the
first match, how long it lasts, whether it contains real tension, and whether it feels like a
game with opponents, is squarely level-design territory, and on this data the first match is
usually the only match.
