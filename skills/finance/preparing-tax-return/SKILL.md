---
name: preparing-tax-return
description: "Australia only — prepare an individual tax return for self-lodgement in myTax: gather your documents, reconcile prefill, test every deduction, and produce a label-by-label worksheet."
disable-model-invocation: true
---

# Preparing your own Australian tax return

This skill produces two things: a **bundle** — every document the return rests on, copied in, filed by what it feeds, and indexed — and a **worksheet** that gives, label by label, the number to type into myTax, the working behind it, and the document in the bundle it came from. Assembled with the user, checked by the user, lodged by the user.

Every question put to the user comes from [interview.md](process/interview.md), asked in its order and its wording. A return is assembled across weeks and often across two people, so the interview has to look the same each time it is picked up — an improvised question set makes a resumed session feel like starting over, and quietly drops the categories that run happened not to think of.

## What this is, and what it is not

**Australia only.** This prepares the Australian individual tax return, lodged through the ATO's myTax. The name carries no jurisdiction, so a user may well arrive with a return from somewhere else — nothing here transfers, and the step-1 statement below is where they find out.

This skill is not tax advice, and its author is not a registered tax agent. It does not lodge anything and never touches the user's ATO account. The division of labour is fixed: the user holds the myGov credentials and does the lodging; you do the reconciling, the arithmetic, and the substantiation record.

Four properties hold that line. They are the design, not a caveat:

- The user types every number into myTax themselves. Nothing is submitted on their behalf.
- Every figure carries its working and its source document.
- Genuine uncertainty routes to a private ruling, binding on the ATO, rather than to an opinion.
- Anything unresolved reads `TBC` and blocks lodgement until it is settled.
- Documents are read only where the user points, copied rather than moved, and every copy stays beside the worksheet on the user's own disk.

**One consequence the user must hear, because getting it wrong costs money.** The penalty safe harbour in TAA 1953 Sch 1 s 284-75(6) requires a *registered* agent, both engaged and making the statement — so a self-lodger using this skill cannot have it, whatever care was taken. What they have instead is the general reasonable-care exception in s 284-75(5), and the substantiation discipline at step 6 is what supports it.

**Say this to the user at step 1, in your own words, in plain English — four or five sentences, once per return.** Australian returns only, through the ATO and myTax; not tax advice; you will read their records in the places they name and copy each document into a folder beside the worksheet; they check and lodge it themselves; and the penalty protection that covers a registered agent's client does not extend to them, so the working and the receipts are what protect them instead. Keep the section numbers out of it unless they ask why — then they are above.

## The income year

The Australian income year runs 1 July – 30 June. The return in play is the year ending on the 30 June most recently passed; confirm it with the user, because they may be catching up on an older year. That year number goes in every ATO URL below (`.../mytax-instructions/2026/...` is the year ended 30 June 2026).

**Verified against the 2026 income year.** The stamp names the income year whose published myTax instructions the section list at step 2 was checked against, item by item — the section index at `.../mytax-instructions/<year>/`, which is the authority the list is drawn from. It dates that list and the interview batches that walk it, and nothing else: rates and thresholds do not go stale, because every one is fetched on this run, and dead ATO URLs self-heal through the search fallback below. It is one literal, deliberately: bump it when the section list is re-checked, and nothing else needs touching.

So once the return year is settled at step 1, compare it against the stamp and say so unprompted when they differ. **Later than the stamp** — the section list may be missing a category that now exists, and the interview will not ask about it, so watch step 2 and say that is what you are watching for. **Earlier** — it may name a section that year did not have, which wastes time rather than costing money.

## Every rate comes from the ATO on this run

Rates, thresholds and caps change annually, so a rate recalled from memory is a wrong rate. Fetch each one.

This makes web access a precondition rather than a convenience: with no way to reach ato.gov.au there are no rates and no fallback. Say so and stop, rather than answering from memory.

`WebFetch` gets a 403 from ato.gov.au. Use curl with a browser user-agent:

```bash
curl -sS -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" "<url>"
```

ATO deep URLs are reorganised often and 404 silently. When a URL fails, find the current one with `WebSearch` scoped to `allowed_domains: ["ato.gov.au"]`, then curl it. [rates.md](process/rates.md) holds the stable entry points and the rates to pull from each.

## Getting a binding answer when a rule is unclear

