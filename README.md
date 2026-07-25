# Skills For The Boring Bits

[![skills.sh](https://skills.sh/b/luojiahai/skills)](https://skills.sh/luojiahai/skills)

Agent skills for the life admin nobody else is going to do for you — tax, receipts, the shopping, the renewals. They don't act on your behalf. They read, reconcile, compute and show their working, and you check it and press the button yourself.

First one out: an Australian individual tax return.

> [!IMPORTANT]
> `lodge-au-tax-return` is not tax advice, and its author is not a registered tax agent. It lodges nothing and never touches your ATO account — you hold the myGov credentials, you check every figure, you lodge. The full declaration is in the skill's [What this is, and what it is not](./skills/finance/lodge-au-tax-return/SKILL.md).

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

TODO

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
