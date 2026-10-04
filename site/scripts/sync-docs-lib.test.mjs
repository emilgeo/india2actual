import { describe, expect, it } from 'vitest';

import { renderChangelog, renderReadme } from './sync-docs-lib.mjs';

const readme = [
  '# india2actual',
  '',
  '[![npm](https://img.shields.io/npm/v/india2actual)](https://www.npmjs.com/package/india2actual)',
  '[![license](https://img.shields.io/npm/l/india2actual)](LICENSE)',
  '',
  'Intro text with [the limits](#limitations) and [a file](CONTRIBUTING.md).',
  '',
  '## Quick start',
  '',
  '```bash',
  'echo "[not a link](LICENSE)"',
  '```',
  '',
  '[site](https://example.org/page) and [mail](mailto:a@example.org)',
].join('\n');

describe('renderReadme', () => {
  const output = renderReadme(readme);

  it('adds frontmatter pointing the edit link at the README', () => {
    expect(output).toMatch(/^---\ntitle: Documentation\n/);
    expect(output).toContain(
      'editUrl: https://github.com/emilgeo/india2actual/edit/main/README.md',
    );
  });

  it('drops the top-level heading, which the page title replaces', () => {
    expect(output).not.toMatch(/^# india2actual/m);
    expect(output).toContain('## Quick start');
  });

  it('drops badge images so the site makes no third-party requests', () => {
    expect(output).not.toContain('img.shields.io');
  });

  it('turns repo-relative links into absolute GitHub links', () => {
    expect(output).toContain(
      '[a file](https://github.com/emilgeo/india2actual/blob/main/CONTRIBUTING.md)',
    );
  });

  it('leaves anchors, absolute links and mail links alone', () => {
    expect(output).toContain('[the limits](#limitations)');
    expect(output).toContain('[site](https://example.org/page)');
    expect(output).toContain('[mail](mailto:a@example.org)');
  });

  it('does not rewrite anything inside a code fence', () => {
    expect(output).toContain('echo "[not a link](LICENSE)"');
  });
});

describe('renderChangelog', () => {
  it('titles the page and keeps the release headings', () => {
    const output = renderChangelog('# Changelog\n\n## 0.2.0 - 2026-10-01\n\n- A change.\n');

    expect(output).toMatch(/^---\ntitle: Changelog\n/);
    expect(output).toContain('maxHeadingLevel: 2');
    expect(output).not.toMatch(/^# Changelog/m);
    expect(output).toContain('## 0.2.0 - 2026-10-01');
  });
});
