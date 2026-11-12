# Zcode

**License software with evidence for the exact source release.**

## The buyer's problem

A buyer has a weekly vendor CSV with duplicate order IDs and malformed totals. They need to check it offline, reuse the rules next week, and pay once. A marketplace listing can say “CSV tool,” while leaving all those questions unanswered.

## What Zcode does

Zcode turns the buyer's words into an editable checklist. Every hard requirement is evaluated against the evidence for the exact release. With Column Desk, two original editions illustrate why this matters. Inspect checks structure and exports a report. Studio adds reusable validation rules and reports duplicate IDs, invalid totals and missing values. The code runs on the buyer's device. Each claim shown as verified has a finding tied to the ZIP's checksum.

## How we used AI

Zcode calls Gemini 3.5 Flash-Lite through the official Google GenAI SDK. It extracts the buyer's priorities, budget and requirements and shows the exact phrases they came from. A deterministic matcher reads release reports and controls what qualifies. The model sees the buyer's submitted text and has no authority over verification or payments.

The original 12-brief run produced identical qualification outcomes with and without AI. In a new 16-brief development evaluation, the live Gemini path extracted the exact requirements on 15 briefs. The new keyword rules did so on nine. Both put a qualifying release first on seven of seven positive briefs. Gemini made one erroneous assumption about an unspecified currency. We kept the failed case in the results and added a check that asks the buyer to clarify. [Evaluation data](docs/evidence/FINDER-EVALUATION.md)

## How we used PayPal and Codex

Zcode sends the buyer to the real PayPal Sandbox approval page through Orders v2, confirms the resulting capture server-side and grants a private download for the accepted license and ZIP. Signed events support reconciliation. We observed a real simulated $1.00 capture, buyer-bound delivery, clean installation and full refund in a separate Acorn Trail rehearsal. The hosted application verified the capture and refund webhooks from that rehearsal.

Codex built the Cloudflare application, structured Finder, isolated verifier, original Column Desk releases and browser tests. The hosted verifier fetched the pinned Studio commit from a private GitHub repository, ran its workflow in network-disabled Docker and stored the exact ZIP in private R2. Studio currently awaits independent approval before a hosted checkout can run.

## Links

- [Hosted application](https://zcode-marketplace.pages.dev/)
- [Public MIT-licensed repository](https://github.com/PrathmeshAdsod/zcode-marketplace)
- [Judge walkthrough](docs/JUDGING.md)
- [54-second demo](docs/evidence/zcode-column-desk-demo.mp4)
- [Column Desk product and clean install recordings](docs/JUDGING.md#studio-and-checkout)

The public YouTube submission link and final hosted Studio purchase are pending. The draft describes only evidence already collected. [Official rules](https://paypalaihackathon.devpost.com/rules)
