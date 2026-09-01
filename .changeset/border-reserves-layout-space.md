---
'@bomb.sh/tty': minor
---

Changes `border` sides to reserve layout space instead of drawing as an overlay. Each border width is now added to the padding on its side, so content and children are laid out inside the border rather than collapsing behind the border glyphs.

This is a breaking change for callers who compensated for the old behavior by setting `layout.padding` equal to the border width — that padding is now additive and double-counts. Remove the workaround:

```diff
  {
    border: { color, left: 1, right: 1, top: 1, bottom: 1 },
-   layout: { padding: { left: 1, right: 1, top: 1, bottom: 1 } },
  }
```

A `border` of 1 with no padding now reserves one cell per bordered side; `border` of 1 plus `padding` of 1 reserves two, measured inward from the border edge.
