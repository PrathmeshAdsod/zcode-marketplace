# Zcode amber design QA

- Visual target: [selected yellow mockup](C:/Users/prath/.codex/generated_images/01a1cd1b-9b1e-7012-a683-d7108d76d598/exec-1703bd38-e8a1-4e68-b367-4df15dcee95f.png).
- Rendered implementation: [desktop](docs/evidence/amber-landing.png) and [mobile](docs/evidence/amber-mobile.png).
- Desktop comparison: 1487 × 1058 source pixels and 1487 × 1058 Chromium CSS pixels at device scale 1. Landing top, no cursor hover or scrolling. The local account switcher is visible only in the development session. Mobile was rendered at 390 × 844.

## Findings and fixes

- P2, resolved: In the first full-view comparison the display text was tracked tightly enough to make glyphs touch, and the hero pushed both action rows below the selected frame. Increased letter spacing, reduced the display weight to Geist 900 and tightened vertical padding. The second side-by-side comparison showed distinct glyphs, aligned hero boundaries and both action rows.
- P2, resolved: The narrow-screen footer ended above the viewport with an empty strip after it. The page shell now anchors the footer to the viewport bottom on shorter routes. The final mobile capture verified the fix.
- P3: Geist’s square punctuation differs from the mockup’s rounded display glyphs. The bold hierarchy, line breaks, headline and action copy match the selected design. A separate display font is unnecessary for this difference.

The matched viewport comparison covered text proportions, rule alignment, generous spacing, amber and parchment surfaces, graphite contrast, and plain typography without decorative images. The reference has no image assets to reproduce. Header navigation preserves functional account entry points, and authenticated buyers can find their library even if public admission is paused.

Checked the landing at 320, 390, 640, 641, 768, 900, 1024, 1280 and 1487 CSS pixels. Checked both landing actions, keyboard skip link, card comparison, sample release playback and download, the magnetic hover state, reduced motion, and the local administrator pause and recovery flow. Chromium reported no page errors in the focused landing check.

final result: passed
