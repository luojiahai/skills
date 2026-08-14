---
"luojiahai-skills": minor
---

Add `x-downloader`: archive the media an X (formerly Twitter) account has posted, or a single post.

It follows `douyin-downloader`'s shape — it enumerates first, reports whose account it is, where the files would go, how many posts exist and how many you don't already have, and waits for your yes before fetching anything. Re-runs pick up only what's new.

Images, videos and GIFs, from the account's own posts and its replies to itself. Each post gets its own date-named folder holding its media and a `text.txt` with the full post text, so a post stays a self-contained unit and the archive still sorts as a timeline. Retweets, quoted posts and text-only posts are left alone; likes and bookmarks are out of scope.

It runs on gallery-dl, and on your own signed-in X session — read out of your browser once and cached after that, because X's login cannot be scripted. Worth knowing before the first run: bulk archiving is what X's automation rules exist to catch, and the realistic failure is your account being rate-limited or locked rather than a download failing.
