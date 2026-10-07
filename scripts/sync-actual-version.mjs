// Keeps the "Tested against Actual" line in the README in step with the
// @actual-app/api version locked in package-lock.json. Run by the
// readme-actual-version workflow after a dependency bump lands on main.
import { readFileSync, writeFileSync } from 'node:fs';

const lock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
);
const locked = lock.packages?.['node_modules/@actual-app/api']?.version;
if (!locked) {
  throw new Error('@actual-app/api is not in package-lock.json');
}

const readmeUrl = new URL('../README.md', import.meta.url);
const readme = readFileSync(readmeUrl, 'utf8');
const line = /(Tested against Actual )\d+\.\d+(?:\.\d+)?/;
if (!line.test(readme)) {
  throw new Error('README.md has no "Tested against Actual" line to update');
}

const updated = readme.replace(line, `$1${locked}`);
if (updated === readme) {
  console.log(`README already says Actual ${locked}`);
} else {
  writeFileSync(readmeUrl, updated);
  console.log(`README now says Actual ${locked}`);
}
