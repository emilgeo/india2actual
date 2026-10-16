// Opens the side panel (Chrome) or the sidebar (Firefox) when the toolbar icon is clicked.
if (chrome.sidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(error => console.error('Could not set the side panel behaviour', error));
} else if (globalThis.browser?.sidebarAction) {
  chrome.action.onClicked.addListener(() => browser.sidebarAction.toggle());
}
