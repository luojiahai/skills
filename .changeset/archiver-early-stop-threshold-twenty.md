---
"luojiahai-skills": patch
---

archiver (x, instagram): lower the early-stop threshold to 20, justified per platform

A re-run stops once it has passed enough consecutive posts it already has. At 100
that threshold was enumeration a re-run paid before it could stop, and the two
platforms did not pay it at the same rate: X sleeps 2s a request over one feed,
Instagram 6–12s over two, so Instagram paid roughly eight times what X did for
the same number. Below 100 posts in a feed the stopper never fired at all, and a
40-reel account re-swept its whole reels feed on every run, forever.

The threshold's only job is to outlast how far a platform can reorder its own
timeline, so the number is a claim about platform behaviour. X pins exactly one
post regardless of age — Premium buys a Highlights tab, not a second pin, and
that tab is not the timeline this sweep walks. Instagram pins up to three to the
profile grid, and its reels tab is chronological with no pinning of its own. 20
clears both blocks several times over, cuts Instagram's re-run enumeration from
~160s to ~35s, and fires on the short feeds 100 never reached.

Two per-platform constants, not one shared constant: each carries its own
platform's pinning in a comment and is bounded from both sides by tests of its
own — that it outlasts that platform's pin block, and that it fires inside a feed
of forty. Neither asserts what the other holds, so either can move without making
the other's prose lie.

`stopped_early` now means something milder than it did. At 20 it fires on nearly
every re-run, and the guard that sends an unfinished download to a full sweep has
removed what the old "'nothing new' is not proven" caveat was warning about.
`SKILL.md` reports it plainly instead — a caveat repeated every run is one the
user stops reading — without claiming in the other direction that nothing under
the cut can ever be missing.
