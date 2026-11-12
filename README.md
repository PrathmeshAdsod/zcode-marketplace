# Zcode

Zcode is a marketplace for licensing complete software releases from private GitHub repositories. A buyer can turn a brief into requirements, inspect the evidence for each requirement, compare releases, and use PayPal Sandbox to license a specific archive when the team merchant is configured.

**Try [Zcode](https://zcode-marketplace.pages.dev/).** The lead release is Column Desk, an original tool for checking vendor CSVs before import. The free Inspect edition can open your file and export structural findings. The Studio edition adds reusable column rules and validation. See the [judge walkthrough](docs/JUDGING.md) for the current release and payment status.

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

1. Open [Software Finder](https://zcode-marketplace.pages.dev/browse). Ask for a tool that catches duplicate order IDs and wrong totals without a network, remembers the rules for next week's CSV and costs under $20 upfront.
2. Choose **Interpret with Gemini**, review the quoted requirements and select **Find matching releases**. Open the evidence for the free [Column Desk Inspect release](https://zcode-marketplace.pages.dev/release/column-desk-inspect) to see where structural inspection stops and rule validation begins.
3. Open the Inspect demo and choose your own UTF-8 CSV or use the synthetic example. To run the source release, download the ZIP, verify its SHA-256, extract it, run `npm ci --offline` and `npm start`, then open [port 4173](http://127.0.0.1:4173/).
4. To repeat the isolated verifier, install Docker and Python 3.11+, then run:

```sh
docker build -t zcode-runner:2 runner
python runner/verify.py --image zcode-runner:2 sample --adapter node-browser-csv-inspect/1 --source samples/column-desk --output .local/column-desk-release/inspect
node scripts/record-column-desk.mjs inspect
node scripts/update-column-desk-catalog.mjs
```

The last two commands require Chrome and FFmpeg. The verifier and clean buyer install emit a checked report and digest before the storefront sample is updated.

## How the system works

- **Discovery:** Gemini 3.5 Flash-Lite extracts an editable brief through the official Google GenAI SDK. Zcode ranks approved metadata using lexical relevance and release evidence. The buyer confirms requirements before matching. The model receives only the submitted brief and has no payment, publication or artifact authority.
- **Admission:** A selected-repository GitHub App connects a personal seller's private repo. Submissions freeze one commit, claim a seller slot and queue a verification job in a D1 transaction. An independent reviewer reviews both recordings and the run before publishing.
- **Verification:** The operator authorizes one repository ID and selects a trusted adapter per runner invocation. The controller packages the pinned GitHub source, scans paths and content, then runs a non-root Docker job with networking disabled. The exact ZIP tested by that job is the one released to the buyer. Current adapters cover the documented CSV workflows and the Acorn Trail browser game.
- **Commerce:** Orders v2 sends the buyer to PayPal's hosted Sandbox approval page. Server-side Orders v2 and Payments v2 check the merchant, order and amount against the accepted license and release digest. A completed capture creates one entitlement. Downloads use single-use tickets bound to the buyer, and a verified full refund or reversal closes future downloads.
- **Storage:** Private R2 streams the archive only after checking the authenticated buyer and the entitlement again. Download links expire after three minutes. Public sample files are separate from licensed private source.

See [deployment and operator setup](docs/OPERATIONS.md), the [Devpost draft](devpost-submission.md), and [observed evidence](docs/evidence/). Marketplace source and the original sample are [MIT licensed](LICENSE). Third-party seller releases keep their separate license and notices.

The [cost-control runbook](docs/COST-CONTROLS.md) documents thresholds, protected checkout reconciliation and the administrator usage dashboard.
