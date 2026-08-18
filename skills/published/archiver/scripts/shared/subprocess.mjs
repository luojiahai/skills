/**
 * subprocess.mjs — running a downloader and reading what it said.
 *
 * Both platforms spawn one downloader per post and both have to answer the same
 * two questions afterwards: what did it exit with, and what did it print. One
 * implementation, because two came to disagree on the answer for a process that
 * could not be started at all — and that answer is what `downloader-unavailable`
 * is classified from.
 *
 * stdout is read a line at a time so a caller can act on one while the process
 * is still going: yt-dlp prints a media filename before it downloads that file,
 * which is what lets `post.json` be written ahead of the bytes it describes.
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';

/**
 * The exit reported for a process that never started. Negative because no real
 * exit status is, so nothing can confuse it for one the tool chose.
 */
export const SPAWN_FAILED = -1;

/** How much of the output is kept. Only the tail explains a failure, and a
 * download's progress is unbounded. */
const KEEP_BYTES = 32_000;

/**
 * Runs `bin` and resolves `{ code, lines, output }` — never rejects, because a
 * downloader that will not start is a run that has to report why rather than a
 * stack.
 *
 * `lines` is stdout, trimmed and without blanks. `output` is stdout and stderr
 * together, which is what a failure is classified from: the two tools split
 * their diagnostics across both streams.
 */
export function runTool(bin, args, { spawnImpl = spawn, onLine = () => {} } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    let output = '';

    const take = (chunk) => {
      output += chunk;
      if (output.length > KEEP_BYTES) output = output.slice(-KEEP_BYTES / 2);
    };

    // Attached before anything is read, so a spawn that fails immediately is
    // answered rather than hanging the run.
    child.on('error', (error) =>
      resolve({ code: SPAWN_FAILED, lines, output: `could not start: ${error.message}` }));

    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', take);

    const reader = readline.createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      lines.push(trimmed);
      take(`${trimmed}\n`);
      onLine(trimmed);
    });

    child.on('close', (code) => resolve({ code: code ?? SPAWN_FAILED, lines, output }));
  });
}

/**
 * An HTTP status, and only where the line is about a response.
 *
 * The downloaders write resolved paths, media URLs, video titles and byte counts
 * to the same streams an error goes to, so a bare number classifies nothing a run
 * can act on: `Gx401abc.jpg` is a media token and `1401 bytes` is a size. Reading
 * either as a rejected session stops the run *and* throws away a working
 * session, so the number counts only where it is introduced as a status or
 * followed by its reason phrase.
 */
export function httpStatus(code, reason) {
  // The spellings the two tools actually use: gallery-dl's `HttpError: '401
  // Unauthorized'`, yt-dlp's `HTTP Error 429: Too Many Requests`, and a bare
  // status line. What none of them look like is a number sitting in a path.
  const introduced = String.raw`(?:\bHTTP(?:/[\d.]+)?(?:\s+Error)?\s+|\bstatus\s+(?:code\s+)?|\bHttpError:?\s*['"]?)`;
  return new RegExp(`${introduced}${code}\\b|\\b${code}:?\\s+${reason}\\b`, 'i');
}
