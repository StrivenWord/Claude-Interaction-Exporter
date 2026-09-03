// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Claude Interaction Exporter installed');
});

// Inject content script into already-open Claude.ai tabs when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['utils.js', 'content.js']
      }).catch(err => console.log('Could not inject into tab', tab.id, err));
    });
  });
});

// Handle messages from popup when content script might not be injected
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
        files: ['utils.js', 'content.js']
      }, () => {
        sendResponse({ success: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message });
      });
    });
    return true;
  }
});