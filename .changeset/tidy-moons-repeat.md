---
"luojiahai-skills": patch
---

Simplify `preparing-tax-return`: cut duplicated instructions, and move the routes that are not a normal return into a new `process/lodging.md`.

The skill said several things twice. The curl fetch technique was written out in full in both `SKILL.md` and `process/rates.md`; `rates.md` is now the only copy. Two places prescribed the statement the agent makes at step 1, and they disagreed on its length — that is now settled once, in step 1. A block of five "properties" restated five rules that each already had a home, and the *Timing* section restated the prefill calendar and the five-year records rule already carried by steps 1, 4 and 9.

Non-lodgment advice, amendments, objections, and how to apply for a private ruling only matter on runs that are not a normal return, so they now live in `process/lodging.md` and are reached from step 9. The `myTax lodges an individual return` scope gate moved from the preamble into step 2, where it is applied. No rule was dropped.
