import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { render } from 'preact';

import { App } from './app.js';
import { safeStorage } from './dom.js';
import { applyTheme, loadTheme } from './theme.js';

// PDF.js reads pages in a worker. Its code travels inside this file and the
// worker is started here from a Blob, then handed over, so nothing is fetched
// and PDF.js never has to import a script, which the page's policy forbids.
GlobalWorkerOptions.workerPort = new Worker(
  URL.createObjectURL(new Blob([__PDF_WORKER__], { type: 'text/javascript' })),
);

applyTheme(loadTheme(safeStorage()));

render(<App />, document.getElementById('app') as HTMLElement);
