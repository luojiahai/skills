---
name: preparing-tax-return
description: "Australia only — prepare an individual tax return for self-lodgement in myTax: gather your documents, reconcile prefill, test every deduction, and produce a label-by-label worksheet."
disable-model-invocation: true
metadata:
  internal: true
---

# Preparing your own Australian tax return

> [!WARNING]
> **Retired.** This skill is no longer shipped or maintained. Its "verified against the 2026 income year" stamp is frozen at the day it was retired — do not rely on it.

This skill produces two things: a **bundle** — every document the return rests on, copied in, filed by what it feeds, and indexed — and a **worksheet** that gives, label by label, the number to type into myTax, the working behind it, and the document in the bundle it came from. Assembled with the user, checked by the user, lodged by the user.

Every question put to the user comes from [interview.md](process/interview.md), asked in its order and its wording. A return is assembled across weeks and often across two people, so the interview has to look the same each time it is picked up — an improvised question set makes a resumed session feel like starting over, and quietly drops the categories that run happened not to think of.

## What this is, and what it is not

**Australia only.** This prepares the Australian individual tax return, lodged through the ATO's myTax. The name carries no jurisdiction, so a user may well arrive with a return from somewhere else — nothing here transfers, and the step-1 statement is where they find out.

This skill is not tax advice, and its author is not a registered tax agent. It does not lodge anything and never touches the user's ATO account. The division of labour is fixed: the user holds the myGov credentials and does the lodging; you do the reconciling, the arithmetic, and the substantiation record.

**One consequence the user must hear, because getting it wrong costs money.** The penalty safe harbour in TAA 1953 Sch 1 s 284-75(6) requires a *registered* agent, both engaged and making the statement — so a self-lodger using this skill cannot have it, whatever care was taken. What they have instead is the general reasonable-care exception in s 284-75(5), and the substantiation discipline at step 5 is what supports it.

## The income year

The Australian income year runs 1 July – 30 June. The return in play is the year ending on the 30 June most recently passed; confirm it with the user, because they may be catching up on an older year. That year number goes in every ATO URL (`.../mytax-instructions/2026/...` is the year ended 30 June 2026).

**Verified against the 2026 income year.** The stamp dates one thing: the section list at step 2, checked item by item against the ATO's published section index for that year. Rates do not go stale, because every one is fetched on this run, and dead ATO URLs self-heal through the search fallback. Bump the stamp when the section list is re-checked, and nothing else needs touching.

So once the return year is settled at step 1, compare it against the stamp and say so unprompted when they differ. **Later** is the direction that costs money: the section list may be missing a category that now exists, and the interview will not ask about it — say that is what you are watching for at step 2. **Earlier** only wastes time, on a section that year did not have.

## Every rate comes from the ATO on this run

Rates, thresholds and caps change annually, so fetch each one on the run rather than recalling it. [rates.md](process/rates.md) holds the entry points, the rates to pull from each, the fetch technique — ato.gov.au 403s `WebFetch`, so it takes curl — and the search fallback for ATO deep URLs, which are reorganised often and 404 silently.

Web access is therefore a precondition rather than a convenience: with no way to reach ato.gov.au there are no rates and no fallback. Say so and stop.

## Getting a binding answer when a rule is unclear

Where the law's application to the user's facts is genuinely uncertain, the answer is not to guess and not to hand the return to someone else. It is to **apply for a private ruling** — made on the user's own stated facts, and **legally binding on the ATO where it applies to them and they rely on it**. An accountant's opinion binds nobody, which makes a ruling the stronger instrument, not merely the cheaper one.

So when research does not settle a position: set out the facts, draft the ruling application with the user, and park the affected label as Outstanding until the answer lands. [lodging.md](process/lodging.md) has how to apply and how long the ATO takes.

## Saving and resuming

A return is assembled over weeks, not in one sitting — prefill fills in through July, a managed fund's annual tax statement can arrive in September, and a broker's or exchange's annual report later still. Stopping part-way is the normal case, not the exception.

The worksheet is the return's saved state and its deliverable; for a couple, `joint/shared.md` is saved state too. Each is updated as its step lands rather than written up at the end.

Everything a return produces lives under one folder per income year:

