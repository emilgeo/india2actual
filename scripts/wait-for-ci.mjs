// Waits until every CI check has passed on a commit, so a release can never
// publish from a commit that is red, cancelled or not yet tested.
//
// Usage: node scripts/wait-for-ci.mjs
// Reads GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA from the environment.
import { pathToFileURL } from 'node:url';

/** The CI jobs a commit must pass. A test keeps this list equal to .github/workflows/ci.yml. */
export const REQUIRED_CHECKS = [
  ...['ubuntu-latest', 'windows-latest', 'macos-latest'].flatMap(os =>
    ['22.14', '24'].map(node => `Node ${node} on ${os}`),
  ),
  'Package contents',
  'Browser page',
  'Browser extensions',
];

const POLL_MS = 30_000;
const TIMEOUT_MS = 30 * 60_000;

/**
 * `passed` when every required check's latest run succeeded, `failed` when one
 * finished without succeeding, otherwise `waiting`. A re-run is a newer run of
 * the same name, so the highest id wins.
 */
export function judge(checkRuns, required = REQUIRED_CHECKS) {
  const latest = new Map();
  for (const run of checkRuns) {
    if (required.includes(run.name) && (!latest.has(run.name) || run.id > latest.get(run.name).id)) {
      latest.set(run.name, run);
    }
  }

  const failed = [];
  const waiting = [];
  for (const name of required) {
    const run = latest.get(name);
    if (!run) {
      waiting.push(`${name} (has not run)`);
    } else if (run.status !== 'completed') {
      waiting.push(`${name} (${run.status})`);
    } else if (run.conclusion !== 'success') {
      failed.push(`${name} (${run.conclusion})`);
    }
  }

  if (failed.length > 0) {
    return { state: 'failed', problems: failed };
  }
  return waiting.length > 0 ? { state: 'waiting', problems: waiting } : { state: 'passed', problems: [] };
}

export async function waitForCi({
  repo,
  sha,
  token,
  fetchFn = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  log = console.log,
}) {
  const deadline = now() + TIMEOUT_MS;

  for (;;) {
    const response = await fetchFn(
      `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } },
    );
    if (!response.ok) {
      throw new Error(`Reading the checks of ${sha} failed (HTTP ${response.status}).`);
    }
    const { check_runs: runs } = await response.json();
    const verdict = judge(runs);

    if (verdict.state === 'passed') {
      log(`Every CI check passed on ${sha}.`);
      return;
    }
    if (verdict.state === 'failed') {
      throw new Error(`CI did not pass on ${sha}: ${verdict.problems.join(', ')}.`);
    }
    if (now() >= deadline) {
      throw new Error(
        `CI did not finish on ${sha} within 30 minutes, still waiting for: ${verdict.problems.join(', ')}.`,
      );
    }
    log(`Waiting for CI on ${sha}: ${verdict.problems.join(', ')}`);
    await sleep(POLL_MS);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await waitForCi({
      repo: process.env.GITHUB_REPOSITORY,
      sha: process.env.GITHUB_SHA,
      token: process.env.GITHUB_TOKEN,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
