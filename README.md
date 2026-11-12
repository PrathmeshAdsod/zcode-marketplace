# Zcode

Zcode is a marketplace for licensing complete software releases from private GitHub repositories. A buyer can turn a brief into requirements, inspect the evidence for each requirement, compare releases, and use PayPal Sandbox to license a specific archive when the team merchant is configured.

**Try the [Cloudflare Pages application](https://zcode-marketplace.pages.dev/).** Acorn Trail is a free, MIT-licensed browser game with a playable build, product and setup recordings, an independent Docker report and the exact tested archive. See the [judge walkthrough](docs/JUDGING.md) for live Gemini and the scope of the Sandbox payment evidence.

## Run locally

Use Node.js 24 or newer and npm. Run these commands from the repository root.

```sh
npm ci
npm run db:local
npm run dev
```

Open [http://127.0.0.1:8788](http://127.0.0.1:8788/). Wrangler runs Pages Functions, D1 and private R2 emulation. The Account menu has separate local seller, buyer and reviewer fixtures. Sample accounts cannot place PayPal orders.

Keyword rules and release matching run locally without external credentials. To enable Gemini locally, copy `.dev.vars.example` to `.dev.vars` and supply a Gemini-only key and the actual limits of a dedicated, verified free-tier project. The key stays in the Pages Functions environment.

```sh
npm run typecheck
npm test
npm run build
node scripts/browser-check.mjs
```

The integration suite uses D1 and R2 emulators with controlled GitHub and PayPal doubles. It tests real app routes and database constraints. It does not contact payment or source providers.

## Walk through the sample

1. Open the [offline game brief](https://zcode-marketplace.pages.dev/browse?q=Offline+browser+game+under+%2460). Choose **Interpret with Gemini**, check the requirement wording, and select **Find matching releases**. Acorn Trail qualifies. Orbit Rooms is an example with no independent offline observation.
2. Open an Evidence link, then the [Acorn Trail release](https://zcode-marketplace.pages.dev/release/acorn-trail). Compare the product and install recordings, tested environment and exact digest.
3. Download the ZIP. Compute SHA-256 and compare it to the release page. Extract into a fresh folder, run `npm ci --offline` and `npm start`, then open [http://127.0.0.1:4173](http://127.0.0.1:4173/). Press Enter and hold Arrow Right until all three acorns reach camp.
4. To repeat the isolated verifier, install Docker and Python 3.11+, then run:

```sh
docker build -t zcode-runner:1 runner
python runner/verify.py sample
node scripts/sample-media.mjs
node scripts/update-sample-catalog.mjs
```

The last two commands require Chrome and FFmpeg. The verifier and clean buyer install emit a checked report and digest before the storefront sample is updated.

## How the system works

- **Discovery:** Gemini 3.5 Flash-Lite extracts an editable brief through the official Google GenAI SDK. Zcode ranks approved metadata using lexical relevance and release evidence. The buyer confirms requirements before matching. The model receives only the submitted brief and has no payment, publication or artifact authority.
- **Admission:** A selected-repository GitHub App connects a personal seller's private repo. Submissions freeze one commit, claim a seller slot and queue a verification job in a D1 transaction. An independent reviewer reviews both recordings and the run before publishing.
- **Verification:** The operator authorizes one repository ID per runner invocation. The controller packages the pinned GitHub source, scans paths and content, then runs a separate non-root Docker job with networking disabled. The buyer receives the exact ZIP tested by that job. This adapter supports a documented Node browser-game workflow and an offline dependency install.
- **Commerce:** Orders v2 sends the buyer to PayPal's hosted Sandbox approval page. Server-side Orders v2 and Payments v2 check the merchant, order and amount against the accepted license and release digest. A completed capture creates one entitlement. Downloads use single-use tickets bound to the buyer, and a verified full refund or reversal closes future downloads.
- **Storage:** Private R2 streams the archive only after checking the authenticated buyer and the entitlement again. Download links expire after three minutes. Public sample files are separate from licensed private source.

See [deployment and operator setup](docs/OPERATIONS.md), the [Devpost draft](devpost-submission.md), and [observed evidence](docs/evidence/). Marketplace source and the original sample are [MIT licensed](LICENSE). Third-party seller releases keep their separate license and notices.

The [cost-control runbook](docs/COST-CONTROLS.md) documents thresholds, protected checkout reconciliation and the administrator usage dashboard.
