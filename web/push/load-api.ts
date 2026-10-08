/**
 * The Actual API, loaded only when someone connects. The convert page swaps
 * this module's import for an empty stub, so it carries none of the API.
 */
export const loadApi = () => import('@actual-app/api');
