# Skills

Nothing here starts on its own: each skill runs when you type its name.

Install them with the skills.sh CLI:

```bash
npx skills@latest add luojiahai/skills
```

The [root README](../README.md) covers the Claude Code plugin install too.

Skills live in one of two tiers. `published/` is what installs; `deprecated/` holds the retired ones, listed at the bottom of this page for the record.

## archiver

**[`/archiver`](./published/archiver/SKILL.md)** archives a social account's posts to your own disk. It covers two platforms: **Douyin**, where it archives every video an account has posted, and **X, formerly Twitter**, where it archives the images, videos and GIFs. You hand it a profile URL and the URL decides which — you are never asked, and a URL from anywhere else is refused by name rather than attempted. Re-runs fetch only what is new, so an account can be re-archived later without pulling down what you already have.

**It asks before it downloads.** It reads the account's post list first and tells you whose it is, where the posts would go, how many there are and how many you don't already have — then waits for your yes. Nothing is fetched until you give it.

**Or ask it what you already have.** `/archiver` on its own lists the accounts under the archives root — each with its nickname, how many post folders are on disk, and when it last ran — and asks which to bring up to date. It reads the tree and nothing else, so it answers with no downloader installed and no session, and picking one takes the URL out of that account's own `account.json` rather than one you have to go and find again. An account with a list already worked out shows how many of them are still to fetch, so saying yes resumes it instead of crawling the account again. With nothing archived yet, it says so and tells you how to start.

**One folder per post.** `douyin/<account>/posts/2024-03-11_7412…/` and `x/<account>/posts/2024-03-11_1767…/` each hold that post's media as `1.mp4`, `1.jpg`, `2.mp4`… alongside a `post.json` with the permalink, timestamp, full text and the media the post carries. The date sorts a year's archive as a timeline and the id names the post; the words stay in `post.json` in full rather than truncated into a directory name. One shape for both platforms, so a single archives root reads as one archive. `post.json` is written before the download, so a post counts as landed only once every file it names is there. X accounts also keep the current avatar and banner in `assets/`.

**Where they land.** `./archives/` beside your project by default, or wherever you say: `/archiver <url> --archives ~/data`. Give the same folder again next time and it picks up where it left off; give a different one and it starts a fresh archive there. The account folder is its immutable id — a Douyin `sec_uid`, an X numeric user id — unless you give it a name, so a renamed account can never orphan an archive.

**Name the folder something you can read.** `--alias 小明` names the account's folder that instead of its `MS4w…` sec_uid or its numeric id — renaming an existing archive on the next `--go`, or creating a new one under that name. The mapping lives in `archiver.json` at the root of the archive, per platform, so the skill can still find the folder afterwards and the two platforms' aliases cannot collide. Rename a folder by hand and the next run adopts it; `--unalias` puts it back.

**Douyin needs a browser, and a sign-in you do yourself.** yt-dlp has no Douyin account extractor and Douyin's feed API refuses unsigned requests, so an account's post list can only be read out of a real page. You sign in once, a session is kept, and every later run is headless. The downloading itself is yt-dlp's. Image posts (图文) are counted and reported, but not yet downloaded — no tool can fetch them ([#48](https://github.com/luojiahai/skills/issues/48)).

**X spends your account.** That side runs on your own signed-in session, read once out of your browser and then cached. Bulk archiving is what X's automation rules exist to catch, and the realistic failure isn't a failed download — it's your account getting rate-limited or locked. That's your call to make knowingly, not a surprise. Your session token also ends up in a file on your disk. It takes the account's own media, including its replies to itself — not retweets or quoted posts, which are someone else's uploads, and not text-only posts. Likes and bookmarks are out of scope.

**You'll need** Node, plus [yt-dlp](https://github.com/yt-dlp/yt-dlp) for Douyin and [gallery-dl](https://github.com/mikf/gallery-dl) for X. `setup.sh` checks every platform and installs nothing; `setup.sh douyin` installs the browser that side needs. Someone who only ever archives X is never handed a Chromium download.

**It fetches; it doesn't publish.** Posts land in a folder on your own disk and nothing is uploaded anywhere. What you may keep, and what you may do with it, is between you, the platform's terms and the uploader's copyright — that call is yours, not the agent's. The pauses between requests are deliberate: a run with them removed gets cut off partway.

## Retired

Retired skills stay in the repo, under [`deprecated/`](./deprecated), because the work in them is still worth reading. They are not shipped, not installed by default, and not maintained. Each carries `metadata.internal: true` in its frontmatter, which is what keeps the skills.sh CLI from offering it — including under `--full-depth`. If you want one anyway:

```bash
INSTALL_INTERNAL_SKILLS=1 npx skills@latest add luojiahai/skills --skill <name>
```

- **[preparing-tax-return](./deprecated/preparing-tax-return/SKILL.md)** — Australia only: prepared an individual tax return for self-lodgement in myTax, walking you from documents through prefill reconciliation and deduction tests to a label-by-label worksheet. Retired because it is no longer maintained — and since it encodes rates and thresholds for a particular tax year, treat anything it tells you as out of date until you have checked it yourself.
