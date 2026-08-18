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
import { ENV_DIR, boxDir, cacheRoot, downloadSize, setupScript, systemTools } from './paths.mjs';

/** The builder, and the marker saying the user has agreed to the download once. */
const BUILDER = path.join(ENV_DIR, 'ensure-env');
const CONSENT = () => path.join(cacheRoot(), 'consented');

/**
 * Builds whichever of `boxes` is not there yet, and answers nothing when they
 * all are — which is every run after the first.
 *
 * The first run refuses instead, because several hundred megabytes is not
 * something to start downloading without asking. The remedy is the agent's: it
 * is asking the user's permission, not reporting a defect. Once anything has
 * been built, later boxes appear silently — a manifest bump that moves the tools
 * box is seconds and a few megabytes, and stopping to ask again would be asking
 * about a cost the user has already agreed to.
 */
export async function ensureEnv(boxes, { platform = null, spawnImpl = spawn, exists = existsSync } = {}) {
  if (systemTools()) return;

  const missing = boxes.filter((box) => !exists(boxDir(box)));
  if (!missing.length) return;

  if (!exists(CONSENT())) throw consentRefusal(missing, platform);
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
        command: platform ? `${setupScript()} ${platform}` : setupScript(),
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