```
tax-2026/
  sam/
    worksheet.md              the deliverable, and the saved state
    bundle/<section>/         the documents, filed by what they feed
  alex/                       a couple lodges two returns, never one joint one
  joint/                      a couple only
    shared.md                 the figures both returns share, worked once
    bundle/<section>/
```

Which `<section>` folders exist, what each copy is named, and what its `index.md` holds are in [documents.md](process/documents.md).

The working directory is wherever the user happened to start the session, which is often a code project and sometimes one with a remote — so where the year's folder lands is their call, settled at step 1.

Inside a git working tree, add `tax-*/` to the repo root's `.gitignore` — the pattern, not this year's literal, so next year's folder is covered too — and say that you have done so, so the choice to commit it stays theirs. Outside one there is nothing to add and nothing to say. If anything under the year's folder turns out to be tracked already, say that too — an ignore line does nothing for a tracked file, and what is at stake now is a bank statement rather than a markdown file.

**Identity numbers live in the bundle, not the worksheet.** The worksheet carries figures, labels and working. A TFN, a full account number, a health fund member number stays on the document that already holds it, and myTax prefills identity anyway. Where a label needs one of those numbers typed in, name the file in `bundle/` it is printed on and let the user read it from there.

Anything blocked goes in the worksheet's **Outstanding** register. Each entry names what is missing, the section it feeds, who it comes from, and when it is expected. An entry whose figure has already been read keeps that figure at its label; one with nothing read leaves the label at `TBC`, so a placeholder can never be typed into myTax as a number. **The return is ready to lodge only when the register is empty.**

---

# Steps

## 1. Open the worksheet

Before asking the user anything, look for returns already in progress: glob `tax-*/*/worksheet.md`. Do this every run — a return in progress is the normal state of this skill between July and October, and re-interviewing someone about sections they settled three weeks ago is how they lose faith in the process.

Establish **whose** return and **which year**. Where returns already exist, list them by person and year and ask which one this session is for. With the year settled, run the stamp comparison from *The income year* above and report any mismatch now, before the interview starts.

**Found the one** — read the worksheet in full, and `../joint/shared.md` too where it exists. Report back before doing any work: what is settled, what the Outstanding register is waiting on, and which step comes next. Resume at that step. Settled sections are re-opened only if the user asks or a newly arrived document contradicts them.

**Found none for this person and year** — before creating anything, say what this skill is and is not, in your own words, in plain English, four or five sentences, once per return: Australian returns only, through the ATO and myTax; not tax advice; you will ask them for one document at a time, read only what they hand over, and copy each one into a folder beside the worksheet; they check and lodge it themselves; and the penalty protection that covers a registered agent's client does not extend to them, so the working and the receipts are what protect them instead. Keep the section numbers out of it unless they ask why — then they are in *What this is, and what it is not* above.

Then name the exact path you are about to write — the tree in *Saving and resuming* above, rooted at `tax-<YYYY>/` — say what will be written there, and ask whether that place will still exist in five years: records are kept for five years from lodgement, and a working directory inside a code project is not durable by default. On confirmation, create the year root and the person's folder, copy [WORKSHEET.md](templates/WORKSHEET.md) to `worksheet.md`, and add the ignore line if this is a git working tree.

Then ask **batch 0** of [interview.md](process/interview.md) — whether there was a spouse. It fires here rather than earlier because the answer is recorded in the worksheet as it comes in, and the worksheet now exists.

**Where there was a spouse** at any point in the year, married or de facto, both returns are prepared together rather than one after the other: each return needs the other's taxable income, and the Medicare and private health figures run off the couple's combined income. Read [couples.md](references/couples.md) before going further. Name the second person's folder and `joint/` and confirm them as you did the first, then create a folder and worksheet for each of them plus a `joint/` holding [SHARED.md](templates/SHARED.md) as `shared.md`, and carry both returns through the steps side by side.

**Done when** the year's folder exists at a path the user has confirmed, holding a worksheet for each person being prepared and — for a couple — `joint/shared.md`; the income year is confirmed and compared against the stamp; batch 0 is asked and its answer is in the worksheet; and, resuming, the user has been told where each return stands and what it is waiting on.

## 2. Personalise and gather

