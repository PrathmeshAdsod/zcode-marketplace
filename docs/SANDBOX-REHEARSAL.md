# Sandbox rehearsal, November 12, 2026

The test used the dedicated Zcode PayPal Sandbox merchant app and simulated funds. Live PayPal payments were not enabled. No Cloudflare plan upgrade or new paid service was used.

| Boundary | Observed result |
| --- | --- |
| Hosted seller and source verification | GitHub OAuth signed in the seller. The app was installed with read-only Contents and Metadata on only the private Acorn Trail fixture. Studio pinned the commit and queued verification. The runner fetched it through the deployed API, completed offline install and gameplay, and stored the final ZIP in private R2. The hosted release is in editorial review. |
| Independent local review and purchase | A loopback rehearsal ran the same Zcode application with isolated D1/R2 and separate synthetic reviewer and buyer identities. The reviewer checked both recordings and published the matching fixture locally. The buyer approved a simulated USD 1.00 order on the real PayPal Sandbox page. Zcode verified canonical capture and issued one entitlement. No synthetic login is present in the hosted app. |
| Download and clean installation | The buyer's browser download and a new ticket returned the same SHA-256 as the hosted verified ZIP: `87e194d0bdab68a3de22480e304720fd1683e19db78f337294bd23fb7da56105`. The downloaded archive passed a new offline install and gameplay run. Another buyer's receipt and download requests returned 404, as did replay of a used ticket. |
| Refund and signed events | An operator completed a full Sandbox refund against a receipt-linked support case. Canonical readback changed the receipt to refunded; both an outstanding download ticket and a request for a new ticket returned 404. PayPal delivered signed capture and refund events to the hosted webhook. Both were verified and recorded, with no hosted entitlement issued because the order lived in the isolated rehearsal. |

The default India Sandbox buyer was rejected before capture. Zcode kept the purchase unpaid and allowed cancellation. A new U.S. Sandbox Personal account successfully exercised the international USD path with the same India Sandbox merchant. [PayPal documents that India accounts cannot receive domestic payments](https://www.paypal.com/in/cshelp/article/can-i-use-paypal-to-receive-payments-from-indian-customers-help1049).

The remaining hosted acceptance test requires a separate GitHub reviewer to publish the fixture and another GitHub account to buy it. The successful Sandbox capture and refund described above ran against the loopback rehearsal, while hosted source ingestion, storage and signed event handling were verified separately. The test does not establish eligibility for Live PayPal, arbitrary seller payouts, or a provider spending cap.
