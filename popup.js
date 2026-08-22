// Get organization ID from storage
async function getOrgId() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['organizationId'], (result) => {
      resolve(result.organizationId);
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

    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Chrome runtime error:', chrome.runtime.lastError);
        showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
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
    });
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

          chrome.tabs.sendMessage(tab.id, {
      action: 'exportAllConversations',
      orgId,
      format: document.getElementById('format').value,
      includeMetadata: document.getElementById('includeMetadata').checked,
      project: document.getElementById('project').value.trim(),
      contributor: document.getElementById('contributor').value.trim(),
      tags: document.getElementById('tags').value.trim()
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Chrome runtime error:', chrome.runtime.lastError);
        showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
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
    });
    } catch (error) {
      showStatus(error.message, 'error');
      button.disabled = false;
    }
  });