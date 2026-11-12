# Verification evidence

The current demonstration uses [Column Desk](../JUDGING.md). The free Inspect and private Studio editions were independently verified in network-disabled Docker. See the [live Gemini evidence](column-desk-browser.json), [hosted Studio report](column-desk-studio.json), and [16-brief Finder evaluation](FINDER-EVALUATION.md). The following Acorn Trail and 12-brief results are historical.

## Public sample

Acorn Trail is an original MIT-licensed sample. Its ZIP SHA-256 is `87e194d0bdab68a3de22480e304720fd1683e19db78f337294bd23fb7da56105`. Docker unpacked and installed that archive with networking disabled, launched localhost and used keyboard input to finish the trail. The isolated test took 8.281 seconds. A separate Chrome session on the host installed a fresh extraction of the same bytes and finished the trail. Chrome downloaded the hosted ZIP and independently matched the same checksum.

The report records five observed capabilities and three untested capabilities. It covers this ZIP and the documented desktop workflow. See [sample observations](sample-run.json) and the [published report](https://zcode-marketplace.pages.dev/release/acorn-trail).

## Search evaluation

The 12 briefs were run against three catalog entries, including one runnable sample and two labeled example listings. Expected results were authored during development. Independent human grading remains pending.

| Metric | Keyword baseline | Hosted hybrid |
|---|---:|---:|
| Briefs with a qualifying release appearing in the top three | 5/5 | 5/5 |
| Correct abstentions when no release qualified | 7/7 | 7/7 |
| Unqualified releases labeled as full matches | 0/5 | 0/5 |
| Correct same-release evidence citations | 18/18 | 19/19 |
| Model parsing and semantic retrieval | 0/12 | 12/12 |

Workers AI Granite parsed the hosted briefs and BGE Small generated embeddings. The baseline and hybrid gave the same qualification outcomes in this small catalog. The extra citation is an additional observed link within this evaluation. These results do not establish ranking gains or marketplace-wide accuracy.

In Chrome, “Offline browser game under $60” moved Orbit Rooms into near matches because no offline observation exists, and Acorn Trail qualified with a direct link to its network-disabled run. This demonstrates how evidence changes the shortlist. It is not a buyer study.

See [individual briefs and outputs](brief-evaluation.json). With Wrangler running locally, rerun using `npm run evaluate -- https://zcode-marketplace.pages.dev`.

## Browser and integration checks

- [Hosted Chrome](browser-hosted.json) and [local Chrome](browser-local.json) record desktop and 390px layouts, keyboard entry, deep-link refresh, comparison, recordings, checksum and local role separation.
- `npm test` exercises real API handlers with local D1/R2 and GitHub/PayPal doubles. Cases include competing for the fifth seller slot, missing or duplicate video, pinning, reviewer separation, lost capture response, callback recovery, duplicate events, private delivery retry, cross-buyer and expired link denial, rights hold and lift, cancellation, and full refund revocation.
- The [24.6-second preview recording](zcode-preview.mp4) shows the actual hosted sample journey. The product and setup videos are separate files on the release page. A real PayPal order, capture, refund, private GitHub commit and hosted private R2 delivery need their owner-configured provider environment before recording the final judging video.

