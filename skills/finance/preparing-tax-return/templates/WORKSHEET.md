# Tax return worksheet — <name>, income year ended 30 June <YYYY>

| | |
|---|---|
| **Status** | in progress / ready to lodge / lodged <date> |
| **Last updated** | <date> |
| **Outstanding** | <n> items — see below |
| **Steps done** | 2 personalise · 3 bundle · 4 prefill · 5 income · 6 deductions · 7 offsets · 8 worksheet · 9 review |
| **Resume at** | step <n> |
| **Bundle** | `./bundle/` — see the Bundle table below |
| **Inbox** | `./inbox/` — <empty, or n documents waiting to be filed> |
| **Spouse** | <name> — `../<spouse>/worksheet.md`, shared figures in `../joint/shared.md`, or *none this year* |

This file is the saved state of the return. Reopening it is how work resumes — read the Outstanding register first, and leave settled sections alone.

This file is also the authority for what goes into myTax. Every figure carries a working and a source. Where a rate was used, the URL and fetch date are in **Rates used**. A figure reading `TBC` is waiting on something in the Outstanding register and **must not be entered into myTax**.

Identity numbers are not recorded here. A TFN, a full account number or a health fund member number stays on the document in `bundle/` that already carries it.

Not tax advice, and not prepared by a registered tax agent. Every figure below is yours to check before it goes into myTax — the penalty protection that covers a registered agent's client does not extend to a self-lodger.

---

## Outstanding

The register that decides whether this return can be lodged. Empty means ready.

| # | Waiting on | Feeds | From whom | Place looked in | Expected | Chased |
|---|---|---|---|---|---|---|
| 1 | | | | | | |

Cleared items, kept so the next session knows they were dealt with:

| Waiting on | Resolved | How |
|---|---|---|

---

## Bundle

One row per section folder on disk. The section's `index.md` is the read record — what each document said; this worksheet is what the return claims.

| Section | Index | Documents | Read back and confirmed |
|---|---|---|---|
| income | `bundle/income/index.md` | | |
| | | | |

---

## Interview answers

What was asked and what came back, so a resumed session re-asks nothing. Batches are from `interview.md`.

| Batch | Asked on | Selected | Not selected |
|---|---|---|---|
| 0 Records and spouse | | | |
| 1 Situation scan | | | |
| 2 Deduction scan | | | |
| 3 Method choices | | | |
| 4 Pre-worksheet | | | |

Where the records live, and the place behind each answer:

| Place named | Path, link or folder | Reached with | Read on |
|---|---|---|---|

Prose confirmations, recorded verbatim:

| Question | Answer | Asked on |
|---|---|---|
| Any income we have not talked about? | | |
| Happy to lodge on these numbers? | | |

---

## Prefill reconciliation

Reconciled against the section indexes, not by re-reading the documents.

| Prefill line | Prefill | Ours | Outcome | Reason |
|---|---|---|---|---|
| | | | accepted / corrected / missing | |

Income with no prefill line at all:

| Source | Amount | Document |
|---|---|---|

---

## Income

| myTax section | Label | Amount | Working | Source document |
|---|---|---|---|---|
| Salary, wages | | | | |
| Interest | | | | |
| Dividends — unfranked | | | | |
| Dividends — franked | | | | |
| Dividends — franking credit | | | | |
| Managed fund / trust distributions | | | | |
| Rent | | | | |
| Capital gains | | | | |
| Business income | | | | |
| Foreign income | | | | |
| Other income | | | | |
| **Total income** | | | | |

---

## Deductions

Every row states nexus, apportionment, and substantiation. A row missing any of the three is not ready to lodge.

| myTax section | Amount | Nexus — what income it earned | Apportionment — work-use % and its basis | Substantiation — the record in the bundle |
|---|---|---|---|---|
| D1 Car | | | | |
| D2 Travel | | | | |
| D3 Clothing and laundry | | | | |
| D4 Self-education | | | | |
| D5 Other work-related | | | | |
| Gifts or donations | | | | |
| Interest / dividend deductions | | | | |
| Cost of managing tax affairs | | | | |
| Personal super contributions | | | | |
| **Total deductions** | | | | |

Work-related total is **over / under $300** → *written evidence required for every claim / records of the calculation required.*

### Claims considered and dropped

| Claim | Test it failed | Why |
|---|---|---|

Recording these matters: it stops the same claim being re-litigated next year, and it shows the position was reasoned.

---

## Offsets, Medicare, adjustments

| Item | Value | Working |
|---|---|---|
| Private health insurance — rebate tier | | |
| Medicare levy | | |
| Medicare levy reduction or exemption | | |
| Medicare levy surcharge | | |
| Tax offsets | | |
| Adjustments | | |
| Earlier-year losses applied | | |
| Spouse details / income tests | | |

### Couple cross-check

*Couple only — where there is no spouse this year, this section reads as not applicable.*

Every figure in this table is copied from somewhere else: the total from `../joint/shared.md`, this return's share from the label rows above, the spouse's share from their worksheet. The table exists to catch a copy that drifted. Where a row does not sum, fix it in `shared.md` and re-copy — never in this table.

| Joint item | Total (`shared.md`) | This return's share | Spouse's share | Shares sum to total |
|---|---|---|---|---|
| Spouse taxable income | — | | | — |
| Family income (for MLS / rebate tier) | — | | | — |
| Joint account interest | | | | |
| Jointly owned property | | | | |
| Jointly held shares | | | | |

---

## Estimate

| | |
|---|---|
| Total income | |
| Total deductions | |
| **Taxable income** | |
| Tax on taxable income | |
| Medicare levy (+ surcharge) | |
| Less franking credits | |
| Less PAYG withheld | |
| Less offsets | |
| Study loan repayment | |
| **Estimated refund / amount owing** | |

**Provisional while anything is outstanding** — a `TBC` above means this number will move.

myTax will show its own estimate. It should match this one. A difference means a label went in wrong — find it before submitting.

---

## Rates used

| Rate | Value | Source URL | Fetched |
|---|---|---|---|

---

## Pre-lodge checks

- [ ] **Outstanding register empty; no label reads TBC**
- [ ] Readiness gate in `../joint/shared.md` passes (or no spouse this year)
- [ ] Every income statement is Tax ready
- [ ] Every prefill line reconciled
- [ ] No deduction is a round number standing in for a real one
- [ ] Notice of intent for personal super contributions acknowledged by the fund
- [ ] Bank details for refund current
- [ ] Study loan balance reflected
- [ ] **Bundle complete** — every document cited above is a copy under `bundle/`, listed in its section's index
- [ ] The bundle is somewhere that will still exist in five years
