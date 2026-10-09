let allowedOrigin: string | null = null;

/**
 * Restrict the page's network access to one server for the rest of the visit.
 * A second policy can only tighten the first, so it cannot be undone and a
 * different server needs a fresh page. Called before the first request, so
 * the worker the Actual client starts later inherits it.
 */
export function narrowNetwork(origin: string, doc: Document = document): void {
  if (allowedOrigin === origin) {
    return;
  }
  if (allowedOrigin !== null) {
    throw new Error(
      `This page is limited to ${allowedOrigin} for this visit. Reload the page to use another server.`,
    );
  }
  const meta = doc.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = `connect-src ${origin}`;
  doc.head.append(meta);
  allowedOrigin = origin;
}
