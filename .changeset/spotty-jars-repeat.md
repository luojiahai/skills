---
"luojiahai-skills": patch
---

Skills now live under a tier: `skills/published/<name>` for what ships, `skills/deprecated/<name>` for what used to. Retirement is no longer a matter of where a folder sits — a retired skill carries `metadata.internal: true` in its frontmatter, which is what actually stops the skills.sh CLI offering it, at any depth and under `--full-depth`.

**If you installed with the skills.sh CLI, your next `skills update` will report `douyin-downloader` and `x-downloader` as deleted upstream, and offer to remove them.** They have not gone anywhere — update matches on the recorded path, and their paths changed. Decline the removal and re-add to heal the lock:

```bash
npx skills@latest add luojiahai/skills --skill douyin-downloader
npx skills@latest add luojiahai/skills --skill x-downloader
```

Claude Code plugin installs are unaffected and need nothing.
