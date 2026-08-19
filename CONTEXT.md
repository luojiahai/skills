# Skills

A single-plugin Claude Code marketplace: a repository of agent skills, and the
tooling that decides which of them ship.

## Language

### The repository

**Skill**:
A folder holding a `SKILL.md` and everything it needs to run, invoked by name.
_Avoid_: plugin, command, tool

**Tier**:
The one directory level under `skills/` that says whether a skill ships —
`published` or `deprecated`.
_Avoid_: status, category

**Retired**:
A skill the CLI no longer offers, marked by a flag in its own frontmatter.
_Avoid_: deleted, removed, archived

### Archiving

**Archive**:
Everything one account's posts and identity occupy on disk.
_Avoid_: backup, dump

**Archives root**:
The directory every account folder lives under, one platform folder deep.
_Avoid_: output directory, destination

**Account folder**:
One account's directory, named for its alias or its immutable platform id.

**Post**:
One item an account published — a tweet, an Instagram post or reel, a Douyin
video.
_Avoid_: item, entry, tweet, video

**Post folder**:
One post's directory, holding what the post was and the media it carried.

**Landed**:
A post is landed when every file it says it has is present.
_Avoid_: synced, complete

**Platform**:
A site the skill can archive, and the code that archives it.
_Avoid_: provider, source, site

**Handle**:
A platform's own readable name for an account, which the account may change.
_Avoid_: alias, name

**Alias**:
A name the user gives an account folder, standing in for the account's
immutable id so the archive reads to a person.
_Avoid_: handle, nickname, label

**Run**:
One invocation that archives one account into one account folder.
_Avoid_: job, session, execution

**Plan**:
The list of posts a run collected and the user approves before anything is
downloaded.
_Avoid_: queue, manifest, batch

**Sweep**:
One listing pass over an account, either full or incremental.
_Avoid_: crawl, scrape, scan

**Session**:
The signed-in browser state a platform needs before it will show an account.
_Avoid_: login, credentials, cookies, auth

**Box**:
A keyed directory holding one of the tools a run drives — the runtime, the
downloaders, the browser.
_Avoid_: environment, venv, sandbox

**Envelope**:
The single JSON document every command answers with.
_Avoid_: response, payload, result, output

**Refusal**:
A run stopping and naming why, as a code rather than a sentence.
_Avoid_: error, exception

**Failure**:
What a downloader did, before a run classifies it into a refusal.
_Avoid_: error, refusal

**Note**:
A coded fact a run reports that is not a count.
_Avoid_: warning, message, flag
