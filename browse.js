// State management
let allConversations = [];
let filteredConversations = [];
let orgId = null;
let currentSort = 'updated_desc';

// Selected conversation UUIDs, kept independent of what's currently
// rendered/filtered so selections survive search/filter/sort changes.
let selectedIds = new Set();

// Cowork sessions, listed separately from conversations because they are a
// different resource with a different transcript format. See utils.js.
let allTasks = [];

// Session id to whether a schedule fired it, filled in as sessions are checked.
let taskSchedules = new Map();
let resolvingSchedules = false;

// Bucket label for conversations not attached to any Claude.ai Project
const NO_PROJECT = 'No Project';

// The bulk list endpoint returns project as a nested {uuid, name} object;
// the single-conversation endpoint (used at export time) returns a flat
// project_name string. Handle either shape so this keeps working if the
// API changes which one shows up where.
function getProjectName(conv) {
  return conv.project_name || (conv.project && conv.project.name) || NO_PROJECT;
}

// Model name mappings
const MODEL_DISPLAY_NAMES = {
  'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
  'claude-3-opus-20240229': 'Claude 3 Opus',
  'claude-3-haiku-20240307': 'Claude 3 Haiku',
  'claude-3-5-sonnet-20240620': 'Claude 3.5 Sonnet',
  'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
  'claude-3-5-sonnet-20241022': 'Claude 3.6 Sonnet',
  'claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet',
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'claude-opus-4-20250514': 'Claude Opus 4',
  'claude-opus-4-1-20250805': 'Claude Opus 4.1',
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-opus-4-5-20251101': 'Claude Opus 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-6': 'Claude Opus 4.6'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadOrgId();
  await loadDefaultProject();
  await loadDefaultContributor();
  await loadDefaultTags();
  await loadConversations();
  await loadTasks();
  setupEventListeners();

  const manifest = chrome.runtime.getManifest();
  document.getElementById('versionInfo').textContent = manifest.version_name || `v${manifest.version}`;
});

// Load the default frontgraph project key from storage and persist edits
async function loadDefaultProject() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['defaultProject'], (result) => {
      const input = document.getElementById('exportProject');
      input.value = result.defaultProject || '';
      input.addEventListener('change', () => {
        chrome.storage.sync.set({ defaultProject: input.value.trim() });
      });
      resolve();
    });
  });
}

// Load the default contributor name from storage and persist edits
async function loadDefaultContributor() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['defaultContributor'], (result) => {
      const input = document.getElementById('exportContributor');
      input.value = result.defaultContributor || '';
      input.addEventListener('change', () => {
        chrome.storage.sync.set({ defaultContributor: input.value.trim() });
      });
      resolve();
    });
  });
}

// Seed the tags field from the saved default. Unlike project/contributor, edits
// here are deliberately not written back — tags describe the export at hand, so
// a one-off shouldn't silently become the default for every export after it.
async function loadDefaultTags() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['defaultTags'], (result) => {
      document.getElementById('exportTags').value = result.defaultTags || '';
      resolve();
    });
  });
}

// Read the export settings shared by every export path on this page.
function exportOptions() {
  return {
    format: document.getElementById('exportFormat').value,
    includeMetadata: document.getElementById('includeMetadata').checked,
    project: document.getElementById('exportProject').value.trim(),
    contributor: document.getElementById('exportContributor').value.trim(),
    tags: document.getElementById('exportTags').value.trim()
  };
}

// Load organization ID from storage
async function loadOrgId() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['organizationId'], (result) => {
      orgId = result.organizationId;
      if (!orgId) {
        showError('Organization ID not configured. Please configure it in the extension options.');
      }
      resolve();
    });
  });
}

