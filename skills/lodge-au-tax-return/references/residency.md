# Tax residency

Residency is the first question in the return, not a detail inside it. It decides what Australia taxes, whether there is a tax-free threshold, whether the Medicare levy applies, and which assets are inside the CGT net. Settle it before any figure goes in the worksheet — getting it wrong invalidates everything downstream.

**Tax residency is not immigration status, citizenship, or where the passport is from.** A citizen living abroad can be a foreign resident; someone on a temporary visa can be an Australian resident. Never infer one from the other.

## The four tests

A person is an Australian resident if they satisfy **any one**. The ATO's ruling is **TR 2023/1**; re-read the current residency tests page each run, because a replacement bright-line test has been proposed in the past without being enacted, and the page is the authority on what is law now.

1. **Resides test** — the primary test, decided on ordinary meaning: physical presence, intention and purpose, family and business ties, location of assets, and social arrangements. No single factor decides it. Someone who satisfies this test needs no other.
2. **Domicile test** — an Australian domicile makes the person a resident *unless* the ATO is satisfied their **permanent place of abode** is outside Australia. This is where most departing-Australia cases actually turn, and it is fact-heavy.
3. **183-day test** — physically present in Australia for more than half the income year, counting arrival and departure days, unless the usual place of abode is outside Australia *and* there is no intention to take up residence. Income year, not calendar year.
4. **Superannuation test** — Commonwealth public servants posted overseas who are contributing CSS or PSS members. Both schemes are closed to new members, so this is rare.

## What residency status changes

| | Australian resident | Foreign resident | Temporary resident |
|---|---|---|---|
| Taxed on | Worldwide income | Australian-source income only | Australian-source income; most foreign income exempt |
| Tax-free threshold | Yes | No — taxed from the first dollar | No |
| Medicare levy | Yes | No | Generally no |
| CGT scope | Worldwide assets | Taxable Australian property only | Taxable Australian property only |

A **temporary resident** holds a temporary visa, and neither they nor their spouse is an Australian resident within the meaning of the *Social Security Act*. Someone who was an Australian resident (and not a temporary resident) after 6 April 2006 cannot later become a temporary resident, even holding a temporary visa afterwards.

## Part-year residency

Where residency started or ended during the year, the tax-free threshold is apportioned:

```
threshold = $13,464 + ($4,736 × months resident ÷ 12)
```

Count the month of arrival as a full month. This goes at **adjustments → part-year tax-free threshold** in myTax. Confirm both figures on the current-year page before using them.

Income earned while a foreign resident is reported separately from income earned while a resident — do not merge the two periods into one figure.

## CGT when residency changes

Two deemed events, and they are the most valuable thing in this file.

**Becoming an Australian resident** — assets are taken to be **acquired at market value** on that day (deemed acquisition). This does not apply to pre-CGT assets acquired before 20 September 1985, or to taxable Australian property, which keep their ordinary cost base. Establishing that market value at the time is far easier than reconstructing it years later; if the person arrived recently, do it now.

**Ceasing to be an Australian resident** — assets are taken to be **disposed of at market value** on that day (deemed disposal, CGT event I1), except taxable Australian property. This can produce a real tax bill on shares nobody sold.

There is a **choice**: disregard all capital gains and losses on the deemed disposal, and the assets are instead treated as taxable Australian property until either a CGT event happens to them or the person becomes an Australian resident again. The trade is deferral against staying in the Australian CGT net on the whole future gain. Nothing is filed to make the choice — the way the return is prepared is the evidence, so **record the choice and its reasoning in the worksheet**.

### Taxable Australian property

What stays in the net for a foreign or temporary resident:

- Australian real property — house, apartment, commercial building, land
- An **indirect interest** in Australian real property — a 10%-or-more interest (with associates) in an entity whose assets are mainly Australian real property
- A mining, quarrying or prospecting right in Australia
- An asset used to carry on a business through a permanent establishment in Australia
- An option or right over any of the above

Australian shares are **not** taxable Australian property. That surprises people in both directions.

## Main residence exemption for foreign residents

**A foreign resident at the time of disposal generally gets no main residence exemption**, regardless of how long the property was their home, and regardless of having been a resident for most of the ownership period. Not reduced — none. The same disqualification takes away the **partial or apportioned** exemption and the **home first used to produce income** rule, so there is no fallback.

Being an Australian resident at disposal keeps the exemption intact, with one exception: property acquired through the **death of a foreign resident**.

The narrow relief is the **life events test**, available where the person has been a foreign resident for a continuous period of **six years or less** and a listed life event occurred (terminal illness, death of a spouse or young child, or a divorce or separation property settlement).

The practical consequence is one of the sharpest timing decisions in Australian tax: selling the family home *before* ceasing residency, versus after, can be the difference between a full exemption and a fully taxable gain. Raise it as soon as a departure is mentioned, not when the contract is signed.

## Foreign resident capital gains withholding

On the sale of Australian real property, the purchaser must withhold and remit **15%** of the sale price (or market value if not at arm's length). From 1 January 2025 the rate is 15% and **the previous $750,000 threshold is gone — it applies to property of any value**.

- An **Australian resident** seller avoids it by giving the purchaser an ATO **clearance certificate** before settlement. Apply early; it is free.
- A **foreign resident** seller can apply for a **variation** where 15% of the price exceeds the actual tax.
- Either way, the amount withheld is a **credit** claimed in the return for the year the contract was signed. It is not the final tax — the return reconciles it, and it is often a refund.

## Foreign income and the offset

An Australian resident declares **worldwide** income: foreign employment, foreign pensions, foreign rental, foreign interest and dividends, and gains on foreign assets. Convert using the ATO's published rates, consistently across the return.

The **foreign income tax offset** relieves double taxation. Up to **$1,000** the actual foreign tax paid can be claimed with no further calculation. Above $1,000 the **offset limit** must be worked out, and the claim is capped at the lower of the foreign tax paid and that limit. Foreign tax above the limit is **neither refunded nor carried forward** — it is simply lost, which is worth saying out loud before someone structures around it.

**A study or training loan follows the person overseas.** A HELP, VSL or AASL debt carries the **same repayment obligations abroad as at home**, based on worldwide income. Two concrete duties people miss:

1. Lodge an **overseas travel notification within 7 days of leaving**, where the intention is to reside overseas for **183 days or more in any 12 months**, and keep contact details current.
2. Each year, report **worldwide income** through ATO online services — or lodge a non-lodgment advice — by **31 October**.

Someone who left years ago and did neither has an accumulating compliance problem on top of indexation, and catching it up is worth doing in the same session as the return.

## Working holiday makers

Taxed under a separate rate scale from the first dollar, flagged at **adjustments → working holiday maker** in myTax. Residency status does not change those rates. Some nationalities have argued successfully that a tax treaty's non-discrimination article displaces the working holiday maker rates; where the person is from a treaty country and was a resident under the tests above, this is worth a private ruling rather than an assumption.

## Dual residency and treaties

Where another country also treats the person as its resident, a **tax treaty tie-breaker** decides which country has primary taxing rights — running through permanent home, centre of vital interests, habitual abode, then nationality. Treaties are country-specific and override the domestic tests.

This is the point in this skill where a **private ruling** earns its keep. Set out the facts — dates, homes, family, employment, assets in each country — and apply, rather than picking a residency answer and building a whole return on it.

## What to gather

Dates of every arrival and departure with a passport or travel history, visa type and dates, where the family lived, employment contracts in each country, where homes were owned or rented and whether they were let out, asset registers with market values at the residency change date, foreign tax returns and assessments, and any tax treaty between Australia and the other country.
