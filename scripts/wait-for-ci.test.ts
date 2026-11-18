import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs script without type declarations
import { REQUIRED_CHECKS, judge, waitForCi } from './wait-for-ci.mjs';

type Run = { id: number; name: string; status: string; conclusion: string | null };
const ok = (name: string, id = 1): Run => ({ id, name, status: 'completed', conclusion: 'success' });
const all = (required: string[]) => required.map((name, index) => ok(name, index + 1));

describe('REQUIRED_CHECKS', () => {
  it('names exactly the CI jobs', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const list = (key: string) =>
      [...(ci.match(new RegExp(`${key}: \\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/[\w.-]+/g)].map(m => m[0]);
    const matrix = list('os').flatMap(os => list('node').map(node => `Node ${node} on ${os}`));
    const names = [...ci.matchAll(/^ {4}name: (?!Node \$)(.+)$/gm)].map(m => m[1]);

    expect([...REQUIRED_CHECKS].sort()).toEqual([...matrix, ...names].sort());
  });
});

describe('judge', () => {
  it('passes when every required check succeeded', () => {
    expect(judge(all(REQUIRED_CHECKS), REQUIRED_CHECKS).state).toBe('passed');
  });

  it('waits for a check that has not reported or has not finished', () => {
    const runs = all(REQUIRED_CHECKS).slice(1);
    expect(judge(runs, REQUIRED_CHECKS)).toMatchObject({ state: 'waiting' });
    const pending = all(REQUIRED_CHECKS).map((run, index) =>
      index === 0 ? { ...run, status: 'in_progress', conclusion: null } : run,
    );
    expect(judge(pending, REQUIRED_CHECKS).state).toBe('waiting');
  });

  it('fails on a failed, cancelled or skipped check and names it', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral']) {
      const runs = all(REQUIRED_CHECKS).map((run, index) => (index === 2 ? { ...run, conclusion } : run));
      const verdict = judge(runs, REQUIRED_CHECKS);
      expect(verdict.state).toBe('failed');
      expect(verdict.problems.join(' ')).toContain(REQUIRED_CHECKS[2]);
    }
  });

  it('uses the latest run of a check, so a successful re-run clears an earlier failure', () => {
    const runs = [
      ...all(REQUIRED_CHECKS),
      { id: 99, name: REQUIRED_CHECKS[0], status: 'completed', conclusion: 'success' },
    ].map(run => (run.id === 1 ? { ...run, conclusion: 'failure' } : run));
    expect(judge(runs, REQUIRED_CHECKS).state).toBe('passed');
  });

  it('ignores checks that are not required', () => {
    const runs = [...all(REQUIRED_CHECKS), { id: 500, name: 'CodeQL', status: 'completed', conclusion: 'failure' }];
    expect(judge(runs, REQUIRED_CHECKS).state).toBe('passed');
  });
});

describe('waitForCi', () => {
  const reply = (runs: Run[]) => async () => ({ ok: true, status: 200, json: async () => ({ check_runs: runs }) });

  it('returns once every check has passed', async () => {
    const calls: number[] = [];
    const fetchFn = async () => {
      calls.push(1);
      const runs = calls.length < 3 ? all(REQUIRED_CHECKS).slice(1) : all(REQUIRED_CHECKS);
      return { ok: true, status: 200, json: async () => ({ check_runs: runs }) };
    };
    await expect(
      waitForCi({ repo: 'o/r', sha: 'abc', token: 't', fetchFn, sleep: async () => {}, log: () => {} }),
    ).resolves.toBeUndefined();
    expect(calls.length).toBe(3);
  });

  it('fails at once on a failed check', async () => {
    const runs = all(REQUIRED_CHECKS).map((run, index) => (index === 0 ? { ...run, conclusion: 'failure' } : run));
    await expect(
      waitForCi({ repo: 'o/r', sha: 'abc', token: 't', fetchFn: reply(runs), sleep: async () => {}, log: () => {} }),
    ).rejects.toThrow(REQUIRED_CHECKS[0]);
  });

  it('gives up with a clear message when CI never finishes', async () => {
    let now = 0;
    await expect(
      waitForCi({
        repo: 'o/r', sha: 'abc', token: 't', fetchFn: reply([]),
        sleep: async (ms: number) => { now += ms; }, now: () => now, log: () => {},
      }),
    ).rejects.toThrow(/did not finish|has not run/);
  });

  it('sends the token and asks for the commit it was given', async () => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const fetchFn = async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, auth: init.headers.authorization });
      return { ok: true, status: 200, json: async () => ({ check_runs: all(REQUIRED_CHECKS) }) };
    };
    await waitForCi({ repo: 'o/r', sha: 'abc123', token: 'secret', fetchFn, sleep: async () => {}, log: () => {} });
    expect(seen[0]?.url).toContain('/repos/o/r/commits/abc123/check-runs');
    expect(seen[0]?.auth).toBe('Bearer secret');
  });

  it('fails on an API error with its status', async () => {
    const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(
      waitForCi({ repo: 'o/r', sha: 'abc', token: 't', fetchFn, sleep: async () => {}, log: () => {} }),
    ).rejects.toThrow('403');
  });
});