// Load all conversations
async function loadConversations() {
  if (!orgId) return;
  
  try {
    const response = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load conversations: ${response.status}`);
    }
    
    allConversations = await response.json();
    console.log(`Loaded ${allConversations.length} conversations`);
    
    // Infer models for conversations with null model
    allConversations = allConversations.map(conv => ({
      ...conv,
      model: inferModel(conv)
    }));
    
    // Extract unique models for filter
    const models = [...new Set(allConversations.map(c => c.model))].filter(m => m).sort();
    populateModelFilter(models);

    // Extract unique projects for filter (conversations with no project group under NO_PROJECT)
    const projects = [...new Set(allConversations.map(getProjectName))].sort();
    populateProjectFilter(projects);

    // Apply initial sort and display
    applyFiltersAndSort();
    
  } catch (error) {
    console.error('Error loading conversations:', error);
    showError(`Failed to load conversations: ${error.message}`);
  }
}

// Load Cowork sessions. These are listed for their ids and rough labels only:
// whether a session was fired by a schedule, and its real title, come from
// replaying its event log at export time.
async function loadTasks() {
  const tasksContent = document.getElementById('tasksContent');

  try {
    allTasks = await fetchCoworkList();
    console.log(`Loaded ${allTasks.length} Cowork sessions`);

    displayTasks();
    document.getElementById('exportAllTasksBtn').disabled = allTasks.length === 0;

  } catch (error) {
    console.error('Error loading tasks:', error);
    document.getElementById('tasksStats').textContent = 'unavailable';
    tasksContent.innerHTML = `<div class="error">${escapeHtml(`Failed to load tasks: ${error.message}`)}</div>`;
  }
}

// Whether a session was fired by a schedule: true, false, or null when it
// hasn't been determined yet. The list response doesn't carry it unless it
// happens to include a trigger, so it is resolved per session and remembered.
function taskScheduledState(task) {
  if (taskSchedules.has(task.id)) {
    return taskSchedules.get(task.id);
  }
  return task.trigger_id ? true : null;
}

function scheduledOnlyChecked() {
  return document.getElementById('scheduledOnly').checked;
}

// Sessions known not to be scheduled are hidden; undetermined ones stay visible
// rather than being hidden on a guess.
function visibleTasks() {
  if (!scheduledOnlyChecked()) {
    return allTasks;
  }
  return allTasks.filter(task => taskScheduledState(task) !== false);
}

// Reading one page of a session says whether a schedule fired it. Done on
// demand rather than at load, since it costs a request per session. Results
// accumulate, so toggling the filter again is free.
async function resolveTaskSchedules() {
  if (resolvingSchedules) return;

  const pending = allTasks.filter(task => taskScheduledState(task) === null);
  if (!pending.length) return;

  resolvingSchedules = true;
  const stats = document.getElementById('tasksStats');
  const batchSize = 3;
  let checked = 0;

  try {
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      stats.textContent = `checking ${checked + 1}–${checked + batch.length} of ${pending.length}…`;

      await Promise.all(batch.map(async (task) => {
        try {
          taskSchedules.set(task.id, await fetchCoworkScheduledFlag(task.id));
        } catch (error) {
          console.error(`Could not determine whether ${task.id} was scheduled:`, error);
        }
      }));

      checked += batch.length;
      displayTasks();

      if (checked < pending.length) {
        stats.textContent = `checked ${checked} of ${pending.length}…`;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  } finally {
    resolvingSchedules = false;
    displayTasks();
  }
}

// Display Cowork sessions in their own table
function displayTasks() {
  const tasksContent = document.getElementById('tasksContent');
  const shown = visibleTasks();
  const stats = document.getElementById('tasksStats');

  stats.textContent = shown.length === allTasks.length
    ? `${allTasks.length} sessions`
    : `${shown.length} of ${allTasks.length} sessions`;

  if (allTasks.length === 0) {
    tasksContent.innerHTML = '<div class="no-results">No Cowork sessions found</div>';
    return;
  }
  if (shown.length === 0) {
    tasksContent.innerHTML = '<div class="no-results">No scheduled runs among these sessions</div>';
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th>Session</th>
          <th>Created</th>
          <th>Last Active</th>
          <th>Scheduled</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  shown.forEach(task => {
    const safeTitle = escapeHtml(task.title);
    const state = taskScheduledState(task);
    const scheduled = state === true ? 'Yes' : state === false ? 'No' : '—';

    html += `
      <tr data-id="${task.id}">
        <td>
          <div class="conversation-name">
            <a href="https://claude.ai/cowork/${task.id}" target="_blank" title="${safeTitle}">
              ${safeTitle}
            </a>
          </div>
        </td>
        <td class="date">${task.created_at ? new Date(task.created_at).toLocaleDateString() : '—'}</td>
        <td class="date">${task.updated_at ? new Date(task.updated_at).toLocaleDateString() : '—'}</td>
        <td title="${state === null ? 'Not yet determined' : 'From the session\'s first event'}">${scheduled}</td>
        <td>${escapeHtml(task.status)}</td>
        <td>
          <div class="actions">
            <button class="btn-small btn-export btn-export-task" data-id="${task.id}" data-name="${safeTitle}">
              Export
            </button>
            <button class="btn-small btn-view btn-view-task" data-id="${task.id}">
              View
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  tasksContent.innerHTML = html;

  document.querySelectorAll('.btn-export-task').forEach(btn => {
    btn.addEventListener('click', (e) => {
      exportTask(e.target.dataset.id, e.target.dataset.name);
    });
  });

  document.querySelectorAll('.btn-view-task').forEach(btn => {
    btn.addEventListener('click', (e) => {
      window.open(`https://claude.ai/cowork/${e.target.dataset.id}`, '_blank');
    });
  });
}

// Populate model filter dropdown
function populateModelFilter(models) {
  const modelFilter = document.getElementById('modelFilter');
  modelFilter.innerHTML = '<option value="">All Models</option>';
  
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = formatModelName(model);
    modelFilter.appendChild(option);
  });
}

