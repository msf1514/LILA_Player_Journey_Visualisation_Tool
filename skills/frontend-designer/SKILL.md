---
name: frontend-designer
description: House frontend design-taste system for WeWood, synthesized from the full skill library (design-taste-frontend, gpt-taste, high-end-visual-design, minimalist-ui, industrial-brutalist-ui, apple-design, emil-design-eng, refero-design, animate/review-animations, pick-ui-library, vercel-react-best-practices, imagegen-frontend-*, and more). Use this BEFORE designing or building any web UI, landing page, component, or visual system — it sets the taste dials, the anti-slop bans, the typography/color/layout/motion rules, and the process for producing premium, non-generic frontend work instead of default AI output.
---

# Frontend Designer

You are designing a real interface, not filling a template. Every choice below should be one you could defend out loud. This skill is the consolidated taste system pulled from every design/animation/Vercel skill in this project's `.claude/skills/` library — treat it as the house style, and reach into the individual source skills (named throughout) for deeper detail when a situation calls for it.

## 0. Process — read before you generate

1. **Read the brief, don't guess it.** Infer page kind (landing / portfolio / dashboard / editorial / redesign), audience, vibe words, any existing brand assets, and quiet constraints that override aesthetics (accessibility requirements, regulated industry, an existing design system already in use). State your read in one line before generating: *"Reading this as: [page kind] for [audience], with [vibe] language, leaning toward [system/aesthetic]."* Ask one clarifying question only if genuinely ambiguous — otherwise declare and proceed.
2. **Check for an official design system first.** If the brief maps to one (enterprise/MS → Fluent, Google-ish → Material 3, IBM-style → Carbon, Shopify apps → Polaris, Atlassian → Atlaskit, GitHub-style → Primer, public sector → govuk-frontend/USWDS, modern SaaS → Radix Themes/shadcn, indie default → Tailwind), use it — never hand-recreate a system's CSS, never mix two systems in one project. For a pure-aesthetic brief with no official package (glassmorphism, brutalism, bento, editorial, dark-tech), build with native CSS/Tailwind and be honest that it's an approximation, not an official kit.
3. **Set the three dials.** Every design has three independent knobs — decide them explicitly, don't default silently:
   - **DESIGN_VARIANCE** (1 = perfect symmetry → 10 = artsy chaos)
   - **MOTION_INTENSITY** (1 = static → 10 = cinematic/physics-driven)
   - **VISUAL_DENSITY** (1 = art-gallery airy → 10 = cockpit-packed)
   Baseline is `8/6/4` absent other signal. Map vibe words to dials: "minimalist/calm/Linear-style" → 5-6/3-4/2-3; "playful/Awwwards/experimental" → 9-10/8-10/3-4; "trust-first/public-sector/enterprise" → 3-4/2-3/4-5. Pick a use-case preset (SaaS landing, agency, portfolio, editorial, public-sector) and let it set the defaults, then adjust for the specific brief.
4. **Commit to one coherent combination — don't average.** Pick one dominant direction (one theme paradigm, one background character, one typography character, one hero architecture, one motion language) and preserve its sharp, distinctive traits. Borrow at most 1-2 narrow details from a secondary reference — never blend conflicting references into a safe, flavorless middle (e.g. dark+acid+serif inputs should NOT converge into "warm cream + muted orange + polite serif"). If you have concrete references, keep a mental decision ledger: *decision → source → why* — every major choice should be traceable to something other than vibes.
5. **If asked for options, make them genuinely diverge.** 3-5 variants max, each diverging on a *named axis* (e.g. "Quiet" vs "Editorial" vs "Playful" — not "Option A/B/C"). Every variant still meets the full craft bar below; divergence is never an excuse for sloppy execution. Present a tradeoff, don't pre-pick a favorite.

## 1. Typography

