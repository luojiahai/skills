---
name: lodge-au-tax-return
description: Prepare an Australian individual tax return for self-lodgement in myTax — reconcile prefill, test every deduction, and produce a label-by-label worksheet.
disable-model-invocation: true
---

# Lodging your own Australian tax return

This skill produces one thing: a **worksheet** that gives, label by label, the number to type into myTax, the working behind it, and the document it came from — assembled with the user, checked by the user, lodged by the user.

Every question put to the user comes from [interview.md](process/interview.md), asked in its order and its wording. A return is assembled across weeks and often across two people, so the interview has to look the same each time it is picked up — an improvised question set makes a resumed session feel like starting over, and quietly drops the categories that run happened not to think of.

## What this is, and what it is not

This skill is not tax advice, and its author is not a registered tax agent. It does not lodge anything and never touches the user's ATO account. The division of labour is fixed: the user holds the myGov credentials and does the lodging; you do the reconciling, the arithmetic, and the substantiation record.

Four properties hold that line. They are the design, not a caveat:

- The user types every number into myTax themselves. Nothing is submitted on their behalf.
- Every figure carries its working and its source document.
- Genuine uncertainty routes to a private ruling, binding on the ATO, rather than to an opinion.
- Anything unresolved reads `TBC` and blocks lodgement until it is settled.

**One consequence the user must hear, because getting it wrong costs money.** The penalty safe harbour in TAA 1953 Sch 1 s 284-75(6) requires a *registered* agent, both engaged and making the statement — so a self-lodger using this skill cannot have it, whatever care was taken. What they have instead is the general reasonable-care exception in s 284-75(5), and the substantiation discipline at step 5 is what supports it.

**Say this to the user at step 1, in your own words, in plain English — two or three sentences, once per return.** Not tax advice; they check and lodge it themselves; and the penalty protection that covers a registered agent's client does not extend to them, so the working and the receipts are what protect them instead. Keep the section numbers out of it unless they ask why — then they are above.

## The income year

The Australian income year runs 1 July – 30 June. The return in play is the year ending on the 30 June most recently passed; confirm it with the user, because they may be catching up on an older year. That year number goes in every ATO URL below (`.../mytax-instructions/2026/...` is the year ended 30 June 2026).

**Verified against the 2026 income year.** That means the section list at step 2 was checked, item by item, against the ATO's published myTax instructions for that year — the section index at `.../mytax-instructions/<year>/`, which is the authority the list is drawn from. Rates and thresholds do not go stale — every one is fetched on this run — and dead ATO URLs self-heal through the search fallback below, so the section list and the interview batches are what age. It is one literal, deliberately: bump it when the section list is re-checked, and nothing else needs touching.

So once the return year is settled at step 1, compare it against the stamp and say so unprompted when they differ. **Later than the stamp** — the section list may be missing a category that now exists, and the interview will not ask about it, so watch step 2 and say that is what you are watching for. **Earlier** — it may name a section that year did not have, which wastes time rather than costing money.

## Every figure comes from the ATO on this run

Rates, thresholds and caps change annually, so a figure recalled from memory is a wrong figure. Fetch each one.

This makes web access a precondition rather than a convenience: with no way to reach ato.gov.au there are no figures and no fallback. Say so and stop, rather than answering from memory.

`WebFetch` gets a 403 from ato.gov.au. Use curl with a browser user-agent:

```bash
curl -sS -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" "<url>"
```

ATO deep URLs are reorganised often and 404 silently. When a URL fails, find the current one with `WebSearch` scoped to `allowed_domains: ["ato.gov.au"]`, then curl it. [figures.md](process/figures.md) holds the stable entry points and the figures to pull from each.

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

The worksheet is the saved state — one file that is both the deliverable and the resume point, so there is no second place for progress to live and go stale. It lives at `tax-return-<name>-<YYYY>.md` in the working directory — one per person, because a couple lodges two returns — and is updated as each step lands rather than written up at the end. Step 1 opens it; every later step writes to it.

It carries income figures, employer and account details, and health insurance membership numbers, so where it lands is the user's call and not an assumption: step 1 names the exact path and confirms it before creating anything. The working directory is wherever they happened to start the session, which is often a code project and sometimes one with a remote.

Inside a git working tree, also add `tax-return-*.md` to the repo root's `.gitignore`, and say that you have done so, so the choice to commit it stays theirs. Outside one there is nothing to add and nothing to say. If the file turns out to be tracked already, say that too — an ignore line does nothing for a tracked file, and silently "protecting" it is worse than not trying.

Anything blocked on a document goes in the worksheet's **Outstanding** register, and its figure at the label reads `TBC` so a placeholder can never be typed into myTax as a number. Each entry names the document, the section it feeds, who it comes from, and when it is expected. **The return is ready to lodge only when the register is empty.**

---

# Steps

