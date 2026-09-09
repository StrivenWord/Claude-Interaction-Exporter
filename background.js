// The content script's files, in load order: utils.js defines the renderers
// api.js and deliver.js build on, and content.js wires them to a message.
const CONTENT_SCRIPT_FILES = ['utils.js', 'api.js', 'deliver.js', 'content.js'];

// A tab left open since before install or update never receives the content
// script until it is reloaded, so inject into the ones already showing
// claude.ai and the first export works without a manual reload.
chrome.runtime.onInstalled.addListener(() => {
  console.log('Claude Interaction Exporter installed');

  chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPT_FILES
      }).catch(err => console.log('Could not inject into tab', tab.id, err));
    });
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ensureContentScript') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        // Always respond, even on this unlikely path -- otherwise the
        // waiting caller's message channel hangs instead of failing.
        sendResponse({ success: false, error: 'No active tab found' });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: CONTENT_SCRIPT_FILES
      }, () => {
        sendResponse({ success: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message });
      });
    });
    return true;
  }

  // JSZip is 95KB and only a batch export needs it, so it is kept out of the
  // manifest's content scripts and injected into the asking tab on demand.
  if (request.action === 'ensureZipSupport') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab to load ZIP support into' });
      return true;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['jszip.min.js']
    }, () => {
      sendResponse({ success: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message });
    });
    return true;
  }
});
