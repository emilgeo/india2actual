// AMO's add-on validator refuses a text file of 5 MiB or more (FILE_TOO_LARGE),
// and a file that grows past it is only found when the store rejects the upload.
// The limit is the validator's own, compared the same way.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The files at or over the limit, with their sizes. */
export function oversizedFiles(files, limit = MAX_FILE_BYTES) {
  return files
    .filter(file => file.data.length >= limit)
    .map(file => ({ name: file.name, size: file.data.length }));
}