// Format model name for display
function formatModelName(model) {
  return MODEL_DISPLAY_NAMES[model] || model;
}

// Populate project filter dropdown
function populateProjectFilter(projects) {
  const projectFilter = document.getElementById('projectFilter');
  projectFilter.innerHTML = '<option value="">All Projects</option>';

  projects.forEach(project => {
    const option = document.createElement('option');
    option.value = project;
    option.textContent = project;
    projectFilter.appendChild(option);
  });
}

// Get model badge class
function getModelBadgeClass(model) {
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return '';
}

// Apply filters and sorting
function applyFiltersAndSort() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const modelFilter = document.getElementById('modelFilter').value;
  const projectFilter = document.getElementById('projectFilter').value;

  // Filter conversations
  filteredConversations = allConversations.filter(conv => {
    const matchesSearch = !searchTerm ||
      conv.name.toLowerCase().includes(searchTerm) ||
      (conv.summary && conv.summary.toLowerCase().includes(searchTerm));

    const matchesModel = !modelFilter || conv.model === modelFilter;
    const matchesProject = !projectFilter || getProjectName(conv) === projectFilter;

    return matchesSearch && matchesModel && matchesProject;
  });
  
  // Sort conversations
  sortConversations();
  
  // Update display
  displayConversations();
  updateStats();
}

// Sort conversations based on current sort setting
function sortConversations() {
  const [field, direction] = currentSort.split('_');
  
  filteredConversations.sort((a, b) => {
    let aVal, bVal;
    
    switch (field) {
      case 'name':
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case 'created':
        aVal = new Date(a.created_at);
        bVal = new Date(b.created_at);
        break;
      case 'updated':
        aVal = new Date(a.updated_at);
        bVal = new Date(b.updated_at);
        break;
      case 'project':
        aVal = getProjectName(a).toLowerCase();
        bVal = getProjectName(b).toLowerCase();
        break;
      default:
        return 0;
    }
    
    if (direction === 'asc') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });
}

