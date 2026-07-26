# Filing the bundle

Where a copy lands, what it is called, and what its index records. Step 2 asks for the documents and reads them back; this file is what happens to each one afterwards.

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
| `other/` | anything the list above cannot place — its index row says in **Field** what the document is and why it is filed here |

A document feeding **two sections** lives where its primary figure lands and is cited from both in the worksheet. A bank statement showing interest and a deductible account fee sits in `income/`.

A document naming **two people** — a joint bank statement, a household private health statement — lives in `joint/bundle/<section>/` and is cited from both worksheets. It is filed once, not copied into each.

**Records made during the run** rather than found — a logbook written up from a calendar, a four-week working-from-home diary, a reconstructed crypto history — file in the section they support like any other document. Their authority is the worksheet's working, which is where the reconstruction is shown; their index row says in **Field** what they were built from, and carries the date they were built.

**Figures given without a document** — read off a screen the user describes, or pasted as text — carry their real figure at the label, and an Outstanding entry waits on the file itself. A transcript you write out yourself is not that file: the bundle holds the issuer's own, which is what substantiation rests on.

**A document arriving after the return is lodged** is filed exactly as any other, and its figures reconciled against what was lodged. Where they differ, the route is an amendment, not an edit to a lodged return — see [lodging.md](lodging.md).

## Naming

A copy is renamed on the way in. The name carries only what is cosmetic if it is wrong — the kind of document, who issued it, the date. Amounts live in the index.

| Shape | Example |
|---|---|
| `<kind>-<issuer>.pdf` | `income-statement-acme.pdf`, `bank-interest-anz.pdf` |
| `<kind>-<YYYY-MM-DD>.pdf` | `prefill-2026-08-14.pdf` |
| `<YYYY-MM-DD>-<vendor>.<ext>` | `2026-03-14-officeworks.jpg` |

Dates are the document's own date. Where it falls outside the income year being prepared, ask — unless it is one of the records that legitimately predates the year: a logbook still inside its five-year life, the purchase invoice for an asset still declining in value, a rental's capital works records, or the cost base records for a parcel bought years ago.

**The prefill report is dated** because it is downloaded more than once — prefill fills in through July, and step 3's second pass runs against a later download. The reconciliation cites which one it read, so an undated name that gets overwritten takes the audit trail with it.

## The index

Every section folder carries an `index.md`, copied from [INDEX.md](../templates/INDEX.md). It is the **read record**: what was read off each document, and the date the user confirmed it. A row is written once that confirmation lands, so every row in the index is a figure the user has agreed to — a document read but not yet confirmed sits in the conversation, not the file.

A **pile** closes with a confirmed total row: that total is the working behind the figure at the label, which is why the arithmetic lives here rather than in the worksheet. A section whose documents feed different labels carries no total — `income/` sends salary, interest and dividends to three different places, and `rental/` mixes income with expenses.
