# Zcode

**A marketplace for source licenses with evidence that the exact release can run.**

## The problem

A freelancer finds a game that looks ready for a client project. The preview plays, but it says little about whether the delivered source runs locally, whether it needs a paid API, or whether the seller grants the right to ship the result. Those questions often surface after purchase.

## What Zcode does

Ask what you need in plain English. Zcode turns the brief into editable requirements and shows which releases meet them. Every checked capability links to an observation for that release. If the evidence is missing, the capability stays unconfirmed.

For an eligible release, checkout binds the accepted license, merchant, price and ZIP checksum. The sandbox payment must be confirmed before the buyer gets a private download. The buyer can compare the archive checksum against the Repo Passport and install the exact ZIP the runner installed.

## How we used AI

Gemini 3.5 Flash-Lite, called through the official Google GenAI SDK, interprets the buyer's words as editable constraints. The buyer sees verbatim source wording and approves the brief before ranking. Deterministic filters and findings bound to an exact ZIP decide whether a release qualifies. The model receives only the submitted brief. The earlier 12-brief evaluation found identical qualification results with keyword search and the earlier AI implementation. The new evaluation measures extraction and qualification separately against fixed reference labels.

## How we used PayPal

PayPal Orders v2 creates the order and sends the buyer to PayPal's hosted Sandbox approval page. Payments v2 verifies capture and refunds, and signed webhooks support reconciliation. A D1 transaction binds an approved capture to one entitlement. In an isolated rehearsal, a separate test buyer completed a simulated $1.00 purchase, downloaded the verified ZIP, installed it again, and received a full refund. The hosted webhook accepted the signed capture and refund events.

## How we used Codex

Codex turned the RepoProof design handoff into the Zcode workspace, built the Cloudflare app and Docker verifier, created the playable Acorn Trail sample, and checked the flow in Chrome. It exercised the database and private download path with fixtures, then reproduced the public sample install from the same archive in a clean folder.

## Try it

1. Open [Zcode on Cloudflare Pages](https://zcode-marketplace.pages.dev/).
2. Try the [offline game brief](https://zcode-marketplace.pages.dev/browse?q=Offline+browser+game+under+%2460). Choose **Interpret with Gemini**, review the requirements, then select **Find matching releases**. Acorn Trail has an offline observation. Orbit Rooms is a labeled example with unconfirmed behavior.
3. Follow the evidence link, watch the two recordings and download Acorn Trail. The ZIP's SHA-256 is shown in the release detail.
4. Extract the ZIP, run `npm ci --offline` and `npm start`, and play the trail at [localhost:4173](http://127.0.0.1:4173/). No credentials are needed for this public sample.
5. See the [judge walkthrough](docs/JUDGING.md) for the credential-free sample and the status of the hosted Sandbox path.

## Demo video and links

- **Working preview:** [zcode-marketplace.pages.dev](https://zcode-marketplace.pages.dev/).
- **Public source URL:** `https://github.com/PrathmeshAdsod/zcode-marketplace` is the intended repository. Verify publication before entering it.
- **Public YouTube URL:** Pending. The recorded demo shows the deployed Finder, comparison and public sample delivery. The PayPal proof was recorded separately in the rehearsal results.
- **Screenshots:** Storefront, buyer brief with full and near matches, and Repo Passport in `docs/evidence/`.

## Submission readiness

The hosted GitHub App verified the pinned private fixture and stored the verified ZIP in private R2. A fresh anonymous browser verified live Gemini, checked comparison and the evidence link, and downloaded the matching public sample. The successful Sandbox payment and private download used an isolated rehearsal. The remaining end-to-end hosted transaction requires the fixture's independent GitHub review and a separate buyer.

**Suggested walkthrough:** 0:00 state the buyer's question. 0:15 run the brief and open the cited observation. 0:45 show the release, license and install recording. 1:15 show real Sandbox approval and a verified receipt. 1:50 compare the downloaded hash and run from a clean folder. 2:35 show the completed game.

**Owner fields:** Confirm country, organization, whether the project is new, eligibility and team declarations. Select the PayPal experience rating, contact preference, learning level and career-value response. Use the final integration results to complete the main technology field. No additional listed sponsor tool was used in this build. The deadline is **November 13 at 01:30 IST**, equivalent to November 12 at noon PST. Review the rules and release freeze before submitting. [Official rules](https://paypalaihackathon.devpost.com/rules) · [Official dates](https://paypalaihackathon.devpost.com/details/dates)