Where the law's application to the user's facts is genuinely uncertain, the answer is not to guess and not to hand the return to someone else. It is to **apply for a private ruling** — made on the user's own stated facts, and **legally binding on the ATO where it applies to them and they rely on it**. An accountant's opinion binds nobody, which makes a ruling the stronger instrument, not merely the cheaper one. Individuals apply on the private ruling application form. Two practical points: the ATO aims to answer within **28 calendar days of having all the information it needs**, so an incomplete application quietly restarts the clock — raise it in August, not late October; and where the ruling turns on a **valuation**, the valuer's fee can be passed on to the applicant. An edited version of every ruling is later published in the public register, so keep identifying detail out of the facts where it is not needed. For SMSF questions the equivalent is **SMSF specific advice**.

So when research does not settle a position: set out the facts, draft the ruling application with the user, and park the affected label as Outstanding until the answer lands.

## What myTax cannot lodge

This is a scope fact about the form, not a judgement about difficulty. myTax lodges an **individual** return. These need their own return, lodged separately:

- A **trust**, including a deceased estate or testamentary trust — trust tax return.
- A **company** — company tax return.
- An **SMSF** — SMSF annual return, and the law requires it to be audited by an **approved SMSF auditor** before lodging. That audit cannot be self-performed at any level of skill.
- A **partnership** — partnership return.

The individual return of someone who is a beneficiary, partner or shareholder of one of those **is** in scope, and this skill handles it: the distribution, share of net income, or dividend flows through to their own return once the entity's return is done.

Everything an individual return can contain is documented in the branch references. Where a question falls outside them, research it against ATO sources using the fetch technique above and say that is what you are doing, rather than answering from memory.

## Timing

Prefill arrives progressively through July as employers finalise income statements and banks, funds, health insurers and share registries report. It is usually complete in the first half of August. Building the worksheet early is fine; lodging against incomplete prefill earns an ATO amendment later. **Self-lodgers must lodge by 31 October.** Records are kept for five years from the lodgement date.

**If no return is required at all** — income under the threshold, no tax withheld, no other trigger — the user still tells the ATO, by lodging a **non-lodgment advice** through ATO online services. Silence looks like a missed lodgement and generates demands. Confirm with the ATO's "Do I need to lodge a tax return?" tool rather than reasoning from the tax-free threshold alone, because tax withheld, a study loan, business income or a capital gain each force a return on their own. Someone with an active ABN carrying on a business cannot use a non-lodgment advice.

**If a return is already lodged and something turns out wrong**, the fix is an amendment through myTax, not a second return. Individuals generally have **two years** from the day after the assessment issues; sole traders have **four years** for 2024–25 and later income years, two for earlier ones. Amend voluntarily rather than waiting — the ATO reduces penalties for a voluntary disclosure, and a missing income amount it finds first is treated very differently from one the user reports. Past the amendment window the route is an **objection**, which the taxpayer lodges themselves through ATO online services — it needs the grounds set out in writing and the evidence attached, which is work this skill can do.

## Saving and resuming

A return is assembled over weeks, not in one sitting. Prefill completes through July, a managed fund's annual tax statement can arrive in September, and a broker's or exchange's annual report later still. Stopping part-way is the normal case, not the exception.

The worksheet is the return's saved state and its deliverable; for a couple, `joint/shared.md` is saved state too. Each is updated as its step lands rather than written up at the end.

Everything a return produces lives under one folder per income year:

