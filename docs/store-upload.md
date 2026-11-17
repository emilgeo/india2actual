# Store upload setup

After a GitHub release is published and the Publish workflow succeeds, the
`Store upload` workflow submits that version to the Chrome Web Store and Firefox
Add-ons for review. Nothing runs until you approve the `extension-stores`
environment, once for each store. Review by the stores still takes days.

Pre-releases upload nothing, but the jobs still ask for approval and then finish
green with every step skipped; decline them. Re-running only part of a finished
Publish run starts this workflow again; decline that approval too, because the
stores would reject the repeated version anyway.

## One-time setup

**GitHub.** In the repository settings:
1. Environments, New environment `extension-stores`. Add yourself as a required
   reviewer and turn off "Prevent self-review" (otherwise nobody can approve).
   Limit deployment branches to `main`, because the workflow file is read from there.
2. Rules, Rulesets: protect tags matching `v*` so only maintainers can create them.
3. Add the secrets below to the environment (not to the repository).

**Chrome Web Store** (the listing must already exist and use 2-step verification).
1. In Google Cloud Console create a project and enable the Chrome Web Store API.
2. Configure the OAuth consent screen, then create an OAuth client of type
   Web application with `https://developers.google.com/oauthplayground` as a
   redirect URI.
3. In the OAuth Playground, use your own client ID and secret, authorize the
   scope `https://www.googleapis.com/auth/chromewebstore` with the Google account
   that owns the item, and copy the refresh token.
4. Publisher ID: Developer Dashboard, Publisher, Settings. Extension ID: the
   32-character ID on the item's Package tab.

Secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`,
`CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`.

**Firefox Add-ons.** On addons.mozilla.org, Developer Hub, Manage API Keys,
generate credentials. Secrets: `AMO_API_KEY`, `AMO_API_SECRET`.

## When something fails

- Each job runs on its own; re-run only the failed one from the Actions page.
- If Chrome's upload step fails or times out (it waits about 5 minutes), the
  package may still have arrived. Open the item in the dashboard, check the
  uploaded version, and submit it there. A submission already pending review
  makes a new upload fail; cancel it in the dashboard first.
- AMO rejects a repeated version number the same way.
- A refresh token for an unverified Google Cloud app in testing mode expires
  after 7 days; publish the OAuth app to production to avoid that.
- The reviewer notes for Firefox live in `extension/store/amo-metadata.json`.
