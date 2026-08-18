/**
 * env.mjs — the tool environment this skill runs on, built before it is needed.
 *
 * yt-dlp and gallery-dl ship extractor fixes constantly, because Douyin and X
 * keep changing. A copy of either that happens to be on somebody's PATH is a
 * failure nobody can diagnose from here: nothing says which version ran, and
 * "reinstall your yt-dlp" is not a support answer. So the skill builds its own
 * boxes and always uses them, and what is installed on the machine is not
 * consulted at all.
 *
 * Not polluting the machine is a consequence rather than the point. The boxes
 * *are* a mutation of somebody's disk; what they buy is that it is one
 * clearly-owned, self-labelled directory that can be deleted whole.
 *
 * `env/ensure-env` does the building, in shell, because the thing that builds
 * the box cannot be written in the runtime the box provides. This module is
 * what the platforms call, and what turns a build that could not happen into a
 * refusal the agent can act on.
 *
 * Called lazily, immediately before the point of need, and never at dispatch:
 * `--help` and a mistyped flag must go on answering without touching the
 * network.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { Refusal } from './errors.mjs';
import { quote } from './output.mjs';
import { ENV_DIR, boxDir, cacheRoot, downloadSize, setupScript, systemTools } from './paths.mjs';

/** The builder, and the marker saying the user has agreed to one box's download. */
const BUILDER = path.join(ENV_DIR, 'ensure-env');
const consentMarker = (box) => path.join(cacheRoot(), `consented-${box}`);

/**
 * Builds whichever of `boxes` is not there yet, and answers nothing when they
 * all are — which is every run after the first.
 *
 * A box nobody has agreed to refuses instead, because several hundred megabytes
 * is not something to start downloading without asking. The remedy is the
 * agent's: it is asking the user's permission, not reporting a defect. A box
 * already agreed to is rebuilt silently — a manifest bump that moves the tools
 * box is seconds and a few megabytes, and stopping to ask again would be asking
 * about a cost the user has already agreed to.
 *
 * Consent is per box because the boxes are nothing like each other in size.
 * Somebody who agreed to the runtime and the downloaders for X has agreed to
 * roughly 115 MB; `browser` is a quarter of a gigabyte of Chromium, and one
 * marker covering both is how handing this skill a Douyin URL starts that
 * download over whatever connection they happen to be on, unasked.
 */
export async function ensureEnv(boxes, { platform = null, spawnImpl = spawn, exists = existsSync } = {}) {
  if (systemTools()) return;

  const missing = boxes.filter((box) => !exists(boxDir(box)));
  if (!missing.length) return;

  if (missing.some((box) => !exists(consentMarker(box)))) throw consentRefusal(missing, platform);
  await build(missing, spawnImpl);
}

function consentRefusal(boxes, platform) {
  const megabytes = boxes.reduce((total, box) => total + downloadSize(box), 0);
  return new Refusal(
    'env-consent',
    'the archiver has not built the tools it runs on yet',
    {
      details: { boxes, download_mb: megabytes, dir: cacheRoot() },
      remedy: {
        message:
          'say how much this downloads and where it goes, ask the user, and run this only if they agree',
        // Quoted, because this is a command the agent is instructed to run and
        // the skill is routinely installed under a path with a space in it.
        command: platform ? `${quote(setupScript())} ${quote(platform)}` : quote(setupScript()),
        run_by: 'agent',
      },
    },
  );
}

/**
 * Runs the builder, with its progress going straight to stderr where the user
 * can watch a long download happen, and its last words kept for the refusal.
 *
 * A build that failed never falls back to whatever is on PATH. That would
 * reintroduce the version ambiguity this whole arrangement exists to remove, at
 * the precise moment things are already going wrong — so the escape hatch is
 * named in the remedy and stays an explicit act.
 */
function build(boxes, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(BUILDER, boxes, { stdio: ['ignore', 'ignore', 'pipe'] });
    let output = '';

    child.on('error', (error) => reject(buildFailed(boxes, error.message)));
    // Decoded by the stream rather than by `+=` on a Buffer: a multi-byte
    // character split across two chunks would otherwise become mojibake in the
    // very text the user is told to read.
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
      output += chunk;
      // Only the tail explains why it stopped, and a Chromium download's
      // progress is unbounded.
      if (output.length > 8_000) output = output.slice(-4_000);
    });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(buildFailed(boxes, output.trim())),
    );
  });
}

function buildFailed(boxes, output) {
  return new Refusal(
    'env-build-failed',
    `could not build the tools the archiver runs on (${boxes.join(', ')})`,
    {
      details: { boxes, dir: cacheRoot(), output },
      remedy: {
        message:
          'check the network and try again. Failing that, and unsupported: setting ' +
          'ARCHIVER_SYSTEM_TOOLS=1 runs whatever yt-dlp, gallery-dl and Playwright are ' +
          'already on this machine instead',
        run_by: 'user',
      },
    },
  );
}