```
tax-2026/
  sam/
    worksheet.md              the deliverable, and the saved state
    inbox/                    arrived, not yet filed
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

Anything blocked on a document goes in the worksheet's **Outstanding** register, and its figure at the label reads `TBC` so a placeholder can never be typed into myTax as a number. Each entry names the document, the section it feeds, who it comes from, and when it is expected. **The return is ready to lodge only when the register is empty.**

---

# Steps

## 1. Open the worksheet

Before asking the user anything, look for returns already in progress: glob `tax-*/*/worksheet.md`. Do this every run — a return in progress is the normal state of this skill between July and October, and re-interviewing someone about sections they settled three weeks ago is how they lose faith in the process.

Establish **whose** return and **which year**. Where returns already exist, list them by person and year and ask which one this session is for. With the year settled, run the stamp comparison from *The income year* above and report any mismatch now, before the interview starts.

**Found the one** — read the worksheet in full, and `../joint/shared.md` too where it exists. Report back before doing any work: what is settled, what the Outstanding register is waiting on, what is sitting in `inbox/`, and which step comes next. Resume at that step. Settled sections are re-opened only if the user asks or a newly arrived document contradicts them.

**Found none for this person and year** — before creating anything, say what this skill is and is not, from *What this is, and what it is not* above: three or four sentences, plain English, no section numbers. Then name the exact path you are about to write — the tree in *Saving and resuming* above, rooted at `tax-<YYYY>/` — say what will be written there, and ask whether that place will still exist in five years: records are kept for five years from lodgement, and a working directory inside a code project is not durable by default. On confirmation, create the year root and the person's folder, copy [WORKSHEET.md](templates/WORKSHEET.md) to `worksheet.md`, create an empty `inbox/`, and add the ignore line if this is a git working tree.

Then ask **batch 0** of [interview.md](process/interview.md) — where the records live, and whether there was a spouse. It fires here rather than earlier because every answer is recorded in the worksheet as it comes in, and the worksheet now exists.

**Where there was a spouse** at any point in the year, married or de facto, both returns are prepared together rather than one after the other: each return needs the other's taxable income, and the Medicare and private health figures run off the couple's combined income. Read [couples.md](references/couples.md) before going further. Name the second person's folder and `joint/` and confirm them as you did the first, then create a folder, worksheet and `inbox/` for each of them plus a `joint/` holding [SHARED.md](templates/SHARED.md) as `shared.md`, and carry both returns through the steps side by side. Batch 0's `Records` question is asked again for the spouse once their worksheet exists — two people rarely keep their records in one place.

**Done when** the year's folder exists at a path the user has confirmed, holding a worksheet and an empty `inbox/` for each person being prepared and — for a couple — `joint/shared.md`; the income year is confirmed and compared against the stamp; batch 0 is asked and its answers are in the worksheet; and, resuming, the user has been told where each return stands and what it is waiting on.

## 2. Personalise — fix the shape of the return

Walk the whole section list with the user and mark every section in or out. It is the ATO's own index of the myTax sections for the year, so working through it here means no surprises at step 8.

myTax's own "personalise" screen groups these differently — it groups some, selects others for you from prefill, and displays a few unconditionally. Do not try to make the two lists correspond one to one. This list is the exhaustive one; matching it to the screen is step 8's job, not this step's.

**Income** — salary, wages or other income on an income statement or payment summary · Australian income or losses from investments or property (interest, dividends, rent, capital gains) · Australian super or annuity payments · managed fund or trust distributions · sole trader and business income or losses and partnership distributions · foreign income · taxable payments and grants · other income · amounts you do not pay tax on

**Deductions** — work-related expenses · donations, investments and managing your tax affairs · other deductions (including personal super contributions)

**Then** — tax offsets · Medicare and private health insurance · adjustments · tax losses of earlier income years · spouse details and income tests · non-resident foreign income, where a foreign resident has a HELP, VSL or AASL liability

Get there by asking **batch 1** of [interview.md](process/interview.md) — the fixed situation scan — rather than reading the section list aloud. Its questions are worded around life events, because those are what the user recognises; each answer maps to sections they would not have thought to name.

Load the branch reference for each section that is in: [investments.md](references/investments.md), [rental.md](references/rental.md), [sole-trader.md](references/sole-trader.md), [ess.md](references/ess.md) for shares or options from an employer, [small-business-cgt.md](references/small-business-cgt.md) when a business or business asset was sold.

**Settle residency first** where the person arrived, left, or spent significant time outside Australia during the year — [residency.md](references/residency.md). It decides what is taxed at all, so it is not a section like the others; a wrong answer here invalidates every figure below it. The conclusion reached here is provisional until the travel record is read at step 3: where that record is not in the bundle, the residency determination itself reads `TBC`, and given what rests on it that `TBC` is worth more than most.

**Done when** every section on the list above is marked in or out, and each "in" section names the documents that will support it. Step 3 decides which of those documents exist: the Outstanding register opens there, once a place has been looked in.

## 3. Build the bundle

The **bundle** is the indexed set of documents the user could hand to the ATO: every document the return cites, copied in, filed by what it feeds, and read. Step 2 named which documents the return needs. This step goes and gets them.

**Reach.** Batch 0 named the places the records live. For each place, say which tool you will use, then list what is in it and name the files you will open and what each one feeds. The user confirms that list; you open the files on it. The places the user named bound where you look, and the confirmed list bounds what you open.

Reaching a place is one attempt with the tools this session already has. Where there is no tool for a place, or reaching it would mean installing or authorising something, say so in one line and ask the user to export its contents into `inbox/`; read that folder instead. Records on paper go the same way, as photographs or scans.

Some documents only the user can produce, because they sit behind their myGov login or have not been issued yet — the prefill report, an income statement that is not yet **Tax ready**, the private health statement. Ask for those by name. One that has not been downloaded yet opens an Outstanding entry like any other missing document.

**The read-back.** A figure that lands on a myTax **label** — gross payments, tax withheld, interest, franked and unfranked dividends, rent — is read back to the user field by field, per document, before it is written. A **pile** — many documents whose lines sum to one figure at one label, like a stack of receipts or a broker CSV — is read back in aggregate: the count, the total, and every line you could not read. A **logbook** is read back as its total kilometres, its work kilometres, and the percentage they give.

**A figure you cannot read every digit of**: name the document and the field, and ask the user to read it out. Where they cannot answer now, or a document will not open at all, it goes in the Outstanding register and its label reads `TBC` — the same two states as a statement that has not arrived.

Read [documents.md](process/documents.md) before filing anything: it holds which folder a document belongs in, what a copy is named, and what its section's `index.md` records.

**Done when** all of these hold:

- Every place batch 0 named has a tool and a read date beside it in the worksheet, or one line saying why it could not be reached.
- Every document step 2 named is either a copy in `bundle/<section>/`, listed in that section's `index.md` with the figures read off it, or an Outstanding entry naming the document, who it comes from, and **the place that was looked in**.
- Every label figure has had its read-back confirmed field by field; every pile as a count and a total; every logbook as its kilometres and its percentage.
- Every field that could not be read has been read out by the user, or reads `TBC` against an Outstanding entry.
- `inbox/` is at zero.
- The worksheet's Bundle table has a row for every section folder under `./bundle/`.
- For a couple, every ownership split in `joint/shared.md` is settled off the joint documents in `joint/bundle/` — the prefill reconciliation at step 4 cannot correct a joint account reported in full to one holder without them.

## 4. Reconcile the prefill

Open the prefill report from `bundle/income/` and reconcile it against what step 3 read. The section indexes hold figures the user has already confirmed, so reconcile against those rather than re-opening the documents — a second read can differ from the confirmed first one without anyone noticing.

Prefill is the ATO's copy of what third parties reported — it is a starting point, not the truth. Go through it line by line and give every line one of three outcomes:

- **Accepted** — matches the user's own record.
- **Corrected** — the user's record differs; write down both numbers and the reason. Common causes: a joint account reported in full to one holder, a dividend reinvestment plan, a bank reporting gross before withholding.
- **Missing** — income the user knows about that prefill does not show. Cash work, foreign income, crypto disposals, and a second employer that has not finalised are the usual suspects. Missing income is the user's responsibility regardless of prefill.

Then check the reverse direction: income the user has that has no prefill line at all.

**Done when** every prefill line carries one of the three outcomes, every correction has a written reason, and the user has confirmed there is no income outside the reconciled set. Where prefill is still filling in, record what is expected to land and from whom as Outstanding, and reconcile again when it arrives — the second pass covers only the new lines, against a prefill report dated for that download.

## 5. Income

Work section by section through the sections marked in at step 2, using the rates from the ATO and the branch references for investments, rent, and business.

Two things people get wrong on the income side: an income statement must be **Tax ready** before its figures are final, and reportable fringe benefits and reportable employer super contributions are not taxable income but do feed the income tests that drive offsets, the Medicare levy surcharge, and HELP repayments.

**For a couple**, each return's share of a joint item is copied from `joint/shared.md`, where the splits were settled at step 3.

**Done when** every income section marked in has a figure, and each figure traces to a named document or a written calculation.

## 6. Deductions — nexus, apportionment, substantiation

Open with **batch 2** of [interview.md](process/interview.md), the fixed deduction scan, and **batch 3** for any method choice it raises. Asking the same categories every run is what stops a quiet year of under-claiming.

Every claim then passes three tests, in order. This is where a self-lodger both loses money by under-claiming and gets into trouble by over-claiming, so run all three on every claim rather than eyeballing the plausible ones.

**Nexus** — the expense was incurred in earning assessable income. Ask what income this expense produced. "It relates to my field" or "my employer likes it" is not nexus. Getting to work is not nexus; travelling between two workplaces is. Conventional clothing is not nexus; a compulsory uniform or protective gear is.

**Apportionment** — the deductible fraction is the work-use fraction, and the private fraction is not deductible. A claim with no stated fraction is a claim of 100%, which must be defensible. A phone, a laptop, a car, and a home internet connection are almost never 100%. The fraction needs a basis: a logbook, a four-week diary, an itemised bill.

**Substantiation** — the record that proves the expense and the fraction. Usually a receipt; for some claims a diary or logbook as well. The record is already in the bundle from step 3, so the question at each claim is what it shows, and whether there is another the bundle does not have.

A claim failing a test is dropped, or cut back to the portion that passes. Carry the outcome of all three tests into the worksheet beside the claim.

**The $300 rule** is a record-keeping concession, not an allowance: if total work-related expenses come to $300 or less you need records showing how you worked the claim out, and above $300 you need written evidence for **every** claim — not merely the amount above $300. Either way the expense must have been real and must pass all three tests. Claiming $300 you did not spend is a false statement.

Four categories sit **outside** the $300 total and carry their own evidence rules: car expenses, meal allowance expenses, award transport payments, and travel allowance expenses. Do not count them toward the threshold when deciding whether it has been crossed.

[deductions.md](references/deductions.md) has the catalogue: car, travel, clothing and laundry, self-education, working from home, tools and equipment, and the rest — with the method choices and what each one needs as evidence.

**Done when** every claim in the worksheet records nexus, apportionment fraction, and substantiation, and every claim that failed a test is either dropped or reduced.

## 7. Offsets, Medicare, adjustments

- **Private health insurance** — enter from the statement; the rebate tier depends on income and age, and getting the tier wrong at the insurer means a reconciliation here.
- **Medicare levy surcharge** — applies if income for surcharge purposes is over the threshold without an appropriate level of hospital cover, and it uses a broader income measure than taxable income.
- **Medicare levy reduction or exemption** — low income, or a category exemption such as a Medicare entitlement statement.
- **Offsets** — seniors and pensioners, zone or overseas forces, foreign income tax offset, small business income tax offset. Low and middle income offsets change between years; check what exists for this year rather than assuming.
- **Adjustments** — part-year tax-free threshold, working holiday maker status, government super contributions.
- **Earlier-year tax losses** and **spouse details** if applicable.

**With a spouse**, the first four of those run off combined income rather than the person's own — see [couples.md](references/couples.md). Combined income, family income for the surcharge and the rebate tier, and the rebate split are worked once, here, in `joint/shared.md`, and each return records its derived share citing that file. They cannot be worked earlier: both returns have to finish income and deductions before either taxable income exists.

**Done when** each of the above is applied with its current-year figure, or ruled out with a reason — and, for a couple, `joint/shared.md` holds the combined figures and each return's share is copied from it.

## 8. Complete the worksheet

Fill the worksheet through to its estimate. It follows the myTax section order so the user can work top to bottom through the real screens. Ask **batch 4** of [interview.md](process/interview.md) for anything the situation has raised.

**Done when** every myTax label the return touches has a number, a working, and a source document — or reads `TBC` against a matching Outstanding entry — and the worksheet totals to an estimated refund or bill, marked provisional while anything is outstanding.

## 9. Pre-lodge review

Read the finished worksheet back against these:

- **The Outstanding register is empty and no label reads `TBC`.** Until then the return is not lodgeable, and this is the check to report when the user asks whether they can lodge yet.
- **For a couple**, every line of the readiness gate in `joint/shared.md` passes. Neither return is handed over until it does — one spouse lodging on the other's estimated income is how a couple earns an amendment.
- Every income statement is **Tax ready**, and every prefill line was reconciled at step 4.
- No deduction is a round number standing in for a real one.
- Deductions are proportionate to the income that generated them, and the user could explain each one to the ATO in a sentence.
- Bank details for the refund are current.
- Personal super contributions claimed have an acknowledged notice of intent from the fund — without it the deduction is denied, and it cannot be fixed after lodging.
- HELP, VSL or other study loan balances are reflected.
- **The bundle is complete** — every document the worksheet cites is a copy under `bundle/`, listed in its section's `index.md`.

Then hand over: the user logs in to myGov, opens myTax, enters the worksheet, and lodges. Tell them the estimate myTax shows should match the worksheet's, and that a difference means a label went in wrong — worth finding before they submit.

**Done when** every check above passes — the first two on lodgeability are not waivable, since an unresolved `TBC` is what blocks lodgement — or is explicitly waived by the user, and the user has the worksheet and the bundle in hand.
