# Store upload automation

Status: approach chosen by the maintainer (A). Written 2026-11-17.

## Intent and why

Each release currently ends with the maintainer uploading the extension by hand
to the Chrome Web Store and Firefox AMO: building the Firefox zip and the source
zip, filling the reviewer notes, clicking through two dashboards. The goal is
that publishing a GitHub release also submits the new version to both stores for
review, with one approval click as the last human check.

## Goals

- Publishing a GitHub release submits that exact version to Chrome and Firefox.
- The Chrome package is the zip already attached to the release, checked against
  the release's `SHA256SUMS` before upload.
- The Firefox package and its source zip are built in CI from the release tag.
- A person approves the upload in GitHub before any credential is used.
- One store failing does not stop the other, and a failed job can be re-run alone.

## Non-goals

- No change to the extension, its manifest, or the existing npm and pages jobs.
- No creation of store listings, screenshots or listing text; the listings exist.
- No waiting for store review. Review takes days; the job ends at submission.
- No automation of the store listing fields (descriptions, data-usage form).

## Anti-goals (a failure even if it works)

- A credential printed in a log, or available to a pull request workflow.
- A pre-release or a failed build reaching a store.
- A silent success when the store rejected the upload.

## Constraints

- Chrome Web Store API v2: OAuth refresh token for the owning Google account;
  upload then publish; the manifest version must increase; the API cannot create
  items; publishing always enters review.
- AMO: API key and secret; `web-ext sign --channel=listed` adds a version to the
  existing listing. Source zip and reviewer notes are sent with it.
- `.github/workflows/publish.yml` already runs on `release: published`.
- No real statement data anywhere; the reviewer notes use the existing fake fixture.
- No new runtime dependency. The Chrome step uses Node's built-in `fetch`.

## Approaches considered

- **A. Upload when a release is published, behind an approval gate (chosen).**
  A separate workflow, protected by a GitHub environment with a required reviewer.
- **B. A separate manual workflow** taking a tag. Same code, one extra click, no
  risk of submitting before looking. Easy to add later by adding a trigger.
- **C. A local script.** Credentials on the maintainer's machine. Rejected.

## Design

A new workflow, `.github/workflows/store-upload.yml`, triggered by `workflow_run`
on the `Publish` workflow completing. Reasons: it only starts when every Publish
job (npm, release assets) succeeded, so a version npm refused never reaches a
store; it uses the workflow file from the default branch, not from the release
tag; the upload script and the credentials run from the default branch, and the
tag's code (the build) runs in a step with no secrets; the existing jobs are untouched.
The tag name is `workflow_run.head_branch`; the tag is checked out by `head_sha`, not by name, so a same-named branch cannot stand in. `GH_TOKEN` is set only on the steps that call `gh`. Both jobs skip pre-releases (queried
with `gh release view`) and run in the GitHub environment `extension-stores`.

**Chrome job.**
1. Download the extension zip and `SHA256SUMS` from the release;
   `sha256sum -c --ignore-missing` must pass (this guards against corruption only;
   it is not a trust anchor, because the release assets are mutable).
2. The tag, `package.json` and the zip's `manifest.json` versions must agree.
3. `scripts/upload-chrome-store.mjs`: exchange the refresh token; POST the zip to
   the upload URL; if `uploadState` is `IN_PROGRESS`, poll `fetchStatus` on
   `lastAsyncUploadState` until `SUCCEEDED`; POST `:publish` with
   `publishType: DEFAULT_PUBLISH`, `skipReview: false`, `blockOnWarnings: false`.
   Success is exactly `PENDING_REVIEW`; store warnings are printed. Errors print
   the store's message and never headers or token responses.
4. Secrets (step-level env): `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
   `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`.

**Firefox job.**
1. `npm ci`, `node scripts/build-extension.mjs --firefox`,
   `git archive --format=zip -o source.zip HEAD` of the checked-out tag, and the
   same version agreement check.
2. `npx web-ext@10.8.0 sign --channel listed --source-dir dist-extension-firefox
   --upload-source-code source.zip
   --amo-metadata extension/store/amo-metadata.json --timeout 600000
   --approval-timeout 0`. Credentials come from `WEB_EXT_API_KEY` and
   `WEB_EXT_API_SECRET` at step level, never flags. The job ends at submission;
   there is no approval confirmation by design.
3. web-ext packs the directory itself, so the uploaded zip is not byte-identical
   to the one `build-extension.mjs` writes. Reviewers rebuild from the source zip,
   so the checksum line is dropped from the notes. Residual risk: web-ext's
   dependency tree runs with the AMO credentials in the environment; the
   credentials are scoped to that one step and the version is pinned.

**Failure handling.** Jobs are independent; re-run a failed one from the Actions
page. If Chrome uploaded but publish failed, the re-run fails at upload on the
duplicate version; the guide says to submit the uploaded draft from the dashboard
(or cancel a pending submission there) instead.

**Protections the maintainer sets once** (in the guide): the `extension-stores`
environment with a required reviewer and deployment limited to the default branch
(the workflow file lives there), "prevent self-review" off for a solo maintainer,
and a tag ruleset on `v*`. No `pull_request_target` or `workflow_dispatch` trigger
is added to this workflow.

**Deliverables.** The workflow, `scripts/upload-chrome-store.mjs` with a unit test
(mocked fetch), `extension/store/amo-metadata.json` (`version.approval_notes`,
text from the existing reviewer notes, made-up fixture only), and
`docs/store-upload.md`.

## Left to the builder

- Polling interval and deadline for the Chrome upload state.
- Exact wording of log messages.

## Calls made without the maintainer

- `web-ext` run through `npx` at a pinned version, not a dev dependency.
- The Chrome script takes `fetch` and `sleep` as parameters so a test can run it
  without the network; no live store call is part of CI.
- Pre-releases are skipped.
- No automatic resume of a half-finished Chrome submission (documented manual step).
