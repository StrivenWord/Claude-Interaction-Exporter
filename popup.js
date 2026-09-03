// Get organization ID from storage
async function getOrgId() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['organizationId'], (result) => {
      resolve(result.organizationId);
    });
  });
}

// Send a message to the content script on tabId, and if nothing is listening
// yet -- a tab left open since before install/update never gets the content
// script until reloaded -- ask the background service worker to inject it,
// then retry once. Without this, that case fails silently until the user
// reloads the tab by hand.
function sendToContentScript(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const missingReceiver = chrome.runtime.lastError &&
        /Receiving end does not exist|Could not establish connection/.test(chrome.runtime.lastError.message || '');

      if (!missingReceiver) {
        resolve({ response, lastError: chrome.runtime.lastError });
        return;
      }

      chrome.runtime.sendMessage({ action: 'ensureContentScript' }, () => {
        chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
          resolve({ response: retryResponse, lastError: chrome.runtime.lastError });
        });
      });
    });
  });
}

// Check if org ID is configured on popup load
document.addEventListener('DOMContentLoaded', async () => {
  const orgId = await getOrgId();
  if (!orgId) {
    document.getElementById('setupNotice').style.display = 'block';
    document.getElementById('exportCurrent').disabled = true;
    document.getElementById('exportAll').disabled = true;
  }

  chrome.storage.sync.get(['defaultProject'], (result) => {
    document.getElementById('project').value = result.defaultProject || '';
  });
  chrome.storage.sync.get(['defaultContributor'], (result) => {
    document.getElementById('contributor').value = result.defaultContributor || '';
  });
  chrome.storage.sync.get(['defaultTags'], (result) => {
    document.getElementById('tags').value = result.defaultTags || '';
  });

  const manifest = chrome.runtime.getManifest();
  document.getElementById('versionInfo').textContent = manifest.version_name || `v${manifest.version}`;
});

// Handle options link click
document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
  
  // The popup exports whatever the active tab is showing. Chat conversations
  // live at /chat/<uuid>; tasks and other Cowork sessions at /cowork/<cse_id>,
  // and are a separate resource with a separate export path.
  async function getCurrentTarget() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);

    const chat = url.pathname.match(/\/chat\/([a-f0-9-]+)/);
    if (chat) {
      return { tab, kind: 'conversation', id: chat[1] };
    }

    const cowork = url.pathname.match(/\/cowork\/([A-Za-z0-9_-]+)/);
    if (cowork) {
      return { tab, kind: 'task', id: cowork[1] };
    }

    return { tab, kind: null, id: null };
  }
  
  // Show status message
  function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status');
    statusEl.className = `status ${type}`;
    statusEl.textContent = message;
    
    if (type === 'success') {
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = '';
      }, 3000);
    }
  }
  
  // Export current conversation
document.getElementById('exportCurrent').addEventListener('click', async () => {
  const button = document.getElementById('exportCurrent');
  button.disabled = true;
  showStatus('Fetching conversation...', 'info');
  
  try {
    const orgId = await getOrgId();
    const { tab, kind, id } = await getCurrentTarget();

    // Check if we're on Claude.ai
    if (!tab.url.includes('claude.ai')) {
      throw new Error('Please navigate to a Claude.ai conversation or task page first.');
    }
    if (!kind) {
      throw new Error('Could not detect a conversation or Cowork session. Make sure you are on a Claude.ai conversation or task page.');
    }
    // Only the org-scoped conversation endpoint needs the organization ID.
    if (kind === 'conversation' && !orgId) {
      throw new Error('Organization ID not configured. Click the setup link above to configure it.');
    }

    const common = {
      format: document.getElementById('format').value,
      includeMetadata: document.getElementById('includeMetadata').checked,
      project: document.getElementById('project').value.trim(),
      contributor: document.getElementById('contributor').value.trim(),
      tags: document.getElementById('tags').value.trim()
    };

    const message = kind === 'task'
      ? { action: 'exportTask', sessionId: id, ...common }
      : { action: 'exportConversation', conversationId: id, orgId, ...common };

    const { response, lastError } = await sendToContentScript(tab.id, message);
    if (lastError) {
      console.error('Chrome runtime error:', lastError);
      showStatus(`Error: ${lastError.message}`, 'error');
      button.disabled = false;
      return;
    }

    if (response?.success) {
      showStatus(`${kind === 'task' ? 'Task' : 'Conversation'} exported successfully!`, 'success');
    } else {
      const errorMsg = response?.error || 'Export failed';
      console.error('Export failed:', errorMsg, response?.details);
      showStatus(errorMsg, 'error');
    }
    button.disabled = false;
    } catch (error) {
      showStatus(error.message, 'error');
      button.disabled = false;
    }
  });
  
  // Browse conversations
  document.getElementById('browseConversations').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('browse.html') });
  });
  
  // Export all conversations
  document.getElementById('exportAll').addEventListener('click', async () => {
    const button = document.getElementById('exportAll');
    button.disabled = true;
    showStatus('Fetching all conversations...', 'info');
    
    try {
      const orgId = await getOrgId();
      
          if (!orgId) {
      throw new Error('Organization ID not configured. Click the setup link above to configure it.');
      }
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

          const { response, lastError } = await sendToContentScript(tab.id, {
      action: 'exportAllConversations',
      orgId,
      format: document.getElementById('format').value,
      includeMetadata: document.getElementById('includeMetadata').checked,
      project: document.getElementById('project').value.trim(),
      contributor: document.getElementById('contributor').value.trim(),
      tags: document.getElementById('tags').value.trim()
    });

    if (lastError) {
      console.error('Chrome runtime error:', lastError);
      showStatus(`Error: ${lastError.message}`, 'error');
      button.disabled = false;
      return;
    }

    if (response?.success) {
      if (response.warnings) {
        showStatus(response.warnings, 'info');
      } else {
        showStatus(`Exported ${response.count} conversations!`, 'success');
      }
    } else {
      const errorMsg = response?.error || 'Export failed';
      console.error('Export failed:', errorMsg, response?.details);
      showStatus(errorMsg, 'error');
    }
    button.disabled = false;
    } catch (error) {
      showStatus(error.message, 'error');
      button.disabled = false;
    }
  });