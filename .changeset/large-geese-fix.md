---
"@bomb.sh/tty": patch
---

Fixes how elements at fractional positions map to cells. An element now draws on, and receives the pointer for, exactly the cells whose centers its bounding box covers. Elements sliding in past the top edge no longer pile onto row 0, and two elements that meet halfway through a cell no longer both receive the pointer there.
