# Judge walkthrough

Open [Zcode Software Finder](https://zcode-marketplace.pages.dev/browse) in a fresh browser. The Finder, comparison, report and public sample work without sign-in.

1. Search for “I need a game that opens in a browser. The classroom network may be down for the entire lesson once it is installed. Arrow keys would be nice. I can spend up to $60 once, and a recurring API bill is a deal breaker.”
2. Select **Interpret with Gemini**. Check that offline use and the recurring API restriction are required, while arrow keys are a preference. Each row shows the original wording. Change a priority or the USD budget, then select **Find matching releases**.
3. Add Acorn Trail and Orbit Rooms to comparison. Acorn Trail passed an offline run. Orbit Rooms is a labeled example and has no independent offline observation. Select **View finding** for offline operation and check that the exact release's Repo Passport opens.
4. Download the free sample ZIP. Its SHA-256 is `87e194d0bdab68a3de22480e304720fd1683e19db78f337294bd23fb7da56105`. Extract it, run `npm ci --offline` and `npm start` from the extracted folder, and open [localhost port 4173](http://127.0.0.1:4173/). Press Enter and use Arrow Right to finish the trail.

The hosted seller submitted the Acorn Trail fixture from an authorized private GitHub repository. Its pinned commit passed the isolated verifier and its ZIP is stored in private R2. The public sample is the same verified ZIP and is free to inspect.

The isolated PayPal rehearsal exercised a real simulated $1.00 purchase, verified capture, buyer-bound ZIP delivery, a fresh install and a refund. The hosted webhook verified signed events from that rehearsal. The hosted fixture still awaits editorial approval from a separate GitHub reviewer. Once published, a buyer signs in with a distinct GitHub account, accepts the displayed release license and approves the order using a PayPal Sandbox Personal account. An international Sandbox buyer is needed for the current India test merchant. Use a Sandbox account, with no real payment method or shared developer key. [Payment evidence](SANDBOX-REHEARSAL.md)

Gemini requests use a dedicated free project with conservative app caps. An exhausted quota falls back to keyword rules, labeled in the Finder. A repeated brief may return a saved Gemini interpretation. [Cost controls](COST-CONTROLS.md)