## 1. Open the worksheet

Before asking the user anything, look for existing worksheets: glob `tax-return-*.md` in the working directory. Do this every run — a return in progress is the normal state of this skill between July and October, and re-interviewing someone about sections they settled three weeks ago is how they lose faith in the process.

Establish **whose** return and **which year**. Where worksheets already exist, list them by person and year and ask which one this session is for. With the year settled, run the stamp comparison from *The income year* above and report any mismatch now, before the interview starts.

**Found the one** — read it in full. Report back before doing any work: what is settled, what the Outstanding register is waiting on, what has arrived since, and which step comes next. Resume at that step. Settled sections are re-opened only if the user asks or a newly arrived document contradicts them.

**Found none for this person and year** — before creating anything, say what this skill is and is not, from *What this is, and what it is not* above: two or three sentences, plain English, no section numbers. Then name the exact path you are about to write — `tax-return-<name>-<YYYY>.md` in the working directory — and confirm it, saying what the file will hold. On confirmation, copy [WORKSHEET.md](templates/WORKSHEET.md) to it, add the ignore line if this is a git working tree, and continue to step 2.

Then ask whether the person had a **spouse** at any point in the year — married or de facto. If so, both returns are prepared together rather than one after the other: each return needs the other's taxable income, and the Medicare and private health figures run off the couple's combined income. Read [couples.md](references/couples.md) before going further, open a worksheet for each of them, and carry both through the steps side by side.

**Done when** the worksheet exists at a path the user has confirmed for each person being prepared, the income year is confirmed and compared against the stamp, and — resuming — the user has been told where each return stands and what it is waiting on.

## 2. Personalise — fix the shape of the return

Walk the whole section list with the user and mark every section in or out. It is the ATO's own index of the myTax sections for the year, so working through it here means no surprises at step 7.

myTax's own "personalise" screen groups these differently — it bundles some, selects others for you from prefill, and displays a few unconditionally. Do not try to make the two lists correspond one to one. This list is the exhaustive one; matching it to the screen is step 7's job, not this step's.

**Income** — salary, wages or other income on an income statement or payment summary · Australian income or losses from investments or property (interest, dividends, rent, capital gains) · Australian super or annuity payments · managed fund or trust distributions · sole trader and business income or losses and partnership distributions · foreign income · taxable payments and grants · other income · amounts you do not pay tax on

**Deductions** — work-related expenses · donations, investments and managing your tax affairs · other deductions (including personal super contributions)

**Then** — tax offsets · Medicare and private health insurance · adjustments · tax losses of earlier income years · spouse details and income tests · non-resident foreign income, where a foreign resident has a HELP, VSL or AASL liability

Get there by asking **batch 1** of [interview.md](process/interview.md) — the fixed situation scan — rather than reading the section list aloud. Its questions are worded around life events, because those are what the user recognises; each answer maps to sections they would not have thought to name.

Load the branch reference for each section that is in: [investments.md](references/investments.md), [rental.md](references/rental.md), [sole-trader.md](references/sole-trader.md), [ess.md](references/ess.md) for shares or options from an employer, [small-business-cgt.md](references/small-business-cgt.md) when a business or business asset was sold.

**Settle residency first** where the person arrived, left, or spent significant time outside Australia during the year — [residency.md](references/residency.md). It decides what is taxed at all, so it is not a section like the others; a wrong answer here invalidates every figure below it.

**Done when** every section on the list above is marked in or out, and each "in" section names the documents that will support it — every one of those documents not already in hand opening an Outstanding entry.

## 3. Reconcile the prefill

Ask the user to download their prefill report from myTax, plus their income statement(s), bank interest, dividend and distribution statements, private health statement, and any share or crypto disposal records.

Prefill is the ATO's copy of what third parties reported — it is a starting point, not the truth. Go through it line by line and give every line one of three outcomes:

- **Accepted** — matches the user's own record.
- **Corrected** — the user's record differs; write down both numbers and the reason. Common causes: a joint account reported in full to one holder, a dividend reinvestment plan, a bank reporting gross before withholding.
- **Missing** — income the user knows about that prefill does not show. Cash work, foreign income, crypto disposals, and a second employer that has not finalised are the usual suspects. Missing income is the user's responsibility regardless of prefill.

Then check the reverse direction: income the user has that has no prefill line at all.

**Done when** every prefill line carries one of the three outcomes, every correction has a written reason, and the user has confirmed there is no income outside the reconciled set. Where prefill is still filling in, record what is expected to land and from whom as Outstanding, and reconcile again when it arrives — the second pass covers only the new lines.

## 4. Income

Work section by section through the sections marked in at step 2, using the figures from the ATO and the branch references for investments, rent, and business.

Two things people get wrong on the income side: an income statement must be **Tax ready** before its figures are final, and reportable fringe benefits and reportable employer super contributions are not taxable income but do feed the income tests that drive offsets, the Medicare levy surcharge, and HELP repayments.

