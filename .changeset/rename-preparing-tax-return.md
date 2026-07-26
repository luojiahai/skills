---
"luojiahai-skills": patch
---

Rename `prepare-au-tax-return` to **`preparing-tax-return`**. The previous rename fixed the verb but kept the shape: a bare command. Skills are named for the activity they are, so this one is a gerund. Its name has now changed twice in two releases, and it will not change again — the convention is written down in the repo rather than carried in someone's head, which is what caused the churn.

**The command changes.** `/prepare-au-tax-return` becomes `/preparing-tax-return`. Plugin users need do nothing — the update carries the new name, and the old one stops resolving. If you installed with skills.sh, your existing copy stays where it is; re-add to pick the skill up under its new name. Anyone still on v0.1.1 is coming from `/lodge-au-tax-return` and lands in the same place.

**The name no longer says Australia; everything around it does.** Jurisdiction now lives in the description rather than the name, so it reads "Australia only" wherever the skill is listed, the README callout leads with it, and the skill says it out loud in its opening statement on every run. This is still the Australian individual return through the ATO's myTax, and nothing in it transfers to another country's return.

Nothing else about the skill changes — the interview, the nexus/apportionment/substantiation reasoning, the worksheet and the not-tax-advice declaration are all as they were.
