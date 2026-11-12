# Finder evaluation

The first 12 briefs produced identical qualification outcomes for the original keyword and AI paths. Both returned a qualifying release in the top three on 5 of 5 positive briefs and correctly abstained on 7 of 7 negative briefs. The original results remain in [the 12-brief report](README.md).

Before replacing the hosted Finder, we wrote 16 reference briefs about ambiguous budgets, paraphrased requirements, negations, soft preferences, specific stacks and operating costs. The same three-entry catalog and reference answers were used for all three runs. These are development-authored labels and are awaiting independent human review. The two illustrative entries in that historical cohort were removed from the hosted catalog after this evaluation.

| Measure | Previous hosted AI | New keyword rules | Live Gemini Finder |
| --- | ---: | ---: | ---: |
| Exact requirements, priority, budget and clarification | 1/16 | 9/16 | 15/16 |
| Exact qualifying release set | 5/16 | 14/16 | 15/16 |
| False qualifications | 7 | 1 | 1 |
| Qualifying release among the top three | 7/7 | 7/7 | 7/7 |
| Evidence citations resolving to the matching release and capability | 24/24 | 16/16 | 22/22 |

The new keyword and live Gemini paths also returned a qualifying release first for all seven positive briefs. The measured Gemini contribution on this set was **six more correctly interpreted briefs** than the new keyword path. For example, Gemini recognized playing in airplane mode, resuming after a tab closes, and playing simultaneously on separate computers. Ranking improvement was not demonstrated.

Gemini incorrectly inferred USD and a one-time cost from “a budget of 50.” Zcode qualified a release instead of asking a question. The production code now treats an unqualified bare budget as an ambiguity and has a regression test. The table preserves the original observed error. On an earlier run, 11 live calls and five keyword fallbacks produced 7/16 exact interpretations and three false qualifications. Another attempt hit the anonymous request throttle, so the final run resumed its successful cases and paced the remaining live calls. These development runs use a small, familiar catalog and provide no measure of real buyer conversion or performance on unseen briefs.

Read [the briefs and reference labels](finder-briefs.json), [previous results](finder-legacy-results.json), [keyword results](finder-keyword-results.json), [live Gemini results](finder-finder-results.json), [the first pass](finder-first-pass-results.json), and [the throttled attempt](finder-throttled-results.json).