// Display conversations in table
function displayConversations() {
  const tableContent = document.getElementById('tableContent');
  
  if (filteredConversations.length === 0) {
    tableContent.innerHTML = '<div class="no-results">No conversations found</div>';
    return;
  }
  
  let html = `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="selectAllVisible"></th>
          <th class="sortable" data-sort="name">Name</th>
          <th class="sortable" data-sort="updated">Last Updated</th>
          <th class="sortable" data-sort="created">Created</th>
          <th>Model</th>
          <th class="sortable" data-sort="project">Project</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  filteredConversations.forEach(conv => {
    const updatedDate = new Date(conv.updated_at).toLocaleDateString();
    const createdDate = new Date(conv.created_at).toLocaleDateString();
    const modelBadgeClass = getModelBadgeClass(conv.model);
    const checked = selectedIds.has(conv.uuid) ? 'checked' : '';
    const safeConvName = escapeHtml(conv.name);
    const safeProjectName = escapeHtml(getProjectName(conv));

    html += `
      <tr data-id="${conv.uuid}">
        <td><input type="checkbox" class="row-select" data-id="${conv.uuid}" ${checked}></td>
        <td>
          <div class="conversation-name">
            <a href="https://claude.ai/chat/${conv.uuid}" target="_blank" title="${safeConvName}">
              ${safeConvName}
            </a>
          </div>
        </td>
        <td class="date">${updatedDate}</td>
        <td class="date">${createdDate}</td>
        <td>
          <span class="model-badge ${modelBadgeClass}">
            ${formatModelName(conv.model)}
          </span>
        </td>
        <td>${safeProjectName}</td>
        <td>
          <div class="actions">
            <button class="btn-small btn-export" data-id="${conv.uuid}" data-name="${safeConvName}">
              Export
            </button>
            <button class="btn-small btn-view" data-id="${conv.uuid}">
              View
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  tableContent.innerHTML = html;

  // Add export button listeners
  document.querySelectorAll('.btn-export').forEach(btn => {
    btn.addEventListener('click', (e) => {
      exportConversation(e.target.dataset.id, e.target.dataset.name);
    });
  });

  // Add view button listeners
  document.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const conversationId = e.target.dataset.id;
      window.open(`https://claude.ai/chat/${conversationId}`, '_blank');
    });
  });

  // Row selection checkboxes
  document.querySelectorAll('.row-select').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      updateSelectionUI();
    });
  });

  // Select-all-visible checkbox
  document.getElementById('selectAllVisible').addEventListener('change', (e) => {
    filteredConversations.forEach(conv => {
      if (e.target.checked) selectedIds.add(conv.uuid);
      else selectedIds.delete(conv.uuid);
    });
    displayConversations();
  });

  updateSelectionUI();

  // Enable export all button
  document.getElementById('exportAllBtn').disabled = false;
}

// Reflect current selection in the header checkbox, stats, and Export Selected button
function updateSelectionUI() {
  const visibleIds = filteredConversations.map(c => c.uuid);
  const visibleSelected = visibleIds.filter(id => selectedIds.has(id));

  const selectAllVisible = document.getElementById('selectAllVisible');
  if (selectAllVisible) {
    selectAllVisible.checked = visibleIds.length > 0 && visibleSelected.length === visibleIds.length;
    selectAllVisible.indeterminate = visibleSelected.length > 0 && visibleSelected.length < visibleIds.length;
  }

  const exportSelectedBtn = document.getElementById('exportSelectedBtn');
  if (exportSelectedBtn) {
    exportSelectedBtn.disabled = selectedIds.size === 0;
    exportSelectedBtn.textContent = selectedIds.size > 0 ? `Export Selected (${selectedIds.size})` : 'Export Selected';
  }

  updateStats();
}

// Update statistics
function updateStats() {
  const stats = document.getElementById('stats');
  let text = `Showing ${filteredConversations.length} of ${allConversations.length} conversations`;
  if (selectedIds.size > 0) text += ` — ${selectedIds.size} selected`;
  stats.textContent = text;
}

