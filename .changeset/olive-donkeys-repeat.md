---
"luojiahai-skills": patch
---

Cut the bookkeeping out of `preparing-tax-return`. A real run spent 46 file edits on 8 documents before it finished gathering them; most of that was the skill tracking the same state in four places.

**Steps 2 and 3 are now one step, and the rest renumber 3–8.** Marking the sections and gathering the documents always happened together — a user answering *what did you have income from* hands over the statement in the same breath — so the skill now says so, and the **Documents** table is a gap list rather than a worklist written up front.

**Where a document came from is no longer recorded.** The `Original name` column in the index and `Arrived as` in the worksheet held the same fact — that the file arrived from the user's Downloads folder — and nothing read either one. A paste, a path, a link and a photograph of paper all go the same way now.

**The `document`/`copy` distinction is gone.** It cost a column, two explainer paragraphs and a done-when clause to carry one consequence, which is now a single line: an entry whose figure has already been read keeps that figure; one with nothing read leaves the label at `TBC`.

**The worksheet's Bundle table is gone**, along with the joint one in `SHARED.md`. Every column was derivable from `ls bundle/` and the section indexes, it was hand-maintained on every document, and its summary drifted into restating the index.

**A section index records confirmed figures only.** Rows used to carry a *confirmed* / *awaiting confirmation* flag that needed a bulk update after each round — the run corrupted its own index doing exactly that. A row is now written when the user confirms it.

**Section indexes gain a `Working` section.** The run invented its own heading for the reconciliations that proved no dividend statement was missing and that a salary-sacrifice figure tied to the share plan — the most valuable thing it produced, with nowhere to live.

**`inbox/` is dropped**, and the worksheet template sheds the agent instructions it was shipping into the user's own file.