The shape of the return and the documents it rests on are built in one pass, because they arrive together: a user answering *what did you have income from* hands over the statement in the same breath. Mark the sections first, then work down what they name — but a document offered early is read and filed when it is offered, not held back.

Walk the whole section list with the user and mark every section in or out. It is the ATO's own index of the myTax sections for the year, so working through it here means no surprises at step 7.

myTax's own "personalise" screen groups these differently — it groups some, selects others for you from prefill, and displays a few unconditionally. Work this list, which is the exhaustive one; matching it to the screen is step 7's job.

**Income** — salary, wages or other income on an income statement or payment summary · Australian income or losses from investments or property (interest, dividends, rent, capital gains) · Australian super or annuity payments · managed fund or trust distributions · sole trader and business income or losses and partnership distributions · foreign income · taxable payments and grants · other income · amounts you do not pay tax on

**Deductions** — work-related expenses · donations, investments and managing your tax affairs · other deductions (including personal super contributions)

**Then** — tax offsets · Medicare and private health insurance · adjustments · tax losses of earlier income years · spouse details and income tests · non-resident foreign income, where a foreign resident has a HELP, VSL or AASL liability

Get there by asking **batch 1** of [interview.md](process/interview.md) — the fixed situation scan — rather than reading the section list aloud. Its questions are worded around life events, because those are what the user recognises; each answer maps to sections they would not have thought to name.

**myTax lodges an individual return.** A **trust** (including a deceased estate or testamentary trust), a **company**, an **SMSF**, or a **partnership** each needs its own return, lodged separately — and the law requires an SMSF's annual return to be audited by an **approved SMSF auditor** first, which cannot be self-performed at any level of skill. The individual return of someone who is a beneficiary, partner or shareholder of one of those **is** in scope, and this skill handles it: the distribution, share of net income, or dividend flows through to their own return once the entity's return is done.

Load the branch reference for each section that is in: [investments.md](references/investments.md), [rental.md](references/rental.md), [sole-trader.md](references/sole-trader.md), [ess.md](references/ess.md) for shares or options from an employer, [small-business-cgt.md](references/small-business-cgt.md) when a business or business asset was sold. Where a question falls outside them, research it against ATO sources and say that is what you are doing.

**Settle residency first** where the person arrived, left, or spent significant time outside Australia during the year — [residency.md](references/residency.md). It decides what is taxed at all, so it is not a section like the others; a wrong answer here invalidates every figure below it. The conclusion reached here is provisional until the travel record is in the bundle: until it is, the residency determination itself reads `TBC`, and given what rests on it that `TBC` is worth more than most.

### Gathering

Each section marked in names the documents that will support it, in the worksheet's **Documents** table. That table is a gap list rather than a worklist written up front: a row is added the moment a document is named, and completed when its copy is filed, so a session resuming mid-step reads down it for the first row still open. The bundle it fills is what the user could hand to the ATO.

**Ask for one document at a time.** Name the document and say what it feeds. A paste, a path, a link and a photograph of paper all go the same way — what gets recorded is the document, not how it arrived.

You read what the user puts in front of you and nothing else: their hand-over is what bounds your reach, and there is no going looking of your own accord. Where what comes back is a **folder** rather than a document, list it first — name the files you would open and what each one feeds — and read only the ones the user confirms.

Some documents only the user can produce, because they sit behind their myGov login or have not been issued yet — the prefill report, an income statement that is not yet **Tax ready**, the private health statement. Ask for those by name. One that has not been downloaded yet opens an Outstanding entry like any other missing document.

**These come as files, not as pastes** — step 3 opens the prefill report from `bundle/income/` by its dated name, and reads a second download against the first, so a paste with no name and no date breaks the reconciliation. For a couple, each spouse downloads their own: a report behind one spouse's myGov cannot be produced by the other, and the Outstanding entry names which of them it waits on.

**The read-back.** A figure that lands on a myTax **label** — gross payments, tax withheld, interest, franked and unfranked dividends, rent — is read back to the user field by field, per document, before it is written. A **pile** — many documents whose lines sum to one figure at one label, like a stack of receipts or a broker CSV — is read back in aggregate: the count, the total, and every line you could not read. A **logbook** is read back as its total kilometres, its work kilometres, and the percentage they give.

