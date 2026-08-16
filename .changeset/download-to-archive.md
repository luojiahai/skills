---
"luojiahai-skills": patch
---

`douyin-downloader` is now **`douyin-archiver`**, and `x-downloader` is now
**`x-archiver`**. The skills archive; the tools they drive still download.

**Rename your folder.** The default root moved from `<git root>/downloads/` to
`<git root>/archives/`, and `--downloads DIR` is now `--archives DIR`. An
existing archive is not found at the old path — rename `downloads/` to
`archives/`, or pass `--archives` pointing at it. The old flag is rejected with
an error rather than ignored, so a stale command fails loudly instead of
quietly re-fetching an account into the wrong place.

**Both skills: your saved session is gone.** The state directory follows the
skill's name, so `~/.local/state/douyin-downloader/` is now
`~/.local/state/douyin-archiver/`, and `~/.local/state/x-downloader/` is now
`~/.local/state/x-archiver/`.

- **douyin-archiver** — that held the browser session, cookies and
  `node_modules`. Re-run `./setup.sh` and sign in once more. The Chromium
  download is cached separately, under `~/Library/Caches/ms-playwright`, and is
  not repaid.
- **x-archiver** — that held the cached X cookies. The next run reads them from
  your browser again, so pass `--browser NAME` once, as on a first install.

**If you installed with the skills.sh CLI**, the next `skills update` reports
both skills as deleted upstream — update matches on the recorded path, and both
paths changed. Decline the removal and re-add under the new names:

```bash
npx skills@latest add luojiahai/skills --skill douyin-archiver
npx skills@latest add luojiahai/skills --skill x-archiver
```

Claude Code plugin installs pick up the new names on update; invoke
`/douyin-archiver` and `/x-archiver`.
