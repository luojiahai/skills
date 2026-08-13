---
"luojiahai-skills": patch
---

douyin-downloader: stop downloads landing inside the skill folder. Told to run
`scripts/download.sh`, an agent tends to cd into the skill first, and in a
project that is not a git repository the download root was then the skill's own
directory — where the next update deletes the archive. A cwd inside the skill is
now discarded: the project is recovered from the install path, and where that
names none the run stops and asks for `--downloads DIR` rather than guessing.
