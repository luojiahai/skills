# lodge-au-tax-return

A Claude Code skill for preparing an Australian individual tax return for self-lodgement in myTax. It reconciles your ATO prefill, tests each deduction for nexus, apportionment and substantiation, and produces a label-by-label worksheet — the number to type at each myTax label, the working behind it, and the document it came from — which you check and type in yourself.

*Verified against the 2026 income year.* An older stamp does not mean stale figures: every rate, threshold and cap is fetched from ato.gov.au on each run. It means the myTax walkthrough may lag a section that has been renamed or added since.

## What this is, and what it is not

This is not tax advice, and its author is not a registered tax agent. The skill lodges nothing and never touches your ATO account.

Four properties are the design, not a caveat:

- **You hold the myGov credentials and do the lodging.** Every number goes into myTax typed by you.
- **Every figure carries its working and the document it came from.**
- **Genuine uncertainty routes to an ATO private ruling** — binding on the ATO where it applies to you — rather than to an opinion.
- **Anything unresolved reads `TBC`** and blocks lodgement until it is settled.

One consequence to know before you start: the penalty protection that covers a registered tax agent's client does not extend to someone lodging their own return, however carefully it was prepared. What stands in its place is having taken reasonable care — and the working and the receipts are what show it.

## What you get

One Markdown file per person, in a directory you nominate, which is both the deliverable and the resume point:

| myTax section | Label | Amount | Working | Source document |
|---|---|---|---|---|
| Salary, wages | | | | |
| Interest | | | | |
| Dividends — franked | | | | |

Empty here; filled in with you, section by section, in myTax's own order. The full shape is [`templates/WORKSHEET.md`](templates/WORKSHEET.md): an Outstanding register that decides whether the return can be lodged yet, the prefill reconciliation line by line, the three tests each deduction has to pass, and every ATO figure used with the URL it came from and the date it was fetched.

## What you'll need

- **Claude Code.**
- **A myGov account linked to the ATO.** You download your own prefill report, and you lodge.
- **Working web access.** Every rate, threshold and cap is fetched from ato.gov.au at run time. There is no offline fallback: with no way to reach the ATO the skill says so and stops, rather than answering from memory.
- **An Australian individual return.** myTax lodges an individual return, so a trust, company, SMSF or partnership return is a separate lodgement this does not do. The individual return of someone who is a beneficiary, partner or shareholder of one **is** in scope — the distribution, share of net income or dividend flows through, and the skill handles it.

## Install

```sh
claude plugin marketplace add luojiahai/skills
claude plugin install lodge-au-tax-return@luojiahai
```

<details>
<summary>Other ways to install</summary>

With the `skills` CLI:

```sh
npx skills add luojiahai/skills --skill lodge-au-tax-return -y
```

Or by hand:

```sh
git clone https://github.com/luojiahai/skills.git luojiahai-skills
cp -r luojiahai-skills/skills/lodge-au-tax-return ~/.claude/skills/
```
</details>

Then run `/lodge-au-tax-return`. It does not start on its own — you type it.

**When to run it.** Prefill fills in through July as employers, banks, funds and health insurers report, and is usually complete in the first half of August. Building the worksheet earlier is fine; lodging against incomplete prefill earns an amendment later. Self-lodgers must lodge by **31 October**.

## Maintenance

Best effort. Issues are read; fixes land when they land.

- **Issues about the skill are welcome** — a myTax section that has been renamed, a dead ATO link, a category the interview should have asked about.
- **Issues about your own tax position are not.** That is applying the law to your facts, and the skill already points at the better answer: an ATO private ruling, made on your facts and binding on the ATO, which no opinion is.
- **Pull requests are welcome where reviewing one needs no tax judgement** — a 404ing ATO URL, a renamed section, a typo, a broken link.
- **The tax content is frozen to PRs** — the interview batches, the nexus/apportionment/substantiation reasoning, the branch references. Open an issue instead.
- **No pull request may bake in a rate or threshold.** It looks like a helpful contribution and it silently destroys the property that lets this survive across income years.

## Licence

[Apache-2.0](../../LICENSE), with a [NOTICE](../../NOTICE).
