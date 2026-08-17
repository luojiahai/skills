---
'luojiahai-skills': patch
---

archiver: invoked with no URL, offer the accounts already archived

Typing `/archiver` with nothing after it left the skill with nothing to do but
ask for a URL — including for someone whose only intent was to bring an archive
they already have up to date, and who now had to go and find the profile URL
they had used before.

It now lists what is under the archives root and asks which to sync. The listing
is read off the tree alone, so it works with no downloader installed and no
session, and it reads without writing: no stamp, no folder, no repaired alias
map. Each account shows its folder, who it is, how many post folders are on disk,
and when it last ran; an account with a list already worked out shows how many of
them are still to fetch, so saying yes resumes it rather than crawling the
account again. Picking one takes the URL recorded in
its `account.json` rather than rebuilding one from a handle, which changes hands.

The skill writes the listing rather than the script printing it, so it comes in
the language the conversation is in.

With nothing archived yet, it says so and explains how the skill is invoked.