**A figure you cannot read every digit of**: name the document and the field, and ask the user to read it out. Where they cannot answer now, or a document will not open at all, it goes in the Outstanding register and its label reads `TBC`, exactly as a statement that has not arrived.

Read [documents.md](process/documents.md) before filing anything: it holds which folder a document belongs in, what a copy is named, and what its section's `index.md` records.

**Done when** all of these hold:

- Every section on the list above is marked in or out.
- Every row of the worksheet's **Documents** table has been asked for, and is either a copy in `bundle/<section>/` listed in that section's `index.md` with the figures read off it, or an Outstanding entry naming what is missing and who it comes from.
- Every read-back is confirmed: label figures field by field, piles as a count and a total, logbooks as kilometres and percentage.
- Every field that could not be read has been read out by the user, or reads `TBC` against an Outstanding entry.
- Every folder under `bundle/` holds an `index.md`, which one `ls` answers.
- For a couple, every ownership split in `joint/shared.md` is settled off the joint documents in `joint/bundle/` — the prefill reconciliation at step 3 cannot correct a joint account reported in full to one holder without them.

## 3. Reconcile the prefill

Prefill arrives progressively through July as employers finalise income statements and banks, funds, health insurers and share registries report, and is usually complete in the first half of August. Building the worksheet before then is fine; lodging against incomplete prefill earns an ATO amendment later.

Open the prefill report from `bundle/income/` and reconcile it against what step 2 read. The section indexes hold figures the user has already confirmed, so reconcile against those rather than re-opening the documents — a second read can differ from the confirmed first one without anyone noticing.

Prefill is the ATO's copy of what third parties reported — it is a starting point, not the truth. Go through it line by line and give every line one of three outcomes:

- **Accepted** — matches the user's own record.
- **Corrected** — the user's record differs; write down both numbers and the reason. Common causes: a joint account reported in full to one holder, a dividend reinvestment plan, a bank reporting gross before withholding.
- **Missing** — income the user knows about that prefill does not show. Cash work, foreign income, crypto disposals, and a second employer that has not finalised are the usual suspects. Missing income is the user's responsibility regardless of prefill.

Then check the reverse direction: income the user has that has no prefill line at all.

**Done when** every prefill line carries one of the three outcomes, every correction has a written reason, and the user has confirmed there is no income outside the reconciled set. Where prefill is still filling in, record what is expected to land and from whom as Outstanding, and reconcile again when it arrives — the second pass covers only the new lines, against a prefill report dated for that download.

## 4. Income

Work section by section through the sections marked in at step 2, using the rates from the ATO and the branch references for investments, rent, and business.

Two things people get wrong on the income side: an income statement must be **Tax ready** before its figures are final, and reportable fringe benefits and reportable employer super contributions are not taxable income but do feed the income tests that drive offsets, the Medicare levy surcharge, and HELP repayments.

**For a couple**, each return's share of a joint item is copied from `joint/shared.md`, where the splits were settled at step 2.

**Done when** every income section marked in has a figure, and each figure traces to a named document or a written calculation.

## 5. Deductions — nexus, apportionment, substantiation

Open with **batch 2** of [interview.md](process/interview.md), the fixed deduction scan, and **batch 3** for any method choice it raises. Asking the same categories every run is what stops a quiet year of under-claiming.

Every claim then passes three tests, in order. This is where a self-lodger both loses money by under-claiming and gets into trouble by over-claiming, so run all three on every claim rather than eyeballing the plausible ones.

**Nexus** — the expense was incurred in earning assessable income. Ask what income this expense produced. "It relates to my field" or "my employer likes it" is not nexus. Getting to work is not nexus; travelling between two workplaces is. Conventional clothing is not nexus; a compulsory uniform or protective gear is.

**Apportionment** — the deductible fraction is the work-use fraction, and the private fraction is not deductible. A claim with no stated fraction is a claim of 100%, which must be defensible. A phone, a laptop, a car, and a home internet connection are almost never 100%. The fraction needs a basis: a logbook, a four-week diary, an itemised bill.

**Substantiation** — the record that proves the expense and the fraction. Usually a receipt; for some claims a diary or logbook as well. The record is already in the bundle from step 2, so the question at each claim is what it shows, and whether there is another the bundle does not have.

