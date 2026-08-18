---
"luojiahai-skills": minor
---

archiver: archive Instagram accounts

`/archiver <instagram profile url>` now archives an Instagram account's own posts — single images, carousels and videos — and its reels, alongside the Douyin and X accounts it already handled. The URL still decides the platform and you are never asked.

Posts and reels are collected as two separate passes, so each can stop early on a re-run without cutting the other short, and every run says which of the two it reached the end of. Stories, highlights and tagged posts are out of scope, and a URL naming one is refused by name rather than attempted — a story is gone within a day, so "a re-run fetches only what's new" could never be true of one.

Like X, it reads the session out of a browser you're already signed in to, once, and caches it separately. It adds no new downloads for anyone already set up for X. Instagram answers a client going too fast by holding your *account* behind a challenge rather than by refusing the request, so the pauses between requests are deliberately longer, and a run that meets one now reports it as its own outcome — keeping the cached session, which still works, instead of throwing it away and sending you to sign in again.

Also fixes a latent bug in the shared archive: post folder names were written with one charset rule and read back with a narrower, digits-only one. No shipped platform could reach it, but any post id that wasn't purely numeric would have been written to disk and then never recognised again, and re-downloaded on every run.
