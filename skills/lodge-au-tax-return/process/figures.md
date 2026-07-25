# Current-year figures — where each one lives

Fetch every figure on the run. Never carry a rate from memory or from a previous run's notes.

`YYYY` below is the income year ending 30 June (the year ended 30 June 2026 is `2026`).

## Fetching

```bash
curl -sS -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" "<url>"
```

`WebFetch` returns 403 for ato.gov.au. ATO's own search box is a JavaScript app and does not respond to curl.

**When a URL 404s** — and deep ATO URLs are reorganised often — run `WebSearch` with `allowed_domains: ["ato.gov.au"]` for the page title, then curl the URL it returns. Confirm a 200 before trusting a page; a 404 body still parses as text and will look like a missing figure rather than a broken link.

## Stable entry points

These held at the last check. Everything else is best reached by search.

| Entry point | URL |
|---|---|
| myTax instructions for the year | `https://www.ato.gov.au/individuals-and-families/your-tax-return/instructions-to-complete-your-tax-return/mytax-instructions/YYYY` |
| Rates and codes index | `https://www.ato.gov.au/tax-rates-and-codes` |
| Resident income tax rates | `https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents` |
| Study and training loan thresholds | `https://www.ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds` |
| Key super rates and thresholds | `https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds` |
| Capital gains tax | `https://www.ato.gov.au/individuals-and-families/investments-and-assets/capital-gains-tax` |
| Medicare levy surcharge thresholds | `https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates` |

The myTax instruction tree is the most reliable source, because it is republished per year and mirrors the screens the user is filling in. Its shape:

```
YYYY/income/{salary-wages-...,australian-income-or-losses-from-investments-or-property,
             australian-super-or-annuity-payments,managed-fund-or-trust-distributions,
             sole-trader-and-business-income-...,foreign-income,taxable-payments-and-grants,
             other-income,amounts-that-you-do-not-pay-tax-on}
YYYY/income/australian-income-or-losses-from-investments-or-property/{interest,dividends,rent,capital-gains}
YYYY/deductions/{claiming-deductions,work-related-expenses,
                 deductions-for-donations-investments-and-managing-your-tax-affairs,other-deductions}
YYYY/deductions/work-related-expenses/{work-related-car-expenses,work-related-travel-expenses,
                 work-related-clothing-and-laundry-expenses,work-related-self-education-expenses,
                 other-work-related-expenses}
YYYY/{tax-offsets,medicare-and-private-health-insurance,adjustments,
      tax-losses-of-earlier-income-years,how-to-personalise-your-tax-return}
```

## Figures to pull

Pull only the ones the return actually uses.

| Figure | Where |
|---|---|
| Income tax rates and brackets | Resident income tax rates |
| Medicare levy rate; low-income reduction thresholds | myTax `YYYY/medicare-and-private-health-insurance` |
| Medicare levy surcharge tiers | MLS thresholds page |
| Private health insurance rebate tiers | myTax `YYYY/medicare-and-private-health-insurance/private-health-insurance` |
| Study loan repayment thresholds and rates | Study and training loan thresholds |
| Cents per kilometre rate; the 5,000 km cap | myTax `YYYY/deductions/work-related-expenses/work-related-car-expenses` |
| Working-from-home fixed rate (cents per hour) | Search "fixed rate method working from home" |
| Concessional and non-concessional contribution caps | Key super rates and thresholds |
| Instant asset write-off threshold | Search "instant asset write-off" — this one changes by legislation mid-year, so read the eligibility dates carefully |
| Depreciation rates for a specific asset | Search "effective life" plus the asset |
| CGT discount percentage; indexation availability | Capital gains tax |
| Foreign exchange rates for foreign income | Search "foreign exchange rates" — use the ATO's published annual average or the daily rate, consistently |

## Recording a figure

Every figure that lands in the worksheet carries the URL it came from and the date fetched. When the user or the ATO later questions a number, that line is the answer.