// Fetch one conversation's full message tree.
async function fetchConversationDetail(conversationId) {
  const response = await fetch(
    `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`,
    {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation: ${response.status}`);
  }

  return await response.json();
}

// Reading one Cowork session takes several paged requests; fetchCoworkSession
// in utils.js owns that loop.

// Export single conversation
async function exportConversation(conversationId, conversationName) {
  const opts = exportOptions();

  try {
    showToast(`Exporting ${conversationName}...`);

    const data = await fetchConversationDetail(conversationId);

    // Infer model if null
    data.model = inferModel(data);

    let content, filename, type;
    switch (opts.format) {
      case 'markdown':
        content = convertToMarkdown(data, opts.includeMetadata, opts);
        filename = buildFrontgraphFilename(data);
        type = 'text/markdown';
        break;
      case 'text':
        content = convertToText(data, opts.includeMetadata, opts);
        filename = `claude-${conversationName || conversationId}.txt`;
        type = 'text/plain';
        break;
      default:
        content = JSON.stringify(withExportTags(data, opts.tags), null, 2);
        filename = `claude-${conversationName || conversationId}.json`;
        type = 'application/json';
    }

    downloadFile(content, filename, type);
    showToast(`Exported: ${conversationName}`);

  } catch (error) {
    console.error('Export error:', error);
    showToast(`Failed to export: ${error.message}`, true);
  }
}

// Export single task
async function exportTask(sessionId, sessionTitle) {
  const opts = exportOptions();

  try {
    showToast(`Exporting ${sessionTitle}...`);

    const session = await fetchCoworkSession(sessionId);
    const { content, filename, type } = renderTaskExport(session, opts.format, opts);

    downloadFile(content, filename, type);
    showToast(`Exported: ${session.title}`);

  } catch (error) {
    console.error('Export error:', error);
    showToast(`Failed to export: ${error.message}`, true);
  }
}

// Export all conversations currently passing the search/model/project filters
async function exportAllFiltered() {
  await exportBatch({
    items: filteredConversations,
    buttonId: 'exportAllBtn',
    defaultLabel: 'Export All',
    noun: 'conversations',
    renderItem: renderConversationFile
  });
}

// Export only the checked rows, regardless of what's currently filtered/visible
async function exportSelected() {
  await exportBatch({
    items: allConversations.filter(c => selectedIds.has(c.uuid)),
    buttonId: 'exportSelectedBtn',
    defaultLabel: 'Export Selected',
    noun: 'conversations',
    renderItem: renderConversationFile
  });
}

// Export every listed Cowork session, into their own folder in the ZIP so a
// task and a conversation sharing a date and title can't collide.
async function exportAllTasks() {
  const scheduledOnly = scheduledOnlyChecked();

  await exportBatch({
    // Start from what the table shows, so sessions already known not to be
    // scheduled aren't fetched only to be discarded.
    items: visibleTasks(),
    buttonId: 'exportAllTasksBtn',
    defaultLabel: 'Export All Tasks',
    noun: 'tasks',
    folder: 'tasks/',
    renderItem: async (row) => {
      const session = await fetchCoworkSession(row.id);
      // Whether a session was fired by a schedule is only knowable from its
      // log, so this filter runs after the fetch rather than over the list.
      if (scheduledOnly && !session.scheduled) return null;
      const opts = exportOptions();
      return renderTaskExport(session, opts.format, opts);
    }
  });
}

// One conversation row to one file, in whichever format the header selects.
async function renderConversationFile(conv) {
  const data = await fetchConversationDetail(conv.uuid);

  // Infer model if null
  data.model = inferModel(data);

  const opts = exportOptions();
  const safeName = sanitizeFilename(conv.name);

  switch (opts.format) {
    case 'markdown':
      return {
        content: convertToMarkdown(data, opts.includeMetadata, opts),
        filename: buildFrontgraphFilename(data)
      };
    case 'text':
      return {
        content: convertToText(data, opts.includeMetadata, opts),
        filename: `${safeName}.txt`
      };
    default:
      return {
        content: JSON.stringify(withExportTags(data, opts.tags), null, 2),
        filename: `${safeName}.json`
      };
  }
}

// Shared batch-export flow: renders each item to a file, zips, downloads.
// Callers differ only in renderItem, which returns {filename, content} or null
// to leave an item out of the archive.
async function exportBatch({ items, buttonId, defaultLabel, noun, folder = '', renderItem }) {
  const button = document.getElementById(buttonId);
  button.disabled = true;
  button.textContent = 'Preparing...';

  // Show progress modal
  const progressModal = document.getElementById('progressModal');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressStats = document.getElementById('progressStats');
  progressModal.style.display = 'block';

  let cancelExport = false;
  const cancelButton = document.getElementById('cancelExport');
  cancelButton.onclick = () => {
    cancelExport = true;
    progressText.textContent = 'Cancelling...';
  };

  try {
    // Create a new ZIP file
    const zip = new JSZip();
    const total = items.length;
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    const failedItems = [];

    progressText.textContent = `Exporting ${total} ${noun}...`;

    // Process items in batches to avoid overwhelming the API
    const batchSize = 3; // Process 3 at a time
    for (let i = 0; i < total; i += batchSize) {
      if (cancelExport) break;

      const batch = items.slice(i, Math.min(i + batchSize, total));
      await Promise.all(batch.map(async (item) => {
        const label = item.name || item.title || item.uuid || item.id;
        try {
          const file = await renderItem(item);
          if (!file) {
            skipped++;
            return;
          }
          zip.file(folder + sanitizeFilename(file.filename), file.content);
          completed++;
        } catch (error) {
          console.error(`Failed to export ${label}:`, error);
          failed++;
          failedItems.push(label);
        }
      }));

      // Update progress
      const progress = Math.round((completed + skipped + failed) / total * 100);
      progressBar.style.width = `${progress}%`;
      progressStats.textContent = `${completed} succeeded, ${failed} failed out of ${total}`;

      // Small delay between batches
      if (i + batchSize < total && !cancelExport) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    if (cancelExport) {
      progressModal.style.display = 'none';
      showToast('Export cancelled', true);
      return;
    }

    // Add a summary file
    const opts = exportOptions();
    const summary = {
      export_date: new Date().toISOString(),
      [`total_${noun}`]: total,
      successful_exports: completed,
      skipped_exports: skipped,
      failed_exports: failed,
      failed_items: failedItems,
      format: opts.format,
      include_metadata: opts.includeMetadata,
      tags: normalizeTags(opts.tags)
    };
    zip.file(`${folder}export_summary.json`, JSON.stringify(summary, null, 2));

    // Generate and download the ZIP file
    progressText.textContent = 'Creating ZIP file...';
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6 // Medium compression
      }
    }, (metadata) => {
      // Update progress during ZIP creation
      const zipProgress = Math.round(metadata.percent);
      progressBar.style.width = `${zipProgress}%`;
    });

    // Download the ZIP file
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude-${noun}-${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    progressModal.style.display = 'none';

    if (failed > 0) {
      showToast(`Exported ${completed} of ${total} ${noun} (${failed} failed). Check export_summary.json in the ZIP for details.`);
    } else {
      showToast(`Successfully exported ${completed} ${noun}!`);
    }

  } catch (error) {
    console.error('Export error:', error);
    progressModal.style.display = 'none';
    showToast(`Export failed: ${error.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = defaultLabel;
    updateSelectionUI(); // restores the "(N)" suffix on Export Selected, if any remain checked
  }
}

// Conversion functions are now imported from utils.js
// Functions available: getCurrentBranch, convertToMarkdown, convertToText, downloadFile

// Show error message
function showError(message) {
  const tableContent = document.getElementById('tableContent');
  tableContent.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

// Show toast notification
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#d32f2f' : '#333';
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Setup event listeners
function setupEventListeners() {
  // Search input
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    const searchBox = document.getElementById('searchBox');
    if (e.target.value) {
      searchBox.classList.add('has-text');
    } else {
      searchBox.classList.remove('has-text');
    }
    applyFiltersAndSort();
  });
  
  // Clear search
  document.getElementById('clearSearch').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchBox').classList.remove('has-text');
    applyFiltersAndSort();
  });
  
  // Model filter
  document.getElementById('modelFilter').addEventListener('change', applyFiltersAndSort);

  // Project filter
  document.getElementById('projectFilter').addEventListener('change', applyFiltersAndSort);
  
  // Sort dropdown
  document.getElementById('sortBy').addEventListener('change', (e) => {
    currentSort = e.target.value;
    applyFiltersAndSort();
  });
  
  // Export all button
  document.getElementById('exportAllBtn').addEventListener('click', exportAllFiltered);

  // Export selected button
  document.getElementById('exportSelectedBtn').addEventListener('click', exportSelected);

  // Export all tasks button
  document.getElementById('exportAllTasksBtn').addEventListener('click', exportAllTasks);

  // Scheduled-only filter. Turning it on has to check any sessions whose origin
  // isn't known yet, which the list response doesn't tell us.
  document.getElementById('scheduledOnly').addEventListener('change', async () => {
    displayTasks();
    if (scheduledOnlyChecked()) {
      await resolveTaskSchedules();
    }
  });
}
