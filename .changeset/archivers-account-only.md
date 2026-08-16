---
"luojiahai-skills": patch
---

`douyin-archiver` and `x-archiver` no longer download a single post — archive
the account instead.

Both skills took a post URL as well as a profile URL: `x.com/<handle>/status/<id>`
and `douyin.com/video/<id>` fetched that one post and nothing else. That is gone.
Each skill now takes a profile URL and archives the whole account, which is the
one thing it was ever really for. A post URL is refused before anything is read
or written, rather than resolved to the account that posted it — a request for
one post must not turn into an entire archive.

Downloading a single post is out of scope now, not broken: a general-purpose
media downloader does that job better than either skill did.

**Nothing on disk changes.** Archives made by the old single-post path keep
working exactly as they did — a folder identified only by its 抖音号, an
`account.json` written without the profile URL, a parked plan whose URL names a
post. The code that tolerates all three is still there, and still tested; only
the paths that *wrote* them are gone.
