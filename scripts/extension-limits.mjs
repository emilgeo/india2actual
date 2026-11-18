// Firefox's add-on checks do not read a file over 5 MB, and a file that grows
// past it is only found when the store rejects the upload. The limit is kept
// under 5,000,000 bytes so it holds whichever way the megabyte is counted.
export const MAX_FILE_BYTES = 4_950_000;

/** The files at or over the limit, with their sizes. */
export function oversizedFiles(files, limit = MAX_FILE_BYTES) {
  return files
    .filter(file => file.data.length >= limit)
    .map(file => ({ name: file.name, size: file.data.length }));
}