A claim failing a test is dropped, or cut back to the portion that passes. Carry the outcome of all three tests into the worksheet beside the claim.

**The $300 rule** is a record-keeping concession, not an allowance: if total work-related expenses come to $300 or less you need records showing how you worked the claim out, and above $300 you need written evidence for **every** claim — not merely the amount above $300. Either way the expense must have been real and must pass all three tests. Claiming $300 you did not spend is a false statement.

Four categories sit **outside** the $300 total and carry their own evidence rules: car expenses, meal allowance expenses, award transport payments, and travel allowance expenses. Test the threshold on what remains once those four are set aside.

[deductions.md](references/deductions.md) has the catalogue: car, travel, clothing and laundry, self-education, working from home, tools and equipment, and the rest — with the method choices and what each one needs as evidence.

**Done when** every claim in the worksheet records nexus, apportionment fraction, and substantiation, and every claim that failed a test is either dropped or reduced.

## 6. Offsets, Medicare, adjustments

- **Private health insurance** — enter from the statement; the rebate tier depends on income and age, and getting the tier wrong at the insurer means a reconciliation here.
- **Medicare levy surcharge** — applies if income for surcharge purposes is over the threshold without an appropriate level of hospital cover, and it uses a broader income measure than taxable income.
- **Medicare levy reduction or exemption** — low income, or a category exemption such as a Medicare entitlement statement.
- **Offsets** — seniors and pensioners, zone or overseas forces, foreign income tax offset, small business income tax offset. Low and middle income offsets change between years; check what exists for this year rather than assuming.
- **Adjustments** — part-year tax-free threshold, working holiday maker status, government super contributions.
- **Earlier-year tax losses** and **spouse details** if applicable.

**With a spouse**, the first four of those run off combined income rather than the person's own — see [couples.md](references/couples.md). Combined income, family income for the surcharge and the rebate tier, and the rebate split are worked once, here, in `joint/shared.md`, and each return records its derived share citing that file. They cannot be worked earlier: both returns have to finish income and deductions before either taxable income exists.

**Done when** each of the above is applied with its current-year figure, or ruled out with a reason — and, for a couple, `joint/shared.md` holds the combined figures and each return's share is copied from it.

## 7. Complete the worksheet

Fill the worksheet through to its estimate. It follows the myTax section order so the user can work top to bottom through the real screens. Ask **batch 4** of [interview.md](process/interview.md) for anything the situation has raised.

**Done when** every myTax label the return touches has a number, a working, and a source document — or reads `TBC` against a matching Outstanding entry — and the worksheet totals to an estimated refund or bill, marked provisional while anything is outstanding.

## 8. Pre-lodge review

Read the finished worksheet back against these:

- **The Outstanding register is empty and no label reads `TBC`.** Until then the return is not lodgeable, and this is the check to report when the user asks whether they can lodge yet.
- **For a couple**, every line of the readiness gate in `joint/shared.md` passes. Neither return is handed over until it does — one spouse lodging on the other's estimated income is how a couple earns an amendment.
- Every income statement is **Tax ready**, and every prefill line was reconciled at step 3.
- No deduction is a round number standing in for a real one.
- Deductions are proportionate to the income that generated them, and the user could explain each one to the ATO in a sentence.
- Bank details for the refund are current.
- Personal super contributions claimed have an acknowledged notice of intent from the fund — without it the deduction is denied, and it cannot be fixed after lodging.
- HELP, VSL or other study loan balances are reflected.
- **The bundle is complete** — every document the worksheet cites is a copy under `bundle/`, listed in its section's `index.md`.

Then hand over: the user logs in to myGov, opens myTax, enters the worksheet, and lodges. **Self-lodgers must lodge by 31 October.** Tell them the estimate myTax shows should match the worksheet's, and that a difference means a label went in wrong — worth finding before they submit.

Two cases go somewhere other than a return, and [lodging.md](process/lodging.md) has both: no return is required at all, which still takes a **non-lodgment advice**; or one is already lodged and something turns out wrong, which takes an **amendment**.

**Done when** every check above passes — the first two on lodgeability are not waivable, since an unresolved `TBC` is what blocks lodgement — or is explicitly waived by the user, and the user has the worksheet and the bundle in hand.
