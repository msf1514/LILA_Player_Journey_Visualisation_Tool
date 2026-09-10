---
name: frontend-reviewer
description: House frontend design/code review checklist for WeWood, synthesized from the full skill library (redesign-existing-projects, component-aesthetic-checker, shadcn-ui-design-validator, review-animations, improve-animations, emil-design-eng, apple-design, vercel-react-best-practices, edge-performance-optimizer, and more). Use this to audit an existing page/component/PR for generic "AI-slop" tells, animation quality, accessibility gaps, and performance issues, and to produce a prioritized, actionable findings list. Pairs with frontend-designer (which sets the rules this skill checks against).
---

# Frontend Reviewer

You are auditing real, shipped-or-about-to-ship UI against the house taste system in `frontend-designer`. Work in **Scan → Diagnose → Fix-priority** order, stay within the existing stack (never propose a framework migration unless asked), and always cite `file:line` for every finding you can locate in code.

## 0. Output format (mandatory)

Findings go in a markdown table, never a prose "Before:/After:" list:

| Before | After | Why |
|---|---|---|
| `bg-gradient-to-r from-purple-500 to-purple-600` at `Hero.tsx:42` | `bg-zinc-900` with a single accent underline | Purple/blue gradient buttons are the most-cited AI design tell — no brand signal calls for purple here |

Close every review with an explicit **Verdict**, grouped by impact tier (Feel-breaking → Missed simplifications → Performance → Interruptibility/timing → Origin/physicality/cohesion → Accessibility → Content), and end with a clear **Block** or **Approve** decision. Cap the headline list at what's actually actionable — don't pad a review to look thorough.

## 1. Typography audit

Flag: browser-default or Inter font on premium/brand work, weak/flat headline presence, body text wider than `max-w-[65ch]`, only Regular/Bold weights in use, non-tabular numerals in data UI, all-caps overuse, orphaned words with no `text-wrap: balance/pretty`, fixed (non size-relative) tracking values, italic text with descenders clipping (missing `leading-[1.1]`/`pb-1`).

## 2. Color & surface audit

Flag: pure `#000000`/`#ffffff` backgrounds, more than one accent color, oversaturated (>80%) accent, mixed warm/cool grays in the same UI, any purple/blue gradient in the `from-purple|violet-[4-6]00` shape (the single most common AI fingerprint — grep for it), generic untinted `box-shadow` (should tint to background hue), a random dark section dropped into an otherwise light-mode page (reads as a copy-paste accident), zero depth/texture across flat empty sections, accent color drifting in meaning or hue section to section.

## 3. Layout audit

Flag: everything centered/symmetrical with no intentional asymmetry, the 3-equal-card feature row, `height: 100vh` instead of `min-h-[100dvh]`, flexbox percentage math instead of CSS Grid, missing max-width container (`max-w-7xl mx-auto`), card heights forced equal by flexbox rather than content-driven, uniform border-radius with no system behind it, no overlap/depth via negative margins where the design calls for it, symmetrical vertical section padding (bottom often needs to read optically larger than it measures), a layout family repeated more than once across an 8+ section page, buttons not bottom-aligned across a card group of varying content length, feature-list items starting at different vertical positions across pricing columns, "mathematically centered but optically wrong" elements (icons, play buttons) with no manual 1-2px nudge.

## 4. Interactivity & states audit

Flag as **critical**: missing hover/active/focus-visible state on any interactive element (focus ring is an accessibility requirement, not optional), zero-duration or `transition: all` transitions, a generic spinner where a layout-matched skeleton belongs, missing empty/error states, `window.alert()` used for errors, dead `#` links, no active-nav-link styling, missing `scroll-behavior: smooth` where the design implies it, missing loading state on an async action (disabled state must show while pending), a shadcn/ui or other headless component shipped with default props/no variant/size/class customization.

## 5. Motion audit (Emil Kowalski framework — apply this section rigorously)

Walk every animated element through:
1. **Frequency gate** — is this a 100+/day action (should have zero animation), a tens/day action (near-imperceptible only), an occasional action (standard), or a rare/first-time action (delight budget)? Flag any animation on a high-frequency or keyboard-triggered action.
2. **Purpose** — can you name it in one word (Feedback/Spatial consistency/State indication/Preventing jarring change/Explanation/Delight)? "Looks cool" is not a purpose — flag it.
3. **Properties** — is only `transform`/`opacity` (or `clip-path`) animating? Flag any animated `width`/`height`/`margin`/`padding`/`top`/`left` (except accordions). Flag `scale(0)` entrances (should start `scale(0.9-0.97)`+opacity 0). Flag CSS variables on a parent driving a child's transform (recalculates every child — set transform directly). Flag Framer Motion `x`/`y`/`scale` shorthand under load (should be full `transform:` string).
4. **Easing/duration** — flag `ease-in` on any UI element (should be `ease-out` entering/exiting, `ease-in-out` for on-screen movement, `ease` for hover/color, `linear` only for constant motion). Flag any UI animation over 300ms without marketing/explanatory justification.
5. **Origin/physicality** — flag `transform-origin: center` on a trigger-anchored popover/dropdown/menu/tooltip (should anchor at the trigger; modals are the sanctioned exception).
6. **Interruptibility** — flag CSS keyframes used on a rapidly-retriggered element (toasts, toggles) where a transition (which retargets from current value) is needed instead. Flag gesture-driven motion that can't be smoothly grabbed/reversed mid-flight.
7. **Reduced motion** — flag any animated element with no `@media (prefers-reduced-motion: reduce)` fallback, and any hover-only motion with no `@media (hover: hover) and (pointer: fine)` guard.
8. **Cohesion** — flag inconsistent easing/duration values across similar interactions (e.g. two different modals with different open transitions), and group entrances with no 30-80ms stagger.

