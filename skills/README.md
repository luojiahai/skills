# Skills

Nothing here starts on its own: each skill runs when you type its name.

Install them with the skills.sh CLI:

```bash
npx skills@latest add luojiahai/skills
```

The [root README](../README.md) covers the Claude Code plugin install too.

## douyin-downloader

**[`/douyin-downloader`](./douyin-downloader/SKILL.md)** downloads every video from a Douyin account, or a single video. Re-runs fetch only what is new, so an account can be re-archived later without pulling down what you already have. Image posts (图文) are counted and reported, but not yet downloaded — no tool can fetch them ([#39](https://github.com/luojiahai/skills/issues/39)).

**It asks before it downloads.** It reads the account's post list first and tells you whose it is, where the posts would go, how many there are and how many you don't already have — then waits for your yes. Nothing is fetched until you give it.

**One folder per post.** `douyin_<抖音号>/posts/2024-03-11_7412…/` holds that post's media as `1.mp4` alongside a `text.txt` with the permalink, timestamp and full caption — the same shape `x-downloader` writes, so one downloads folder reads as one archive.

**Where they land.** `./downloads/` beside your project by default, or wherever you say: `/douyin-downloader <url> --downloads ~/data`. Give the same folder again next time and it picks up where it left off; give a different one and it starts a fresh archive there.

**You'll need** [yt-dlp](https://github.com/yt-dlp/yt-dlp) and Node installed, and a one-off Douyin sign-in — a browser opens, you sign in, and the session is reused from then on. The skill's `setup.sh` checks the rest and tells you what's missing.

**Why it needs a browser.** yt-dlp has no Douyin account extractor, and Douyin's feed API refuses unsigned requests, so the list of an account's posts can only be read out of a real page. The downloading itself is yt-dlp's.

**It fetches; it doesn't publish.** Posts land in a folder on your own disk and nothing is uploaded anywhere. What you may keep, and what you may do with it, is between you, Douyin's terms and the uploader's copyright — that call is yours, not the agent's. The pauses between requests are deliberate: a run with them removed gets cut off partway.

## x-downloader

**[`/x-downloader`](./x-downloader/SKILL.md)** downloads the media an account has posted on **X, formerly Twitter** — or a single post. Images, videos and GIFs; re-runs fetch only what's new.

**It asks before it downloads.** Same shape as its Douyin sibling: it reads the account's posts first and tells you whose they are, where they'd go, how many there are and how many you don't already have — then waits for your yes.

**One folder per post.** `x_<handle>/posts/2024-03-11_1767…/` holds that post's images and videos as `1.jpg`, `2.mp4`… alongside a `text.txt` with the full text. The date sorts a year's archive as a timeline and the id names the post; the words stay in `text.txt` in full rather than truncated into a directory name.

**It spends your X account.** This runs on your own signed-in session, read once out of your browser and then cached. Bulk archiving is what X's automation rules exist to catch, and the realistic failure isn't a failed download — it's your account getting rate-limited or locked. That's your call to make knowingly, not a surprise. Your session token also ends up in a file on your disk.

**You'll need** [gallery-dl](https://github.com/mikf/gallery-dl) (`brew install gallery-dl`) and Node, plus a browser you're already signed in to X on. There's no sign-in step to automate — X's login can't be scripted, by this or anything else.

**What it takes, and what it leaves.** The account's own media, including its replies to itself. Not retweets or quoted posts — those are someone else's uploads and filing them here would misattribute them. Not text-only posts. Likes and bookmarks are out of scope.
