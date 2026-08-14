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

## Why These Skills Exist

TODO

## Reference

Skills split on one axis — who can invoke them. **User-invoked** skills are reachable only when you type them (e.g. `/douyin-downloader`); their job is to orchestrate. **Model-invoked** skills can be invoked by you *or* reached for automatically by the agent when the task fits.

**User-invoked**

- **[douyin-downloader](./skills/douyin-downloader/SKILL.md)** — download every video from a Douyin account, or a single video. Re-runs fetch only what is new, so an account can be re-archived later without pulling down what you already have.

  **It asks before it downloads.** It reads the account's video list first and tells you whose it is, where the videos would go, how many there are and how many you don't already have — then waits for your yes. Nothing is fetched until you give it.

  **Where they land.** `./downloads/` beside your project by default, or wherever you say: `/douyin-downloader <url> --downloads ~/data`. Give the same folder again next time and it picks up where it left off; give a different one and it starts a fresh archive there.

  **You'll need** [yt-dlp](https://github.com/yt-dlp/yt-dlp) and Node installed, and a one-off Douyin sign-in — a browser opens, you sign in, and the session is reused from then on. The skill's `setup.sh` checks the rest and tells you what's missing.

  **Why it needs a browser.** yt-dlp has no Douyin account extractor, and Douyin's feed API refuses unsigned requests, so the list of an account's videos can only be read out of a real page. The downloading itself is yt-dlp's.

  **It fetches; it doesn't publish.** Videos land in a folder on your own disk and nothing is uploaded anywhere. What you may keep, and what you may do with it, is between you, Douyin's terms and the uploader's copyright — that call is yours, not the agent's. The pauses between requests are deliberate: a run with them removed gets cut off partway.

- **[x-downloader](./skills/x-downloader/SKILL.md)** — download the media an account has posted on **X, formerly Twitter**, or a single post. Images, videos and GIFs; re-runs fetch only what's new.

  **It asks before it downloads.** Same shape as its Douyin sibling: it reads the account's posts first and tells you whose they are, where they'd go, how many there are and how many you don't already have — then waits for your yes.

  **One folder per post.** `posts/2024-03-11 - the first words of the post [1767…]/` holds that post's images and videos alongside a `text.txt` with the full text. Folders sort by date, so a year's archive still reads as a timeline.

  **It spends your X account.** This runs on your own signed-in session, read once out of your browser and then cached. Bulk archiving is what X's automation rules exist to catch, and the realistic failure isn't a failed download — it's your account getting rate-limited or locked. That's your call to make knowingly, not a surprise. Your session token also ends up in a file on your disk.

  **You'll need** [gallery-dl](https://github.com/mikf/gallery-dl) (`brew install gallery-dl`) and Node, plus a browser you're already signed in to X on. There's no sign-in step to automate — X's login can't be scripted, by this or anything else.

  **What it takes, and what it leaves.** The account's own media, including its replies to itself. Not retweets or quoted posts — those are someone else's uploads and filing them here would misattribute them. Not text-only posts. Likes and bookmarks are out of scope.

## Maintenance

Best effort. Issues are read; fixes land when they land.

## Licence

[MIT](LICENSE).