**Done when** every income section marked in has a figure, and each figure traces to a named document or a written calculation.

## 5. Deductions — nexus, apportionment, substantiation

Open with **batch 2** of [interview.md](process/interview.md), the fixed deduction scan, and **batch 3** for any method choice it raises. Asking the same categories every run is what stops a quiet year of under-claiming.

Every claim then passes three tests, in order. This is where a self-lodger both loses money by under-claiming and gets into trouble by over-claiming, so run all three on every claim rather than eyeballing the plausible ones.

**Nexus** — the expense was incurred in earning assessable income. Ask what income this expense produced. "It relates to my field" or "my employer likes it" is not nexus. Getting to work is not nexus; travelling between two workplaces is. Conventional clothing is not nexus; a compulsory uniform or protective gear is.

**Apportionment** — the deductible fraction is the work-use fraction, and the private fraction is not deductible. A claim with no stated fraction is a claim of 100%, which must be defensible. A phone, a laptop, a car, and a home internet connection are almost never 100%. The fraction needs a basis: a logbook, a four-week diary, an itemised bill.

**Substantiation** — the record that proves the expense and the fraction. Usually a receipt; for some claims a diary or logbook as well.

A claim failing a test is dropped, or cut back to the portion that passes. Carry the outcome of all three tests into the worksheet beside the claim.

**The $300 rule** is a record-keeping concession, not an allowance: if total work-related expenses come to $300 or less you need records showing how you worked the claim out, and above $300 you need written evidence for **every** claim — not merely the amount above $300. Either way the expense must have been real and must pass all three tests. Claiming $300 you did not spend is a false statement.

Four categories sit **outside** the $300 total and carry their own evidence rules: car expenses, meal allowance expenses, award transport payments, and travel allowance expenses. Do not count them toward the threshold when deciding whether it has been crossed.

[deductions.md](references/deductions.md) has the catalogue: car, travel, clothing and laundry, self-education, working from home, tools and equipment, and the rest — with the method choices and what each one needs as evidence.

**Done when** every claim in the worksheet records nexus, apportionment fraction, and substantiation, and every claim that failed a test is either dropped or reduced.

## 6. Offsets, Medicare, adjustments

- **Private health insurance** — enter from the statement; the rebate tier depends on income and age, and getting the tier wrong at the insurer means a reconciliation here.
- **Medicare levy surcharge** — applies if income for surcharge purposes is over the threshold without an appropriate level of hospital cover, and it uses a broader income measure than taxable income.
- **Medicare levy reduction or exemption** — low income, or a category exemption such as a Medicare entitlement statement.
- **Offsets** — seniors and pensioners, zone or overseas forces, foreign income tax offset, small business income tax offset. Low and middle income offsets change between years; check what exists for this year rather than assuming.
- **Adjustments** — part-year tax-free threshold, working holiday maker status, government super contributions.
- **Earlier-year tax losses** and **spouse details** if applicable.

**With a spouse**, the first four of those run off combined income rather than the person's own — see [couples.md](references/couples.md). Both taxable incomes must be settled before this step is finalised on either return.

**Done when** each of the above is applied with its current-year figure, or ruled out with a reason — and, for a couple, the same figures reconcile against the other spouse's worksheet.

## 7. Write the worksheet

Copy [WORKSHEET.md](templates/WORKSHEET.md) and fill it. It follows the myTax section order so the user can work top to bottom through the real screens.

**Done when** every myTax label the return touches has a number, a working, and a source document — or reads `TBC` against a matching Outstanding entry — and the worksheet totals to an estimated refund or bill, marked provisional while anything is outstanding.

## 8. Pre-lodge review

Read the finished worksheet back against these:

- **The Outstanding register is empty and no label reads `TBC`.** Until then the return is not lodgeable, and this is the check to report when the user asks whether they can lodge yet.
- **For a couple**, every joint item and every family-income figure agrees with the spouse's worksheet.
- Every income statement is **Tax ready**, and every prefill line was reconciled at step 3.
- No deduction is a round number standing in for a real one.
- Deductions are proportionate to the income that generated them, and the user could explain each one to the ATO in a sentence.
- Bank details for the refund are current.
- Personal super contributions claimed have an acknowledged notice of intent from the fund — without it the deduction is denied, and it cannot be fixed after lodging.
- HELP, VSL or other study loan balances are reflected.
- The user has a folder holding every document the worksheet cites, ready for five years.

Then hand over: the user logs in to myGov, opens myTax, enters the worksheet, and lodges. Tell them the estimate myTax shows should match the worksheet's, and that a difference means a label went in wrong — worth finding before they submit.

**Done when** every check above passes or is explicitly waived by the user, and the user has the worksheet and the document folder in hand.
