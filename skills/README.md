# Skills

Nothing here starts on its own: each skill runs when you type its name.

Install them with the skills.sh CLI:

```bash
npx skills@latest add luojiahai/skills
```

The [root README](../README.md) covers the Claude Code plugin install too.

Skills live in one of two tiers. `published/` is what installs; `deprecated/` is what used to, and is listed at the bottom of this page for the record.

## douyin-archiver

**[`/douyin-archiver`](./published/douyin-archiver/SKILL.md)** archives every video from a Douyin account, or downloads a single video. It was named `douyin-downloader` until the rename. Re-runs fetch only what is new, so an account can be re-archived later without pulling down what you already have. Image posts (图文) are counted and reported, but not yet downloaded — no tool can fetch them ([#39](https://github.com/luojiahai/skills/issues/39)).

**It asks before it downloads.** It reads the account's post list first and tells you whose it is, where the posts would go, how many there are and how many you don't already have — then waits for your yes. Nothing is fetched until you give it.

**One folder per post.** `douyin/<account>/posts/2024-03-11_7412…/` holds that post's media as `1.mp4` alongside a `post.json` with the permalink, timestamp, full caption and the media the post carries — the same shape `x-archiver` writes, so a shared archives root reads as one archive. `post.json` is written before the download, so a post counts as landed only once every file it names is there.

**Where they land.** `./archives/` beside your project by default, or wherever you say: `/douyin-archiver <url> --archives ~/data`. Give the same folder again next time and it picks up where it left off; give a different one and it starts a fresh archive there. The folder is the account's `sec_uid` unless you give it a name — either way changing a 抖音号 cannot orphan an archive.

**Name the folder something you can read.** `--alias 小明` names the account's folder that instead of its `MS4w…` sec_uid — renaming an existing archive on the next `--go`, or creating a new one under that name. The mapping from sec_uid to alias lives in `archiver.json` at the root of the archive, so the skill can still find the folder afterwards, and so can you. Rename a folder by hand and the next run adopts it; `--unalias` puts it back.

**You'll need** [yt-dlp](https://github.com/yt-dlp/yt-dlp) and Node installed, and a one-off Douyin sign-in — a browser opens, you sign in, and the session is reused from then on. The skill's `setup.sh` checks the rest and tells you what's missing.

**Why it needs a browser.** yt-dlp has no Douyin account extractor, and Douyin's feed API refuses unsigned requests, so the list of an account's posts can only be read out of a real page. The downloading itself is yt-dlp's.

**It fetches; it doesn't publish.** Posts land in a folder on your own disk and nothing is uploaded anywhere. What you may keep, and what you may do with it, is between you, Douyin's terms and the uploader's copyright — that call is yours, not the agent's. The pauses between requests are deliberate: a run with them removed gets cut off partway.

## x-archiver

**[`/x-archiver`](./published/x-archiver/SKILL.md)** archives the media an account has posted on **X, formerly Twitter** — or downloads a single post. It was named `x-downloader` until the rename. Images, videos and GIFs; re-runs fetch only what's new.

**It asks before it downloads.** Same shape as its Douyin sibling: it reads the account's posts first and tells you whose they are, where they'd go, how many there are and how many you don't already have — then waits for your yes.

**One folder per post.** `x/<account>/posts/2024-03-11_1767…/` holds that post's images and videos as `1.jpg`, `2.mp4`… alongside a `post.json` with the full text and the media the post carries. The date sorts a year's archive as a timeline and the id names the post; the words stay in `post.json` in full rather than truncated into a directory name. The account folder is the numeric user id unless you give it a name — either way a renamed account keeps the archive it already has. Its current avatar and banner sit in `assets/`.

**Name the folder something you can read.** `--alias jia` names the account's folder that instead of its numeric id, and `archiver.json` at the root of the archive records which id that alias belongs to — so the skill finds the folder afterwards and you can read the listing. Same flag, same rules as the Douyin sibling, and the two share one archives root without their aliases being able to collide.

**It spends your X account.** This runs on your own signed-in session, read once out of your browser and then cached. Bulk archiving is what X's automation rules exist to catch, and the realistic failure isn't a failed download — it's your account getting rate-limited or locked. That's your call to make knowingly, not a surprise. Your session token also ends up in a file on your disk.

**You'll need** [gallery-dl](https://github.com/mikf/gallery-dl) (`brew install gallery-dl`) and Node, plus a browser you're already signed in to X on. There's no sign-in step to automate — X's login can't be scripted, by this or anything else.

**What it takes, and what it leaves.** The account's own media, including its replies to itself. Not retweets or quoted posts — those are someone else's uploads and filing them here would misattribute them. Not text-only posts. Likes and bookmarks are out of scope.

## Retired

Retired skills stay in the repo, under [`deprecated/`](./deprecated), because the work in them is still worth reading. They are not shipped, not installed by default, and not maintained. Each carries `metadata.internal: true` in its frontmatter, which is what keeps the skills.sh CLI from offering it — including under `--full-depth`. If you want one anyway:

```bash
INSTALL_INTERNAL_SKILLS=1 npx skills@latest add luojiahai/skills --skill <name>
```

- **[preparing-tax-return](./deprecated/preparing-tax-return/SKILL.md)** — Australia only: prepared an individual tax return for self-lodgement in myTax, walking you from documents through prefill reconciliation and deduction tests to a label-by-label worksheet. Retired because it is no longer maintained — and since it encodes rates and thresholds for a particular tax year, treat anything it tells you as out of date until you have checked it yourself.
