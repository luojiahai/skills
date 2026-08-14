# Employee share schemes

An **ESS interest** is a share, a stapled security, or a *right* to acquire one (an option, RSU, or performance right) obtained through employment. The discount — the difference between what the interest was worth and what was paid for it — is **ordinary income**, not a capital gain. The capital gain comes later, on sale, and keeping those two events apart is the whole job.

myTax puts this at **income → other income → employee share schemes**. Tick it at step 2 whenever the person mentions options, RSUs, shares from work, a vesting event, or an equity plan, whether or not they sold anything.

## Start from the ESS statement

The employer must provide an **Employee share scheme statement** showing the discounts for the year, and the ATO gets the same data. Get it before doing anything else — this section cannot be reasoned out from a broker account.

Two gaps to check for, because the statement will not show them:

- **Start-up concession interests are not on the statement** and must not be entered in this section at all (see below).
- A **foreign** employer may issue nothing resembling an ESS statement. The income is still assessable; reconstruct it from plan documents and vesting confirmations.

## Which regime

**Taxed-upfront scheme** — the discount is assessable in the year the interest was acquired. A **reduction of up to $1,000** applies where the relevant amounts on the return are **$180,000 or less**; myTax calculates this, so do not apply it by hand in the worksheet — record the discount gross and note that myTax will reduce it.

**Tax-deferred scheme (deferral scheme)** — nothing is assessed at grant. The discount is assessed at the **deferred taxing point**, valued as *market value at that point minus the cost base*.

**Start-up concession** — for eligible interests in an eligible start-up, the discount is not taxed under the ESS rules at all. The whole outcome is CGT on disposal. One detail that is easy to miss and worth real money: for the 50% CGT discount, the ownership period of a share acquired by exercising a right runs from **when the right was acquired**, not when it was exercised — so the 12 months may already be served at exercise.

## The deferred taxing point

The earliest of these events. Work through them in order and write down which one fired and on what date.

**For a share:**
1. There is no real risk of forfeiture and the scheme no longer genuinely restricts disposal.
2. 15 years after acquisition (7 years for interests acquired before 1 July 2015).

**For a right:**
1. There is no real risk of forfeiting the right and the scheme no longer genuinely restricts its disposal.
2. The right is exercised, there is no real risk of forfeiting the resulting share, and the scheme no longer restricts disposal of that share.
3. 15 years after the right was acquired.

**Ceasing employment is no longer a deferred taxing point** for employment ending on or after 1 July 2022 — the taxing point becomes the earliest of the remaining events, and this applies to interests under deferral schemes regardless of when they were acquired. Anyone applying pre-2022 knowledge, including some employer plan documents, will get this wrong.

**The 30-day rule** — where the interest is disposed of within 30 days *after* the deferred taxing point, the taxing point moves to the date of that disposal. Sell-to-cover and same-day-sale arrangements land here constantly, and it usually simplifies matters: the discount is then measured at the actual sale price, so there is no separate small capital gain.

## The cost base, and the two things it resets

Once the discount has been assessed as income, the interest is treated as **re-acquired immediately after the taxing point**. That single deeming does two things, and skipping either one costs real money.

**It resets the cost base.** For a deferral scheme, cost base = **market value at the deferred taxing point**. For a taxed-upfront scheme, cost base = **market value on the date of acquisition**. Either way, not zero and not the exercise price.

Someone who takes the broker's cost basis — often nil, or the strike price — pays income tax on the discount and then capital gains tax on the same amount **again**. Check this on every ESS disposal and write the derivation into the worksheet:

```
cost base = market value per share at the taxing point × number of shares
          + brokerage on acquisition and disposal
```

**It also resets the acquisition date** — and this one is missed even more often. For a deferral scheme the 12-month clock for the **50% CGT discount restarts at the deferred taxing point**, not at grant and not at the original offer. Shares held on paper for four years but vesting three months ago carry **no** discount on sale. Never date the holding period from the grant.

The **start-up concession runs the opposite way**: for a share acquired by exercising a right, the acquisition date for discount purposes is the date the **right** was acquired, so the 12 months may already be served at exercise. Two schemes, opposite clocks — establish which one applies before touching the discount.

### Start-up cost bases

- A **share** acquired under the concession: market value of the share when acquired.
- A **right** that is sold as a right: what was paid to acquire it, plus the cost of selling it.
- A **right exercised** and the resulting share sold: add the exercise amount to the cost base.

Where a sale is a sell-to-cover, only the *retained* shares carry forward a cost base; the sold ones are dealt with under the 30-day rule or as a disposal in their own right.

## Working a case

1. Get the ESS statement, and the plan's vesting and disposal-restriction terms.
2. Classify each tranche: taxed-upfront, deferral, or start-up.
3. For each deferral tranche, identify the taxing point event and date, then the market value on that date.
4. Apply the 30-day rule where a disposal followed within 30 days.
5. Enter the discount at the ESS section, gross of the $1,000 reduction.
6. For every disposal, run it as a CGT event in [investments.md](investments.md) with the cost base derived above.
7. Where the person was a foreign resident for part of the vesting period, the discount may need apportioning — and a foreign income tax offset may apply if another country taxed the same event.

Where the plan terms make "real risk of forfeiture" or "genuine restriction on disposal" genuinely arguable, that is a private ruling question, not a judgement call to make quietly in a worksheet.
