---
"luojiahai-skills": patch
---

`douyin-archiver` and `x-archiver` archive an account and nothing else.

Both take a profile URL. A post URL — `x.com/<handle>/status/<id>`,
`douyin.com/video/<id>` — is refused before anything is read or written, rather
than resolved to the account that posted it.

Downloading a single post is out of scope: use gallery-dl or yt-dlp directly.

Archives already on disk are unaffected, and the schema is unchanged.
