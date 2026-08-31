---
'luojiahai-skills': patch
---

archiver: Instagram gains `--skip-reels`, which enumerates the posts feed alone
for when Instagram's clips API is refusing. Reels shown in the profile grid
still arrive through that feed; ones outside it are left unlisted, and the plan
carries a `feed-skipped` note per feed that was never enumerated, so a plan
built from fewer feeds than the profile has can never read as the whole
account. Listing also now presents Instagram a current Chrome user-agent:
Instagram binds a web session to the browser it was created in, so a session
read from a Chrome-family browser was rejected on every request under the
default Firefox one.
