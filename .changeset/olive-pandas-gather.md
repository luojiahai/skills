---
"luojiahai-skills": minor
---

`preparing-tax-return` now gathers your documents instead of asking you to read them out.

Until now the skill told you to download your prefill report and statements and then said nothing about how their contents were supposed to reach it — so every run improvised. There is now a step for it.

**What it does.** You say where your records live — a folder, an app, email, or scattered — and it reads what is inside the places you name and nothing outside them. It copies each document into a **bundle** beside the worksheet, filed by what the document feeds (`bundle/income/`, `bundle/deductions/`, `bundle/rental/`), renamed so the folder is readable in five years, and indexed. Figures that land on a myTax label are read back to you field by field before they are written down; a pile of receipts is read back as a count and a total. Anything it cannot read, it asks you for — and anything it cannot open goes in the Outstanding register with the label reading `TBC`, so a guessed number cannot reach myTax.

**Where a return now lives.** One folder per income year, one folder per person inside it:

```
tax-2026/
  sam/worksheet.md · inbox/ · bundle/
  alex/worksheet.md · inbox/ · bundle/      a couple lodges two returns
  joint/shared.md · bundle/                 the figures both returns share
```

`tax-*/` is added to `.gitignore` when you are in a git working tree, because the folder now holds copies of your income statement and bank statements rather than one markdown file. Identity numbers stay on the documents that carry them and are never written into the worksheet.

**Couples.** Combined income, family income for the surcharge and rebate tier, and every joint ownership split are worked once in `joint/shared.md`, and each return copies its share from there. It also carries a readiness gate: neither return is handed over until both taxable incomes are settled and both registers are empty, which stops one spouse lodging on the other's estimated income.

Also: `figure` and `rate` are now distinct words — "every **rate** comes from the ATO on this run" was never about the amounts on your statements.