- **Don't default to Inter** for anything premium/creative/brand-forward. Fine only when the brief explicitly wants neutral/Linear-style, or is public-sector/accessibility-first. Prefer: Geist, Outfit, Cabinet Grotesk, Satoshi, Clash Display, Plus Jakarta Sans, Space Grotesk, IBM Plex Sans, General Sans.
- **Serif is a deliberate choice, not a default.** "Creative brief → serif" is the single most-tested AI tell. Only use serif when the brand brief names one, or the aesthetic is genuinely editorial/luxury/heritage. Never default to Fraunces or Instrument Serif (the two LLM-favorite serifs) — rotate instead: PP Editorial New, GT Sectra Display, Cardinal Grotesque, Reckless Neue, Tiempos Headline, Recoleta, Playfair, EB Garamond, Canela.
- Emphasis inside a headline uses italic/bold of the *same* family — never inject a random serif word into a sans headline.
- Italic words with descenders (y g j p q) need `leading-[1.1]` minimum plus a reserved `pb-1`/`mb-1` or they clip.
- Display type: `text-4xl md:text-6xl tracking-tighter leading-none`. Body: `text-base text-gray-600 leading-relaxed max-w-[65ch]` — 65ch is a hard line-width ceiling for body copy.
- Tracking is size-specific, never a fixed global value: negative tracking on large display type, near-zero/slightly positive on small text; leading moves inversely (tight on headings, loose on body). Build hierarchy from weight + size + leading together, not size alone.
- Use tabular/monospace numerals for data-heavy UI. Balance headlines (`text-wrap: balance` / `pretty`) and check for orphans.

## 2. Color

- Max one accent color, saturation under 80%.
- **No default AI-purple/blue gradients or neon glow buttons.** Neutral base (Zinc/Slate/Stone) + one high-contrast, intentional accent (Emerald, Electric Blue, Deep Rose, Burnt Orange). Only use purple if the brand explicitly calls for it, executed with real intent — flag it if so.
- Lock the accent: the same accent, used identically, across the entire page. No drift section to section.
- Never pure `#000000` — use off-black/zinc-950/charcoal (e.g. `#0A0A0A`, `#121212`).
- **The warm-beige/brass/oxblood/espresso "premium consumer" palette is now itself a cliché** for cookware/wellness/artisan/luxury briefs — don't default to it. Rotate among: Cold Luxury (silver/chrome/smoke), Forest (deep green/bone/amber), Black-and-Tan, Cobalt+Cream, Terracotta+Slate, Olive+Brick+Paper, Monochrome+single pop. Never ship the same palette family twice in a row on the same project.
- Tint shadows to the background hue — never a pure-black drop shadow on a light background.
- Distinguish lazy gradients from professional ones: **banned** — rainbow/mesh blobs, purple-to-blue, neon glow halos, gradient-text-as-premium-shortcut. **Allowed** — low-chroma palette-matched tonal grades, single-hue atmospheric grades behind photography, soft vignettes, noise-textured depth.

## 3. Layout & composition

- Avoid centering the hero/H1 when DESIGN_VARIANCE > 4 — prefer split-screen, left-aligned, or asymmetric whitespace. Exception: editorial/manifesto briefs where the message itself is the design.
- **The 3-equal-card feature row is the most generic AI layout there is.** Replace with a 2-col zig-zag, asymmetric grid, horizontal scroll, or masonry.
- Max 2 consecutive left-image/right-text zig-zag sections — a 3rd in a row is a fail.
- A layout family used once shouldn't repeat: an 8-section page needs at least 4 distinct layout families.
- Don't default to "big headline left + small explainer right" as a section header — stack vertically instead.
- CSS Grid over flexbox percentage math.
- `min-h-[100dvh]`, never `h-screen` (iOS Safari viewport jump).
- Container max-width 1200-1440px (`max-w-7xl`), centered with `mx-auto`.
- Max one uppercase-tracking "eyebrow" label per 3 sections.
- Bento grids: exact cell count = exact content count, no empty filler cells; use `grid-flow-dense`; vary card backgrounds (not all white-on-white).
- One corner-radius scale for the whole page (all-sharp, all-soft, or all-pill) — pick one and hold it, or define one explicit exception and apply it everywhere that case occurs.
- Hero constraints: headline ≤ 2-3 lines, subtext ≤ 20-25 words / ≤ 4 lines, CTA visible without scrolling, capped top padding (`pt-24` max desktop), max 4 stacked text elements (eyebrow, headline, subtext, CTAs) — don't stuff in a trust strip, tagline, and pricing teaser too.
- Nav: single line at desktop, height capped 64-80px.
- CTA text fits one line; never ship two CTAs with duplicate intent on one page ("Get in touch" + "Let's talk").
- Avoid cards-inside-cards-inside-cards and giant rounded wrapper sections around everything — prefer open layouts with fewer, stronger containers.
- One theme per page (light/dark/auto) — sections shouldn't flip mode mid-scroll unless it's a deliberate single "theme switch on scroll" device. WCAG AA minimum body contrast, AAA target for hero copy; brand color stays recognizable in dark mode.
- Buttons stay bottom-aligned across a card group of varying content length; feature lists in a pricing row start at the same vertical position across all columns; nudge optically-centered-but-visually-wrong elements (icons, play buttons) by 1-2px by eye, not by the math.

