# Tax return worksheet — <name>, income year ended 30 June <YYYY>

| | |
|---|---|
| **Status** | in progress / ready to lodge / lodged <date> |
| **Last updated** | <date> |
| **Outstanding** | <n> items — see below |
| **Steps done** | <n> |
| **Resume at** | step <n> |
| **Residency** | resident / foreign resident / part-year <period> — or `TBC` pending the travel record |
| **Spouse** | <name> — `../<spouse>/worksheet.md`, shared figures in `../joint/shared.md`, or *none this year* |

This file is the authority for what goes into myTax. Every figure carries a working and a source. A figure reading `TBC` is waiting on something in the Outstanding register and **must not be entered into myTax**.

Not tax advice, and not prepared by a registered tax agent. Every figure below is yours to check before it goes into myTax — the penalty protection that covers a registered agent's client does not extend to a self-lodger.

---

## Outstanding

The register that decides whether this return can be lodged. Empty means ready.

| # | Waiting on | Feeds | From whom | Expected |
|---|---|---|---|---|
| 1 | | | | |

Cleared items, kept so the next session knows they were dealt with:

| Waiting on | Resolved | How |
|---|---|---|

---

## Documents

One row per document the return needs, added as each is named and completed as each is filed.

| Document | Feeds | Asked on | Copy filed |
|---|---|---|---|

---

## Interview answers

What was asked and what came back.

| Batch | Asked on | Selected | Not selected |
|---|---|---|---|
| 0 Spouse | | | |
| 1 Situation scan | | | |
| 2 Deduction scan | | | |
| 3 Method choices | | | |
| 4 Pre-worksheet | | | |

Prose confirmations, recorded verbatim:

| Question | Answer | Asked on |
|---|---|---|
| Where should this folder live for the long run? | | |
| Any income we have not talked about? | | |
| Per claim — what was spent, and is there a record I have not seen? | | |
| Happy to lodge on these numbers? | | |

---

## Prefill reconciliation

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

**For a couple**, every figure above that either return also claims is copied from `../joint/shared.md`.

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
- [ ] Every line of the readiness gate in `../joint/shared.md` passes (or no spouse this year)
- [ ] Every income statement is Tax ready
- [ ] Every prefill line reconciled
- [ ] No deduction is a round number standing in for a real one
- [ ] Notice of intent for personal super contributions acknowledged by the fund
- [ ] Bank details for refund current
- [ ] Study loan balance reflected
- [ ] **Bundle complete** — every document cited above is a copy under `bundle/`, listed in its section's index
- [ ] The bundle is at the durable path confirmed at step 1, and records are kept five years from lodgement
