const REPO = 'https://github.com/emilgeo/india2actual';

const NOTICE = (source) =>
  `<!-- Generated from ${source} by scripts/sync-docs.mjs. Edit that file, not this one. -->`;

function frontmatter({ title, description, source, maxHeading }) {
  return [
    '---',
    `title: ${title}`,
    `description: ${description}`,
    'tableOfContents:',
    '  minHeadingLevel: 2',
    `  maxHeadingLevel: ${maxHeading}`,
    `editUrl: ${REPO}/edit/main/${source}`,
    '---',
    '',
    NOTICE(source),
    '',
  ].join('\n');
}

/** Applies `change` to every line outside a fenced code block. */
function outsideFences(markdown, change) {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : change(line);
    })
    .join('\n');
}

function dropTitleAndBadges(markdown) {
  let droppedTitle = false;
  return outsideFences(markdown, (line) => {
    if (!droppedTitle && /^# /.test(line)) {
      droppedTitle = true;
      return null;
    }
    // Badge images would be third-party requests from the site.
    return line.includes('img.shields.io') ? null : line;
  })
    .split('\n')
    .filter((line) => line !== 'null')
    .join('\n');
}

function absoluteLinks(markdown) {
  return outsideFences(markdown, (line) =>
    line.replace(
      /\]\((?!https?:|#|mailto:|\/)([^)\s]+)\)/g,
      `](${REPO}/blob/main/$1)`,
    ),
  );
}

function tidy(markdown) {
  return `${markdown.replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function renderReadme(readme) {
  const body = absoluteLinks(dropTitleAndBadges(readme));
  return (
    frontmatter({
      title: 'Documentation',
      description:
        'How to install and use india2actual, with options, settings and supported banks.',
      source: 'README.md',
      maxHeading: 3,
    }) + tidy(body)
  );
}

export function renderChangelog(changelog) {
  return (
    frontmatter({
      title: 'Changelog',
      description: 'What changed in each release of india2actual.',
      source: 'CHANGELOG.md',
      maxHeading: 2,
    }) + tidy(dropTitleAndBadges(changelog))
  );
}