## 4. Copy discipline

- No "John Doe"/"Acme Corp"/"Nexus"/"SmartFlow" — invent specific, believable names.
- No fake round numbers (`99.99%`, `50%`) — use organic, messy data (`47.2%`, `+1 (312) 847-1928`).
- Ban AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen", "Game-changer", "Delve", "Revolutionize", "Transformative platform".
- No Lorem Ipsum, no Title Case headers (sentence case), no exclamation marks in success/error messages, direct error copy ("Connection failed. Please try again." not "Oops!"), active voice.
- **Zero-tolerance em-dash ban** — across headlines, eyebrows, body, quotes, captions, buttons, alt text. Use a regular hyphen. This is one of the most consistently flagged AI tells across the whole design-taste corpus — never use an em-dash in shipped copy.
- No meta-labels: no "SECTION 01"/"QUESTION 05" eyebrows, no version labels in hero unless it's a real launch, no "Quietly in use at" filler, no scroll cues ("Scroll to explore", bouncing chevrons), no fake version footers (`v1.4.2`, `Build 0048`), no invented photo credits, no decorative colored status dots without real semantic meaning, middle-dot (`·`) rationed to one per line.
- Re-read every visible string before shipping for grammatical breaks, hallucinated phrasing, or forced metaphors.

## 5. Iconography & imagery

- Avoid Lucide/Feather as the default icon pack for anything premium/brand-forward — prefer Phosphor, HugeIcons, Radix Icons, or Tabler. One icon family per project, standardized stroke width, never hand-rolled SVG paths.
- Image priority order: image-gen tool first, real stock/`https://picsum.photos/seed/{desc}/{w}/{h}` second, explicitly labeled placeholder (told to the user) as last resort. Never fake a dashboard/screenshot with hand-rolled divs — that's the single most common "this was AI-built" tell.
- Real SVG logos for social proof (Simple Icons CDN, devicon), not plain text wordmarks. No category labels under logos. Trust-logo walls live under the hero, never inside it.
- One separate image per section/component — don't collapse distinct visual concerns into a single collage; treat each as its own design decision.
- Hero composition: left-text/right-image is the most overused AI pattern — consider centered-over-background, bottom-aligned-over-image, stacked-center, image-as-canvas, off-grid editorial, or an inverted classic layout instead.

## 6. Motion (full system — see also `animate`, `improve-animations`, `apple-design` for depth)

**Step 1 — should this animate at all?**

| Frequency | Decision |
|---|---|
| 100+/day (shortcuts, command-palette toggle) | No animation. Ever. |
| Tens/day (hover, list nav) | Near-imperceptible only, or none |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare/first-time (onboarding, success) | The delight budget lives here |

**Step 2 — name the purpose in one word**: Feedback, Spatial consistency, State indication, Preventing a jarring change, Explanation (marketing/onboarding only), or Delight (rare tier only). "It looks cool" is not a valid purpose. Data a user reads/acts on shouldn't move for style — decoration belongs on marketing pages.

**Step 3 — pick the cheapest tool that works**: CSS transition (hover/press/class toggle) → CSS `@starting-style` (mount, no JS) → CSS animation (predetermined, stays smooth under main-thread load) → WAAPI `element.animate()` → Motion/Framer (springs, layout animation, exit animation, gesture values). If it's really a component (toast/drawer/command-menu/dropdown), reach for the right library (§7) instead of hand-rolling.

**Properties**: animate only `transform` and `opacity` (compositor-only). `clip-path` is the sanctioned 4th property. `height` only for accordions. Never `scale(0)` as an entrance — start at `scale(0.9-0.97)` + `opacity:0`. `transform-origin` at the trigger for popovers/dropdowns/menus/tooltips — modals are the exception and stay centered. Prefer percentage `translate()` over hardcoded px. Never drive a child's transform via a CSS variable set on the parent (recalculates every child) — set transform directly on the animating element. In Framer Motion, use the full `transform:` string, not the `x`/`y`/`scale` shorthand (not hardware-accelerated, drops frames under load).

**Easing & duration**:

| Situation | Easing |
|---|---|
| Entering/exiting | `ease-out` |
| Moving/morphing on-screen | `ease-in-out` |
| Hover/color change | `ease` |
| Constant motion (marquee/progress) | `linear` |
| Default | `ease-out` |

