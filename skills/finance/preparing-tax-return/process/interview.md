# The interview script

Ask these batches, in this order, with this wording. The point is that two runs three weeks apart present the same questions in the same shape, so the user recognises where they are and a resumed session can tell what was already answered.

Do not invent extra questions, reorder batches, merge them, or skip a batch because the answer seems obvious from something the user said earlier. A skipped batch is the agent guessing, and guessing is where the variance comes from. Follow-ups **within** a topic are fine and expected — the batches set the frame, not the ceiling.

## What goes in AskUserQuestion, and what does not

**AskUserQuestion** — closed choices from a known set: which income types apply, which deduction categories to explore, which calculation method to use. Options are fixed by this file.

**Plain conversation** — everything open-ended: names, dates, dollar amounts, employer names, what a document says, why an expense was incurred. Never wrap a free-text fact in multiple choice; the user ends up typing into "Other" every time.

Record every answer in the worksheet as it comes in. A resumed session reads the worksheet and re-asks nothing.

---

## Batch 1 — Situation scan (step 2)

Two calls of four questions. Ask both in full every run, including for a returning user — last year's answer is not this year's.

**Call 1A — income sources.** All `multiSelect: true` except `Equity`.

| Header | Question | Options |
|---|---|---|
| `Income` | Which of these did you have income from this year? | Salary or wages · Investments — interest, dividends, shares, crypto · Rental property · Business, ABN, or side income |
| `Other inc` | Any of these? | Super, annuity or pension payments · Managed fund or trust distributions · Foreign income or foreign assets · None of these |
| `Equity` | Did you get shares, options or RSUs from an employer? | Yes — some vested, were exercised, or were sold · Yes — but nothing vested yet · No · Not sure |
| `Cover` | Which of these apply? | Private health insurance · Study or training loan (HELP, VSL, SFSS) · Personal super contributions you want to claim · None of these |

**Call 1B — events during the year.** All `multiSelect: true` except `Records`.

| Header | Question | Options |
|---|---|---|
| `Sold` | Did you sell, gift or otherwise dispose of any of these? | Shares, crypto, or managed fund units · Property · A business or a business asset · Nothing |
| `Changes` | Did any of these happen during the year? | Changed, left or started a job · Married, separated, or started living with a partner · Had a baby, or dependants changed · None of these |
| `Overseas` | Any of these? | Lived or worked overseas · Moved to or from Australia during the year · Hold foreign bank accounts, property or shares · None of these |
| `Records` | How are your records for the year? | All together and organised · Scattered — I'll need to gather them · Mostly missing — we'll need to reconstruct |

**Routing.** `Equity` anything but "No" → load [ess.md](../references/ess.md), including for "Not sure", because a plan the person cannot describe is exactly the one that gets mis-costed. `Sold` → a business or business asset → load [small-business-cgt.md](../references/small-business-cgt.md) and test eligibility before treating the gain as ordinary CGT. `Overseas` → anything but "None" → load [residency.md](../references/residency.md) **before** working any income figure, since residency decides what is taxable at all. `Records` → anything but "organised" opens Outstanding entries at step 2 rather than discovering the gap at step 7.

## Batch 2 — Deduction scan (step 5)

One call, four questions, all `multiSelect: true`. Ask in full even when the person says "I don't really have deductions" — this batch is how under-claiming gets caught, and the categories people forget are exactly the ones they would not raise unprompted.

| Header | Question | Options |
|---|---|---|
| `Travel` | Did you spend your own money on any of these for work? | Driving your own car for work trips · Travel away from home overnight · Public transport, tolls, parking, flights · None of these |
| `Work costs` | And any of these? | Working from home · Tools, equipment, or devices · Uniform, protective gear, or laundry · Self-education, training or conferences |
| `Ongoing` | Any of these ongoing costs? | Union or professional association fees · Subscriptions, journals, licences, registrations · Income protection insurance paid outside super · Work phone or internet |
| `Other` | Last group — any of these? | Donations to charity · Last year's tax agent or tax software fee · Investment costs — margin loan interest, portfolio fees · None of these |

## Batch 3 — Method choices (step 5, conditional)

Fire only for a category the user selected in batch 2. Single-select, one call, as many of these as apply.

| Header | Question | Options |
|---|---|---|
| `Car method` | How should we work out your car expenses? | Work out both and take the larger (recommended) · Cents per kilometre — no receipts, capped at 5,000 km · Logbook — 12-week logbook, actual costs |
| `WFH method` | How should we work out your working-from-home costs? | Work out both and take the larger (recommended) · Fixed rate per hour — simpler, needs hours for the whole year · Actual cost — more work, sometimes more money |

Where the user picks "work out both", do exactly that and present the two numbers with the difference before entering one.

## Batch 4 — Before writing the worksheet (step 7)

One call, single-select, only where the situation raised it.

| Header | Question | Options |
|---|---|---|
| `Parcels` | You have several parcels of the same holding. Which did you sell? | Oldest first · Newest first · Let me pick per parcel — show me the tax effect of each |
| `Rebate` | How should the private health rebate be split between you and your spouse? | As the statement shows · Split evenly · Something else — I'll tell you |

## Confirmations that are never a multiple choice

Ask these in prose, every run, and record the answer verbatim in the worksheet:

1. "Is there any income this year that we have not talked about — cash work, a side platform, something sold at a gain, anything from overseas?" (step 3, after prefill)
2. "For each claim, can you tell me what you actually spent and what record you have?" (step 5, per claim)
3. "Are you happy to lodge on these numbers?" (step 8, before hand-off)
