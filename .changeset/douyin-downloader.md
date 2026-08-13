---
"luojiahai-skills": patch
---

Add **`douyin-downloader`** — download every video from a Douyin account, or a single video, into `./downloads/`. Re-running an account fetches only what is new, so you can point it at the same profile months later without pulling down what you already have.

**It needs two things installed, and one thing from you.** [yt-dlp](https://github.com/yt-dlp/yt-dlp) and Node, both checked by the skill's `setup.sh`, which tells you what is missing rather than installing it behind your back. Then a one-off Douyin sign-in: a browser opens, you sign in, and the session is reused from then on — every later run is headless. Only a human can pass that login, so the skill never tries.

**This is the first skill in the set that ships executable scripts and a dependency.** Everything before it was Markdown the agent reads. This one bundles bash and Node and installs Playwright, because there is no prose-only way to do the job: yt-dlp has no Douyin account extractor, and Douyin's feed API rejects unsigned requests, so the list of an account's videos can only be read out of a real browser page. Nothing mutable is written into the skill directory — the session, the cookies and the dependency all live in `~/.local/state/douyin-downloader/`, so a plugin update replacing the skill leaves them alone and you never sign in twice.

**It fetches; it doesn't publish.** Videos land in a folder in your project and nothing is uploaded anywhere. What you may keep and what you may do with it is between you, Douyin's terms and the uploader's copyright. The pauses between requests are deliberate — a run with them stripped out gets cut off partway.
