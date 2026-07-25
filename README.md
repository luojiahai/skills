# Skills For Doing Your Own Money Admin

[![skills.sh](https://skills.sh/b/luojiahai/skills)](https://skills.sh/luojiahai/skills)

Agent skills for the paperwork you'd rather not hand to someone else — starting with an Australian individual tax return. They don't file anything on your behalf. They reconcile, reason and show their working, and you check every number and lodge it yourself.

> [!IMPORTANT]
> `lodge-au-tax-return` is not tax advice, and its author is not a registered tax agent. It lodges nothing and never touches your ATO account — you hold the myGov credentials, you check every figure, you lodge. The full declaration is in the skill's [What this is, and what it is not](./skills/finance/lodge-au-tax-return/SKILL.md).

I write about these at [luojiahai.com](https://luojiahai.com) ([RSS](https://luojiahai.com/feed)).

## Quickstart

Install with the skills.sh CLI, into whichever agents you use:

```bash
npx skills@latest add luojiahai/skills
```

Pick the skills you want and the agents to install them on, then type the skill's name — `/lodge-au-tax-return`. None of these start on their own.

## Install as a Claude Code plugin

Prefer a plug-and-play install you don't maintain by hand? These skills also ship as a native [Claude Code plugin](https://code.claude.com/docs/en/plugins). Instead of copying editable files into your project, the plugin installs the whole set as a managed bundle that updates when I ship a new version — you subscribe rather than fork.

Inside Claude Code:

```
/plugin marketplace add luojiahai/skills
/plugin install luojiahai-skills@luojiahai
```

Or from your shell:

```bash
claude plugin marketplace add luojiahai/skills
claude plugin install luojiahai-skills@luojiahai
```

> [!NOTE]
> This used to be one plugin per skill. If you installed `lodge-au-tax-return@luojiahai`, uninstall it and install `luojiahai-skills@luojiahai` instead — the old name no longer resolves.

Two ways to install, two philosophies:

- **[skills.sh](https://skills.sh/luojiahai/skills)** copies the skills into your project, so you can hack on them and make them your own.
- **The plugin** keeps them as a read-only, always-current bundle you don't edit — best when you want the set to work and to follow along as it changes.

## Why These Skills Exist

Money admin is the worst possible fit for a confident, fluent agent. The work is mostly arithmetic and lookup, which makes it look like a natural handoff — but the cost of a wrong number isn't a failing test, it's a penalty two years later, and every figure has to survive a question that arrives long after the conversation is gone. These skills exist to fix four specific ways that goes wrong.

### #1: The Agent Made The Number Up

**The Problem**. Ask an agent for a tax offset threshold and it will tell you, instantly and plausibly, a number from its training data. Thresholds move every income year. A figure that was right two years ago is indistinguishable, in the answer, from one that's right today — and it arrives with exactly the same confidence.

**The Fix** is that no rate, threshold or cap is ever recalled. [`lodge-au-tax-return`](./skills/finance/lodge-au-tax-return/SKILL.md) fetches every one of them from ato.gov.au during the run, and records the URL it came from and the date it was fetched beside the figure it produced. With no way to reach the ATO, the skill says so and stops rather than answering from memory. That's also why it survives an income year rolling over: nothing is baked in to go stale.

### #2: Every Figure Needs Its Working, Not Just Its Answer

**The Problem**. An agent hands you a deduction total. Eighteen months later the ATO asks how you arrived at it. The conversation is gone, the reasoning with it, and what you're left with is a number you can't defend.

**The Fix** is a **worksheet** as the deliverable — one Markdown file per person, in a directory you nominate, which is both the output and the resume point:

| myTax section | Label | Amount | Working | Source document |
|---|---|---|---|---|
| Salary, wages | | | | |
| Interest | | | | |
| Dividends — franked | | | | |

Empty here; filled in with you, section by section, in myTax's own order. Every deduction has to pass three tests — nexus, apportionment, substantiation — and the working for each is written down beside the amount, along with the document it came from. The number you type into myTax and the reason it's that number live in the same row.

This matters more than it looks. The penalty safe harbour that covers a registered agent's client doesn't extend to someone lodging their own return, however carefully it was prepared. What stands in its place is having taken reasonable care — and the working and the receipts are what show it.

### #3: You Lodged With Gaps Still Open

**The Problem**. A return is assembled over weeks, often across two people, in sessions that get interrupted. Somewhere in there is a figure you meant to check and a receipt you meant to find. The pressure to just submit is what turns those into an amendment.

**The Fix** is that anything unresolved reads `TBC` and **blocks lodgement** until it's settled. The worksheet opens with an Outstanding register that decides whether the return can be lodged at all. And because the file is the resume point, picking the work back up in three weeks starts with being told exactly where the return stands and what it's waiting on — not with reconstructing it.

### #4: An Opinion Where A Binding Answer Was Available

**The Problem**. Some questions genuinely have no clear answer — is this contractor income or employment income, is this trip deductible, was this really your main residence. An agent will happily produce a confident view. That view protects you from nothing.

**The Fix** is to route genuine uncertainty to an ATO **private ruling** — made on your facts, and binding on the ATO where it applies to you — rather than to an opinion. Knowing which questions to stop on is most of the value here; the skill is built to stop rather than to sound sure.

### Summary

The through-line is that the agent does the legwork and never holds the risk. It reads, reconciles, computes and documents. You check it, and you lodge it.

## Reference

Skills split on one axis — who can invoke them. **User-invoked** skills are reachable only when you type them (e.g. `/lodge-au-tax-return`); their job is to orchestrate. **Model-invoked** skills can be invoked by you *or* reached for automatically by the agent when the task fits.

### Finance

The money admin you do yourself.

**User-invoked**

- **[lodge-au-tax-return](./skills/finance/lodge-au-tax-return/SKILL.md)** — Prepare an Australian individual tax return for self-lodgement in myTax: reconcile the ATO prefill, test every deduction for nexus, apportionment and substantiation, and produce a label-by-label worksheet you check and type in yourself. *Not tax advice — see the callout above.*

  *Verified against the 2026 income year.* An older stamp doesn't mean stale figures — every rate and threshold is fetched from ato.gov.au on each run. It means the myTax walkthrough may lag a section that has been renamed or added since.

  **You'll need** a myGov account linked to the ATO (you download your own prefill report, and you lodge), working web access, and an Australian *individual* return — a trust, company, SMSF or partnership return is a separate lodgement this doesn't do, though the individual return of someone who's a beneficiary, partner or shareholder of one **is** in scope.

  **When to run it.** Prefill fills in through July as employers, banks, funds and health insurers report, and is usually complete in the first half of August. Building the worksheet earlier is fine; lodging against incomplete prefill earns an amendment later. Self-lodgers must lodge by **31 October**.

## Maintenance

Best effort. Issues are read; fixes land when they land.

- **Issues about a skill are welcome** — a myTax section that has been renamed, a dead ATO link, a category the interview should have asked about.
- **Issues about your own tax position are not.** That is applying the law to your facts, and the skill already points at the better answer: an ATO private ruling, made on your facts and binding on the ATO, which no opinion is.
- **Pull requests are welcome where reviewing one needs no tax judgement** — a 404ing ATO URL, a renamed section, a typo, a broken link.
- **The tax content is frozen to PRs** — the interview batches, the nexus/apportionment/substantiation reasoning, the branch references. Open an issue instead.
- **No pull request may bake in a rate or threshold.** It looks like a helpful contribution and it silently destroys the property that lets this survive across income years.

## Licence

[MIT](LICENSE).