Never `ease-in` on UI — it delays exactly the moment the user is watching. Built-in CSS easings are weak; define named custom curves:
```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```
Durations: button press 100-160ms, tooltips/small popovers 125-200ms, dropdowns/selects 150-250ms, modals/drawers 200-500ms. **Hard ceiling: UI animation stays under 300ms** (marketing/explanatory motion can run longer). Use springs for drag-with-momentum, "alive" elements, interruptible gestures — Apple-style config `{type:"spring", duration:0.5, bounce:0.2}`, keep bounce 0.1-0.3, reserve real bounce for drag-to-dismiss/playful moments only.

**Interruptibility** (the single most important animation principle, per Apple's own framing): animate from the *live* value, never the target value — anything touchable must be redirectable mid-flight. Avoid CSS keyframes for gesture-driven motion (can't be smoothly grabbed or reversed) — use CSS transitions (they retarget from current value) for anything triggered rapidly, springs for anything gestured. Exit the way it entered (symmetric paths). Give the user the slow phase and the system the fast one (hold-to-confirm: 2s linear hold, 200ms ease-out release).

**Reduced motion & pointer gating**:
```css
@media (prefers-reduced-motion: reduce) { .element { animation: fade 0.2s ease; } }
@media (hover: hover) and (pointer: fine) { .element:hover { transform: scale(1.05); } }
```
Reduced motion means fewer and gentler, not zero — keep opacity/color changes that aid comprehension, drop movement/parallax/overshoot.

**Never ship**: `transition: all`; `scale(0)` entrance; `ease-in` on UI; animation on a 100+/day action; unjustified >300ms UI animation; `transform-origin: center` on a trigger-anchored popover; keyframes on rapidly-retriggered elements; animating `width`/`height`/`margin`/`padding`/`top`/`left`; ungated `:hover` motion with no `(hover: hover)` guard; missing `prefers-reduced-motion`; everything entering at once with no 30-80ms stagger.

## 7. Component & library choices

Pick the library for the task, don't hand-roll a component that already has a well-built solution — and check `package.json` first before adding a new dependency:

| Task | Library |
|---|---|
| Unstyled accessible primitives (dialog/popover/menu/select) | base-ui |
| Command palette | cmdk |
| Toasts | Sonner (mount one `<Toaster/>` at root, never per-page) |
| OTP input | input-otp |
| General animation (springs/layout/exit) | motion (Framer Motion) |
| Animated numbers | NumberFlow |
| 3D globes | Cobe |
| OG images | Satori |
| Syntax highlighting | shiki |
| Real-time/streaming charts | Liveline |
| General charts | recharts |
| Drag and drop | dnd kit |
| Virtualization (1000+ row lists) | Virtuoso |
| State management | zustand |
| Conditional classNames | clsx |
| Variant-driven Tailwind styling | cva |
| Dark mode / theme switching | next-themes |

When using shadcn/ui or any headless-primitive kit, never ship a component with defaults only — customize variant, size, and class overrides every time. Bare defaults are the fastest way to read as generic.

## 8. React/Next performance discipline (build this in from the start, not as an afterthought)

- Eliminate waterfalls: check cheap sync conditions before awaiting, `Promise.all()` independent operations, start promises early and await late.
- Avoid barrel-file imports; use `next/dynamic` for heavy components; defer third-party scripts until after hydration; preload on hover/focus.
- Never define a component inside another component. Prefer composition (compound components, `children`) over boolean-prop proliferation. In React 19+, no `forwardRef` — ref is just a prop.
- Derive state during render, not in effects. Use functional `setState` and lazy `useState` init for expensive values. Move interaction logic into event handlers, not effects.
- Ternary over `&&` for conditional rendering (avoids stray rendered `0`).

## 9. Non-negotiables — quick reference

Never: default Inter for premium work, AI-purple/blue gradients, the 3-equal-card feature row, generic Lucide/Feather icons as default, pure `#000000`, `h-screen` instead of `min-h-[100dvh]`, em-dashes in copy, fake round numbers, hand-rolled fake screenshots, `scale(0)` entrances, `ease-in` on UI, animation on high-frequency actions, `transition: all`, missing `prefers-reduced-motion`, a component shipped with only default props.

When in doubt, hand off to `frontend-reviewer` after building — it applies the mirror-image checklist to what you just shipped.
