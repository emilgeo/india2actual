import { mkdir } from 'node:fs/promises';

import type { ActualApi, ActualConnector } from './push.js';

/**
 * The connector for Node. `@actual-app/api` is imported dynamically so the
 * converter works without it installed, and so a missing install produces an
 * actionable message rather than a module-resolution error at startup.
 */
export const connectNode: ActualConnector = async config => {
  let api: ActualApi;
  try {
    // Non-literal specifier on purpose: it keeps TypeScript from trying to
    // resolve an optional dependency that may not be installed.
    const specifier = '@actual-app/api';
    api = (await import(specifier)) as unknown as ActualApi;
  } catch {
    throw new Error(
      '--push needs @actual-app/api, which installs automatically as an\n' +
        'optional dependency. Reinstall with optional dependencies enabled:\n' +
        '  npm install --include=optional india2actual',
    );
  }

  if (!config.dataDir) {
    throw new Error('A data directory is needed to connect from Node');
  }

  // The API reads this directory on startup and fails if it does not exist.
  await mkdir(config.dataDir, { recursive: true });

  await api.init({
    dataDir: config.dataDir,
    serverURL: config.serverURL,
    password: config.password,
  });

  return api;
};
