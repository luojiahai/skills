# Skills For The Boring Bits

[![skills.sh](https://skills.sh/b/luojiahai/skills)](https://skills.sh/luojiahai/skills)

Agent skills for the life admin nobody else is going to do for you. They don't act on your behalf. They read, reconcile, compute and show their working, and you check it and press the button yourself.

What's here right now: a Douyin account archiver, and an X (Twitter) one.

## Quickstart

Install with the skills.sh CLI, into whichever agents you use:

```bash
npx skills@latest add luojiahai/skills
```

Pick the skills you want and the agents to install them on, then type the skill's name — `/douyin-downloader`, `/x-downloader`. None of these start on their own.

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

Two ways to install, two philosophies:

- **[skills.sh](https://skills.sh/luojiahai/skills)** copies the skills into your project, so you can hack on them and make them your own.
- **The plugin** keeps them as a read-only, always-current bundle you don't edit — best when you want the set to work and to follow along as it changes.

## Skills

You type them; they never start on their own. Full entries, including what each one costs you, are in the [catalogue](./skills/README.md).

- **[douyin-downloader](./skills/douyin-downloader/SKILL.md)** — download every video from a Douyin account, or a single video; re-runs fetch only what's new.
- **[x-downloader](./skills/x-downloader/SKILL.md)** — download the images, videos and GIFs an account has posted on X (formerly Twitter), or a single post.

Both run on your own signed-in session and archive to your own disk — read the catalogue before you point them at anything.

## Maintenance

Best effort. Issues are read; fixes land when they land.

## Licence

[MIT](LICENSE).
