# Free-tier protection

Zcode’s default is zero additional paid cloud or AI usage without explicit owner approval. The service reserves capacity before starting new AI calls, verification jobs, archive writes and purchase attempts. Daily counters use UTC. Monthly R2 operation budgets use a conservative rolling 31-day window. Retained archive bytes have no automatic reset.

| Meter | Provider free allowance | Zcode allocation | New-work cutoff |
|---|---:|---:|---:|
| Workers API requests | 100,000/day | 20,000/day | 16,000/day |
| D1 rows read | 5,000,000/day | 2,000,000/day | 1,600,000/day |
| D1 rows written | 100,000/day | 35,000/day | 28,000/day |
| R2 Standard storage | 10 GB-month/month | 1 GB retained/reserved | 800 MB |
| R2 Class A | 1,000,000/month | 12,000/31 days | 9,600/31 days |
| R2 Class B | 10,000,000/month | 120,000/31 days | 96,000/31 days |
| Gemini 3.5 Flash-Lite | 15 requests/minute, 250,000 input tokens/minute, 500 requests/day in the dedicated free project | Shared with the app limits below | 12/minute, 200,000 input tokens/minute, 400/day (Pacific time) |
| AI calls / input / output | App limits | 250 calls / 400,000 estimated input tokens / 60,000 output tokens per day | 200 / 320,000 / 48,000 |
| Local verification | App limits | 20 jobs / 1,200 seconds per day | 16 jobs / 960 seconds |

D1 counters collect statement metadata and add an overhead estimate for accounting queries. Request counts represent admitted application work and eligible protected requests. Provider analytics also include traffic rejected before an application handler can admit it. Workers Free enforces 100,000 requests per UTC day and 10 ms CPU per invocation. D1 Free has 5 GB total storage and fails new queries when daily row limits are exhausted.

Gemini input reservations use UTF-8 byte length plus framing, with a 1,152-token completion limit and one in-flight call. Reservations count against the current window if a call fails or times out. The dashboard shows provider-reported input and output tokens separately from reservations. The dedicated Google project has billing disabled. Keyword and evidence search continue when inference capacity is exhausted. Verification leases allow one active job, reserve 60 seconds per execution and cap each archive at 8 MiB. The worker kills container execution after 60 seconds.

R2 Standard has free egress, but Cloudflare rounds billed units and charges for operations or stored volume above the included allowance. The bucket `zcode-marketplace-private` is Standard and starts empty with its public URL disabled. Zcode reserves bytes before writing, including uploads with ambiguous outcomes. The app checks the existence and digest of the release before creating or sending a new charge. Existing owned downloads use the remaining 20% Class B reserve. If that reserve runs out or storage is unavailable, the buyer can retry when it recovers. Receipts and entitlements remain intact. PayPal readback, webhook settlement, refunds and reconciliation bypass application admission pauses. They remain subject to actual provider availability.

The thresholds are application controls, not a guaranteed provider spending cap. They cover this Zcode deployment and its dedicated bucket. Account-wide usage by other apps, direct bucket access, concurrent infrastructure changes, platform quotas and invoice rounding are outside these counters. Monitor Cloudflare’s billing and usage dashboards alongside Zcode’s usage dashboard. Cloudflare budget alerts report usage but do not stop requests. Keep the account on Workers Free unless the owner explicitly approves a plan change.

## Administrator workflow

Open `/admin/usage`. Set `COST_ADMIN_GITHUB_IDS` to the authorized GitHub numeric account IDs in Pages configuration. Use GitHub sign-in after the marketplace App is configured. For local development, select **Sample administrator**. Reviewer privileges alone do not give access to usage controls.

- View usage, thresholds, recent alerts, active verification leases and paused operations. The dashboard refreshes once a minute while visible.
- Pause AI, verification or checkout with an audit reason. Clearing a manual pause does not override an automatic threshold.
- At a threshold, the dashboard records a durable alert and shows a count in the administrator’s navigation. No external notification provider is configured.
- Check unused storage reservations. The recovery action verifies old, unreferenced reservations with an authenticated R2 HEAD before releasing capacity, ten at a time. It removes accounting entries only when no object exists. It never deletes a customer object, release, entitlement, receipt or transaction record.
- For daily or rolling quotas, wait for recovery and recheck provider usage. Preserve settlement jobs while capacity is paused. Existing purchases can reconcile after service recovers.

## Official references checked November 12, 2026

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)
- [R2 pricing and billing units](https://developers.cloudflare.com/r2/pricing/) and [R2 analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/)
- [Gemini pricing](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite), [rate limits](https://aistudio.google.com/docs/rate-limits), and [data terms](https://aistudio.google.com/docs/terms#data-use-unpaid)
- [Cloudflare billing and budget alerts](https://developers.cloudflare.com/billing/understand/how-billing-works/)
