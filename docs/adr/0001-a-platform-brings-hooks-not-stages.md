# 1. A platform brings hooks, not stages

Accepted, 2026-08-19.

## Context

The archiver runs one account at a time, and every run has the same two halves:
a listing half that collects the account, diffs it against the archive and parks
a plan, and a download half that fetches what the plan approved and reports what
landed. Both live in `skills/published/archiver/scripts/shared/run.mjs`.

Those halves were offered to a platform as `adapter.plan ?? defaultPlan` — a
platform could replace either whole. The reasoning at the time was that listing a
Douyin profile and listing an X timeline have almost nothing in common, and that
is true of the listing itself.

It was not true of the run around it. Douyin took the option, and paid 341 lines
for it: the account folder resolved again, the archive read again, the sweep
decided again, the two-phase alias check written out again, the identity write,
the plan lifecycle, the move, plan retirement, and the envelope that
`reportRun` composes for the other two. What it actually needed done differently
was narrow — its URL names the account, so its folder is settled before a browser
opens; its counts are against a profile header; its downloader signs in later
than the others.

Three consequences, all of which showed up:

- **The copies disagreed, and nothing said which was right.** Four divergences
  turned out to be bugs rather than platform facts: a `--go` that renamed the
  account folder before deciding it would refuse the plan, a plan written before
  the identity that names the folder it sits in, a downloaded count taken from
  the downloader's word while the totals beside it were taken from the folder,
  and a duplicate reported by one platform's plan and not the others'.
- **The tests recorded the split rather than closing it.** The shared suite's
  stated purpose is that a behaviour asserted of one platform and not the others
  is a hole; it had grown a second loop over just the two platforms that shared
  the stages, and Douyin's own suite re-asserted twelve of those behaviours
  against its own copy.
- **The option invited its own use.** An override point says that replacing a
  whole stage is a supported move, which is the invitation that produced the 341
  lines.

## Decision

There is one listing half and one download half, and every platform goes through
the whole of both. A platform brings hooks, and the whole-stage override is gone
rather than left unused.

What looked like a different shape was, in every case, a difference the existing
seams already expressed or could express with a widened argument. The run's
account callback always meant "the folder is settled the moment the account is
known"; for Douyin that moment is before anything opens, so its `collect` fires
the callback first and needs no new hook at all. Late-bound cookies live in its
own `fetch`, which wraps the downloader. What genuinely could not be shared —
which of a listing's counts a short sweep withholds, what its failures mean, the
one note a finished run recomputes — became named members.

## Consequences

Douyin's `run.mjs` fell from 588 lines to 454, the shared suite asserts every run
behaviour of every platform in one loop, and the four bugs above are fixed once
rather than in two places.

A fourth platform pays for this if it genuinely cannot be expressed as hooks: it
must widen a hook, or reintroduce the override in the commit that proves it is
needed. That is the intended cost. The alternative — leaving the option standing
for a platform that has not arrived — is what this decision reverses.

Do not re-propose whole-stage overrides on the grounds that the platforms differ.
They do differ, and the difference is smaller than a stage.
