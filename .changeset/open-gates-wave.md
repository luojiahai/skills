---
'luojiahai-skills': patch
---

archiver: Douyin downloads work again. Douyin's gateway now demands a signature yt-dlp cannot compute on every video-detail request, so each post failed with a 403; the downloader now sends those requests as Douyin's open platform, which the gateway waives. A 403 is also no longer read as a dead sign-in: it stops the run as `downloader-blocked`, keeps the session, and points at refreshing the downloaders instead of sending the user to sign in again.