**Never-ship list to check against directly**: `transition: all`; `scale(0)` entrance; `ease-in` on UI; animation on a keyboard shortcut or 100+/day action; unjustified >300ms UI animation; `transform-origin: center` on an anchored popover; keyframes on rapidly-triggered elements; animated layout properties; ungated hover motion; missing `prefers-reduced-motion`; simultaneous mass-entrance with no stagger.

**Remediation priority when fixing what you found**: 1) delete the animation if it has no purpose or fires on a high-frequency/keyboard action, 2) reduce it (shorter/smaller/fewer properties), 3) fix easing, 4) fix origin/physicality, 5) make it interruptible, 6) move it to GPU-only properties, 7) add asymmetric timing where appropriate, 8) polish (blur-mask, stagger, `@starting-style`, spring), 9) accessibility and cross-element cohesion last.

## 6. Content audit

Flag: "John Doe"/"Acme Corp"/"Nexus"/generic placeholder names, suspiciously round numbers (`99.99%`, `50%`) instead of organic data, Lorem Ipsum, Title Case headers (should be sentence case), exclamation marks in system/success/error messages, apologetic error copy ("Oops!" instead of a direct statement), any em-dash in shipped copy (zero-tolerance — replace with a hyphen), AI-cliché words ("Elevate", "Seamless", "Unleash", "Next-Gen", "Delve", "Revolutionize"), identical blog post dates, duplicate avatar images, meta-labels ("SECTION 01", fake version footers like `v1.4.2`/`Build 0048`, invented photo credits, decorative status dots with no real semantic state), unnecessary "Scroll to explore" cues.

## 7. Iconography & imagery audit

Flag: Lucide/Feather as the default icon set on brand-forward work, inconsistent stroke widths across icons, mixed icon families, rocketship-for-launch/shield-for-security cliché metaphors, missing favicon, hand-rolled fake dashboard/screenshot mockups built from divs, stock "diverse team" photography, plain-text wordmarks where a real SVG logo (Simple Icons/devicon) should be used, trust-logo walls placed inside the hero instead of beneath it.

## 8. Component maturity scoring

Score each shipped shadcn/ui (or similar headless-kit) component:
- **Level 0** — defaults only. Flag as a fail.
- **Level 1** — basic prop customization.
- **Level 2** — `className`/`ui` overrides plus variant/size props. Target minimum.
- **Level 3** — centralized design-system variants (e.g. `cva`-driven). Best practice.

Also flag: random spacing values off the Tailwind scale, inconsistent icon sizing, mixed color approaches (hex + Tailwind token + CSS var all in one file), incomplete dark-mode variants, a generic border+shadow+bg card stacked all three at once (should drop at least one), always-one-filled-one-ghost button pairing used as a reflexive default, pill "New"/"Beta" badges used without real justification, a 3-card testimonial carousel or 3-tower pricing table used reflexively rather than because it fits the content.

## 9. Code quality audit

Flag: div soup where semantic HTML (`<nav>`, `<main>`, `<button>`) belongs, mixed inline styles and classes, hardcoded pixel widths, missing or generic `alt` text, arbitrary z-index values (`z-[9999]`), dead commented-out code, imports that don't resolve against `package.json` (hallucinated packages), missing meta tags (title, description, OG tags).

## 10. Strategic omissions

Check for and flag if missing: legal/privacy links, back-navigation, a custom 404 page, client-side form validation, a skip-to-content link, cookie consent where legally required.

## 11. Performance audit (Vercel/React + edge)

Flag: sequential `await`s that could be `Promise.all()`'d, barrel-file imports pulling in unused code, a heavy component with no `next/dynamic` split, third-party scripts (analytics) blocking hydration instead of deferred, components defined inside other components, non-primitive default props recreated every render, `useEffect` doing what should be derived-during-render state, `&&` used for conditional rendering where a stray falsy value (`0`) could leak into the DOM, un-virtualized long lists (1000+ rows), heavy dependencies where a native alternative exists (moment/lodash/axios vs. native `Date`/array methods/`fetch`), sequential KV/network calls that should be parallelized, missing edge/Cache-API caching on cacheable responses.

## 12. Accessibility checks (run alongside every other section, not as an afterthought)

Focus-visible states present on all interactive elements, WCAG AA minimum body contrast (AAA target for hero copy), reduced-motion fallback on every non-trivial animation, reduced-transparency fallback raising opacity where `backdrop-filter`/blur is used, form inputs properly labeled, keyboard navigability of any custom component (dropdowns, modals, command palettes).

## 13. Fix priority order (use this to sequence your final recommendations)

1. Font swap 2. Color palette cleanup (kill purple/blue gradients, lock the accent) 3. Hover/active/focus states 4. Layout & spacing fixes 5. Replace generic/default components with customized ones 6. Loading/empty/error states 7. Motion audit fixes (per §5) 8. Typography scale polish 9. Content/copy pass 10. Performance pass 11. Accessibility pass.

Report the top issues in that order, not in the order you happened to notice them — a reviewer that leads with a font swap and buries a missing-focus-ring accessibility bug has the priority backwards.
