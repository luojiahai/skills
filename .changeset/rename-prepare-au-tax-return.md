---
"luojiahai-skills": patch
---

Rename `lodge-au-tax-return` to **`prepare-au-tax-return`**. A skill's name is a promise about what it does, and this one named the single action the skill categorically refuses to perform: it lodges nothing and never touches your ATO account. It prepares; you lodge. The name now says so.

**The command changes.** `/lodge-au-tax-return` becomes `/prepare-au-tax-return`. Plugin users need do nothing — the update carries the new name, and the old one stops resolving. If you installed with skills.sh, your existing copy stays where it is; re-add to pick the skill up under its new name.

Nothing else about the skill changes — the interview, the nexus/apportionment/substantiation reasoning, the worksheet and the not-tax-advice declaration are all as they were.

The README's migration note about the old per-skill plugin (`lodge-au-tax-return@luojiahai`) is removed; that record lives in the v0.1.1 entry below.
