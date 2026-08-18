# Skills For The Boring Bits

[![skills.sh](https://skills.sh/b/luojiahai/skills)](https://skills.sh/luojiahai/skills)

Agent skills for the life admin nobody else is going to do for you. They don't act on your behalf. They read, reconcile, compute and show their working, and you check it and press the button yourself.

What's here right now: one archiver, for Douyin and X (formerly Twitter) accounts.

## Quickstart

Install with the skills.sh CLI, into whichever agents you use:

```bash
npx skills@latest add luojiahai/skills
```

Pick the skills you want and the agents to install them on, then type the skill's name. None of them start on their own.

## Install as a Claude Code plugin

These skills also ship as a native [Claude Code plugin](https://code.claude.com/docs/en/plugins). Instead of copying editable files into your project, the plugin installs the whole set as a managed bundle that updates when I ship a new version — you subscribe rather than fork.

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

Two ways to install, two philosophies:

- **[skills.sh](https://skills.sh/luojiahai/skills)** copies the skills into your project, so you can hack on them and make them your own.
- **The plugin** keeps them as a read-only bundle you don't edit, updated when I ship — best when you want the set to work as shipped rather than to own it.

## Skills

Full entries, including what each one costs you, are in the [catalogue](./skills/README.md).

- **[archiver](./skills/published/archiver/SKILL.md)** — archive a social account's posts to your own disk. It covers **Douyin** (every video an account has posted) and **X, formerly Twitter** (the images, videos and GIFs). You give it a profile URL; the URL says which platform, and you are never asked. Re-runs fetch only what's new, and it downloads and runs its own pinned copies of the tools it needs rather than asking you to install any.

It runs on your own signed-in session and archives to your own disk — read the catalogue before you point it at anything.

## Maintenance

Best effort. Issues are read; fixes land when they land.

## Licence

[MIT](LICENSE).
