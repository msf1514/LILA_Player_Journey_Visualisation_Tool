---
name: design-md-library
description: Reference library of 74 real-world DESIGN.md files reverse-engineered from shipped brands and products — Apple, Nike, Stripe, Shopify, Tesla, Linear, Vercel, Figma, Notion, Ferrari, PlayStation, Wired and more. Each entry documents that brand's actual colour system, typography, spacing, motion and component language. Use when you need a concrete, non-generic design direction to anchor a build; when a client brief says "make it feel like X"; when writing a DESIGN.md or design-token file for a new project; or when you want a worked example of how a mature design system is documented. Lookup and reference only — it does not itself write code.
license: MIT
metadata:
  source: https://github.com/voltagent/awesome-design-md
  packaged-by: wrapper authored for Claude skill loading; upstream repo ships no SKILL.md
---

# DESIGN.md Library

74 brand design systems, each as a `DESIGN.md` under `design-md/<brand>/`, with a
`README.md` alongside giving provenance and notes.

## How to use

1. **Pick the closest reference.** Match on category and feel, not logo. A jewellery
   PDP is closer to `apple` or `superhuman` than to `nike`.
2. **Read the whole DESIGN.md before borrowing anything.** These files are internally
   consistent; lifting one token (a colour, a radius) out of its type scale and spacing
   system produces something worse than either system alone.
3. **Adapt, never transplant.** Use the *structure* of the reasoning — how the brand
   resolves hierarchy, restraint, and motion — then re-derive values against the actual
   brand's tokens.
4. **As a template.** When authoring a new `DESIGN.md`, copy the section structure from
   a comparable entry rather than inventing headings.

## Selecting a reference

- **Premium / restrained retail** — apple, nike, starbucks, superhuman
- **Developer & infra** — vercel, supabase, linear.app, stripe, clickhouse, mongodb, hashicorp, sentry, posthog, raycast, warp, opencode.ai
- **AI & model products** — claude, cohere, mistral.ai, elevenlabs, together.ai, x.ai, minimax, replicate, ollama, runwayml
- **Fintech** — stripe, revolut, wise, coinbase, kraken, binance, mastercard
- **Automotive** — bmw, bmw-m, tesla, ferrari, lamborghini, bugatti, renault, spacex
- **Marketplace & consumer** — airbnb, uber, pinterest, spotify, shopify, webflow
- **Editorial & media** — theverge, wired, nintendo-2001, playstation, dell-1996
- **Productivity & collaboration** — notion, figma, framer, miro, slack, airtable, cal, linear.app
- **Enterprise legacy** — ibm, hp, meta, nvidia, dell-1996, vodafone

Full index in `design-md/`. Two entries (`dell-1996`, `nintendo-2001`) are period pieces —
useful for deliberately retro direction, misleading as a modern default.

## Caution

These describe brands the packager does not own. Treat them as study material for
*how* good systems are reasoned about. Reproducing a brand's identity for a different
commercial product is a trademark problem, not a design one.
