# Filing the bundle

Where a copy lands, what it is called, and what its index records. Step 3 reaches the documents and reads them back; this file is what happens to each one afterwards.

## Filing

A document is filed by **what it feeds**, so a label traces to its evidence in one hop. Folders sit under `bundle/` and each is created only when it holds something — an empty folder claims a section the return does not have.

| Folder | Holds |
|---|---|
| `income/` | the prefill report, income statements, bank interest, dividend and distribution statements, super and annuity statements, foreign income |
| `rental/` | the property manager's annual statement, and the pile of rates, water, insurance, repair and agent invoices |
| `business/` | sole trader and partnership records — invoices issued, expense receipts, the ABN's own statements |
| `capital-gains/` | contracts, broker and exchange reports, cost base records for each parcel |
| `deductions/` | work-related receipts, logbooks, diaries, donation receipts, last year's tax agent invoice |
| `offsets/` | the private health statement, a Medicare entitlement statement, anything an offset rests on |
| `residency/` | passport travel history, visa dates, employment contracts, foreign assessments |
| `other/` | anything the list above cannot place — say in the index what it is and why it is here |

A document feeding **two sections** lives where its primary figure lands and is cited from both in the worksheet. A bank statement showing interest and a deductible account fee sits in `income/`.

A document naming **two people** — a joint bank statement, a household private health statement — lives in `joint/bundle/<section>/` and is cited from both worksheets. It is filed once, not copied into each.

**Records made during the run** rather than found — a logbook written up from a calendar, a four-week working-from-home diary, a reconstructed crypto history — file in the section they support like any other document. Their authority is the worksheet's working, which is where the reconstruction is shown, and the index records the date they were built and from what.

## Naming

A copy is renamed on the way in. The name carries only what is cosmetic if it is wrong — the kind of document, who issued it, the date. **The amount stays out of the name**: receipts are read back in aggregate, so a per-receipt figure has been read but not confirmed, and a name is the place a figure looks most like established fact.

| Shape | Example |
|---|---|
| `<kind>-<issuer>.pdf` | `income-statement-acme.pdf`, `bank-interest-anz.pdf` |
| `<kind>-<YYYY-MM-DD>.pdf` | `prefill-2026-08-14.pdf` |
| `<YYYY-MM-DD>-<vendor>.<ext>` | `2026-03-14-officeworks.jpg` |

Dates are the document's own date, in the income year being prepared. A date outside it is worth a question before the document is filed.

**The prefill report is dated** because it is downloaded more than once — prefill fills in through July, and step 4's second pass runs against a later download. The reconciliation cites which one it read, so an undated name that gets overwritten takes the audit trail with it.

The original filename goes in the index, so a document the user re-downloads or looks for in their own filing still matches.

## The index

Every section folder carries an `index.md`, copied from [INDEX.md](../templates/INDEX.md). It is the **read record**: what was read off each document, from which file, on what date it was read back to the user.

The worksheet is the authority for what goes into myTax. The index is what the page said. After step 4 those two legitimately differ — a joint account reported in full to one holder is the standard case — and the difference is the working, not an error.

A **pile** closes with a confirmed total row: that total is the working behind the aggregate figure at the label, which is why the arithmetic lives here rather than in the worksheet. A section whose documents feed different labels carries no total — `income/` sums salary, interest and dividends into three different places, and `rental/` mixes income with expenses.

Where a figure could not be read and the user could not supply it, the row says so and the label reads `TBC` against an Outstanding entry. A row with a blank figure and no Outstanding entry is the one state this file must never be left in.
