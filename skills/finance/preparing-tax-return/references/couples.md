# Couples — two returns, prepared together

Australia has no joint return. Each spouse lodges their own, with their own income and their own deductions. But the two returns are wired to each other in four places, so preparing one to completion and then starting the other means reworking the first.

A **spouse** for tax purposes includes a de facto partner — someone the person lived with on a genuine domestic basis — and someone married but separated for part of the year. It is not limited to marriage, and the user may not think of their situation as being "a spouse" for tax. Ask about the whole year: a relationship that started or ended mid-year gets a **period** recorded, and the family thresholds are then applied for that part of the year.

## The four couplings

**1. Spouse details.** Each return names the other spouse and states their **taxable income**, plus their reportable fringe benefits, reportable employer super contributions, exempt pension income, and any trust distributions on which the trustee was taxed. This is the circular one: A's return wants B's taxable income and B's wants A's.

**2. Medicare levy surcharge.** For a couple, MLS is tested against the **family** income threshold, not the individual one — a higher threshold, so a couple can sit under it where one of them alone would not. The threshold rises for each dependent child after the first. Where family income is over the threshold, MLS applies to **each** spouse who did not hold an appropriate level of hospital cover for the year, and it applies to both if neither did.

**3. Private health insurance rebate.** The rebate **tier** for a couple is set by combined income, so both incomes are needed before either return's rebate is right. One policy statement usually covers the household; each spouse claims their share, and the split can be varied between them as long as the total does not exceed the policy. Getting the tier wrong at the insurer during the year is the usual cause of an unexpected reconciliation here.

**4. Medicare levy reduction and SAPTO.** Both use family income. The seniors and pensioners tax offset also allows an unused portion to transfer between spouses.

## Two things worth claiming that only exist for couples

- **Spouse super contributions tax offset** — where one spouse contributes to the other's super and the receiving spouse's income is low, the contributing spouse gets a tax offset. Check the current-year income cut-off and maximum offset before ruling it out; the thresholds move.
- **Government super co-contribution** — not a return label, but it is triggered by lodging: a low-income spouse who made a non-concessional contribution may receive a co-contribution automatically once the return is in. Worth mentioning, because it makes lodging worthwhile for a spouse who otherwise has little reason to.

## The order that avoids rework

The circularity resolves in one pass if the steps are done in this order across both returns at once:

1. Steps 2–3 on **both** returns — personalise, and build both bundles plus `joint/bundle/`, where a document naming both people lives.
2. **Settle every ownership split in `joint/shared.md`** off those joint documents, before either return works an income label. A split settled afterwards means correcting a label that has already gone in.
3. Steps 4–6 on both — prefill, income, deductions. Both taxable incomes now exist.
4. Step 7 on both — offsets, Medicare, private health. The combined and family income figures are worked here, once, in `shared.md`, and each return copies its share.
5. Steps 8–9 on both. Step 9 reads the readiness gate in `shared.md`: neither return is handed over until both taxable incomes are settled, both registers are empty, and both sets of shares reconcile.

If one return is blocked on an Outstanding document, the other's step 7 is blocked too — the gate holds both, which is the point of it being one gate rather than a check written into each worksheet.

## Joint assets must agree across the two worksheets

The most common couple error is two returns that split a joint item differently, which is visible to the ATO the moment both are lodged.

- **Joint bank accounts** — interest is split by ownership share, usually 50/50. Prefill often reports the whole amount against one holder; correct it on both returns so the halves add to the total.
- **Jointly owned rental property** — the split follows the **legal ownership share on the title**, and it applies to rent and to every expense alike. Joint tenants are 50/50; tenants in common take their stated shares. The split cannot be varied to put deductions with the higher earner, and a rental worksheet must appear on both returns with matching shares.
- **Jointly held shares** — dividends, franking credits, and any capital gain split the same way, and a disposal must appear on both returns.

The shares are recorded once, in `joint/shared.md`, and each worksheet copies its own from there. That is what stops the two returns splitting an item differently: there is one authority for the total and one for each share, so a cross-check that does not sum is fixed in `shared.md` and re-copied rather than argued between two files.

## What is not available

Employment income cannot be moved between spouses. Neither can a deduction that belongs to one of them, and neither can a capital loss — losses stay with the person who made them and carry forward on their own return. Where a couple wants to shift income-producing assets between them, that is a **CGT event for the transferring spouse**, priced at market value rather than at what changed hands — so a transfer for no consideration still produces a gain. Work it as a disposal in [investments.md](investments.md), and factor in stamp duty for property. The exception is a transfer under a court order or binding financial agreement on relationship breakdown, where a rollover can apply.

## Recording it

Each worksheet's header names the other spouse's worksheet and `../joint/shared.md`, so a session that opens one knows the other exists and where the shared figures live. Both are saved state: a resumed session reads the worksheet **and** `shared.md` before doing any work.

Where a figure on one return depends on the other — spouse taxable income, family income, the rebate tier — cite it as coming from `shared.md`, so a later change to a shared figure is traceable to every share copied from it.
