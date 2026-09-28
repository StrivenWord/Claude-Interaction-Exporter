// State management
let allConversations = [];
let allTasks = [];
let filteredInteractions = [];
let orgId = null;
let currentSort = 'updated_desc';

// Selected interaction IDs (conversations use uuid, tasks use id)
let selectedIds = new Set();

// Session id to whether a schedule fired it, and to the model that answered.
// Both come from one preview read per session, filled in on demand.
let taskSchedules = new Map();
let taskModels = new Map();
let resolvingSchedules = false;

// Whether the session list stopped short of everything available.
let tasksTruncated = false;

// Bucket label for interactions not attached to any Claude.ai Project
const NO_PROJECT = 'No Project';

// The bulk list endpoint returns project as a nested {uuid, name} object;
// the single-conversation endpoint (used at export time) returns a flat
// project_name string. Handle either shape so this keeps working if the
// API changes which one shows up where. Cowork sessions are normalized to
// the flat spelling, so they go through here too.
function getProjectName(item) {
  return item.project_name || (item.project && item.project.name) || NO_PROJECT;
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
  showVersion('versionInfo');

  await loadOrgId();
  await loadDefaultProject();
  await loadDefaultContributor();
  await loadDefaultTags();
  await loadConversations();
  await loadTasks();
  setupEventListeners();
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
    includeToolActivity: document.getElementById('includeToolActivity').checked,
    includeImages: document.getElementById('includeImages').checked,
    includeThinking: document.getElementById('includeThinking').checked,
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
    allConversations = await fetchConversationList(orgId);
    console.log(`Loaded ${allConversations.length} conversations`);
    
    // Infer models for conversations with null model
    allConversations = allConversations.map(conv => applyModel({ ...conv }));
    
    // Apply initial sort and display
    applyFiltersAndSort();
    
  } catch (error) {
    console.error('Error loading conversations:', error);
    showError(`Failed to load conversations: ${error.message}`);
  }
}

// Load Cowork sessions. These are listed for their ids and rough labels only:
// a session's real title comes from replaying its event log at export time,
// and whether a schedule fired it, plus which model answered, from a short
// preview read (resolveTaskPreviews).
async function loadTasks() {
  try {
    const { rows, truncated } = await fetchCoworkList();
    allTasks = rows;
    tasksTruncated = truncated;
    console.log(`Loaded ${allTasks.length} Cowork sessions${truncated ? ' (list truncated)' : ''}`);
    applyFiltersAndSort();
  } catch (error) {
    console.error('Error loading tasks:', error);
    showError(`Failed to load Cowork sessions: ${error.message}`);
  }
}

// Whether a session was fired by a schedule: true, false, UNKNOWN_SCHEDULE when
// it was checked and the check failed, or null when it hasn't been checked yet.
// The list response doesn't carry it unless it happens to include a trigger, so
// it is resolved per session and remembered.
//
// A failed check is remembered as deliberately as a successful one. Storing
// nothing left it looking un-checked, so every toggle of the filter retried
// every session that had already failed — which was the only part of this that
// wasn't actually free the second time.
function taskScheduledState(task) {
  if (taskSchedules.has(task.id)) {
    return taskSchedules.get(task.id);
  }
  return task.trigger_id ? true : null;
}

// A session whose origin could not be read. Distinct from null, which means
// nobody has looked yet.
const UNKNOWN_SCHEDULE = 'unknown';

// Reading a session's first user event says whether a schedule fired it. Done
// on demand rather than at load, since it costs a request per session — but
// only the first event is read, and the connection is dropped as soon as it
// arrives, so this is one short round trip each rather than a buffered page.
// Every answer is remembered, failures included, so toggling the filter again
// really is free.
async function resolveTaskPreviews() {
  if (resolvingSchedules) return;

  const pending = allTasks.filter(task => taskScheduledState(task) === null);
  if (!pending.length) return;

  resolvingSchedules = true;
  const batchSize = 3;
  let checked = 0;
  let failed = 0;

  try {
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);

      await Promise.all(batch.map(async (task) => {
        try {
          const preview = await fetchCoworkPreview(task.id);
          taskSchedules.set(task.id, preview.scheduled);
          if (preview.model) taskModels.set(task.id, preview.model);
        } catch (error) {
          console.error(`Could not determine whether ${task.id} was scheduled:`, error);
          taskSchedules.set(task.id, UNKNOWN_SCHEDULE);
          failed++;
        }
      }));

      checked += batch.length;
      applyFiltersAndSort();

      if (checked < pending.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  } finally {
    resolvingSchedules = false;
    applyFiltersAndSort();
  }

  // Sessions whose origin is unknown stay listed rather than being hidden, so
  // say why the list may hold more than the filter asked for.
  if (failed) {
    showToast(`Couldn't read ${failed} of ${pending.length} sessions. They are still listed.`, true);
  }
}

// Derive a readable name from a model id the map above has never heard of, so
// a model released after this build still reads as a name rather than an id.
// Handles both id orders Anthropic has used: claude-opus-4-5-20251101 and the
// older claude-3-7-sonnet-20250219.
function deriveModelName(model) {
  const titled = word => `${word[0].toUpperCase()}${word.slice(1)}`;

  // claude-opus-4-5-20251101, claude-sonnet-4-6, claude-fable-5. The minor
  // version is held to one or two digits and has to be the last dash-separated
  // number, so the trailing date stamp on claude-opus-5-20260401 is not read
  // as one — which would name that model "Opus 5.20260401".
  const current = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?=-|$))?/.exec(model);
  if (current) {
    const [, family, major, minor] = current;
    return `Claude ${titled(family)} ${minor ? `${major}.${minor}` : major}`;
  }

  // The older order, where the version came first: claude-3-7-sonnet-20250219.
  // The family name anchors the end here, so a date stamp can't be captured.
  const legacy = /^claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)/.exec(model);
  if (legacy) {
    const [, major, minor, family] = legacy;
    return `Claude ${minor ? `${major}.${minor}` : major} ${titled(family)}`;
  }

  return model;
}

// Format model name for display
function formatModelName(model) {
  return MODEL_DISPLAY_NAMES[model] || deriveModelName(model);
}

// A Cowork session the list endpoint returned no timestamps for would render
// "Invalid Date" in both date columns. Sorting already handles the missing
// case, in compareMissing; this is the display half of the same thing.
function formatTableDate(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

// Projects the Project filter can usefully offer under the current Type and
// "Only Scheduled Tasks" selection. A project with no interactions of the
// selected type could only ever produce an empty list, so it isn't listed.
function availableProjects(typeFilter, scheduledOnly) {
  const names = new Set();

  if (typeFilter !== 'cowork') {
    allConversations.forEach(conv => names.add(getProjectName(conv)));
  }

  if (typeFilter !== 'chat') {
    allTasks
      .filter(task => !scheduledOnly || taskScheduledState(task) !== false)
      .forEach(task => names.add(getProjectName(task)));
  }

  return [...names].sort();
}

// Models the Model filter can usefully offer under the current Type selection.
// A Cowork session's model isn't in the list response, so it appears here only
// once a preview read has found it.
function availableModels(typeFilter) {
  const names = new Set();

  if (typeFilter !== 'cowork') {
    allConversations.forEach(conv => conv.model && names.add(conv.model));
  }
  if (typeFilter !== 'chat') {
    taskModels.forEach(model => model && names.add(model));
  }

  return [...names].sort();
}

// Rebuild a filter dropdown for the values currently available. A chosen value
// that has dropped out of that set is kept as a marked option rather than
// silently reset, so the filter still reflects what the user picked and the
// table can explain why it came back empty.
function refreshFilterOptions(select, allLabel, values, labelFor) {
  const selected = select.value;

  // Filtering runs on every keystroke and after every background schedule
  // check; rebuilding an unchanged dropdown would close it under the user.
  const signature = [selected, ...values].join('\n');
  if (select.dataset.options === signature) return;
  select.dataset.options = signature;

  select.innerHTML = `<option value="">${allLabel}</option>`;

  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = labelFor(value);
    select.appendChild(option);
  });

  if (selected && !values.includes(selected)) {
    const option = document.createElement('option');
    option.value = selected;
    option.textContent = `${labelFor(selected)} (no matches)`;
    select.appendChild(option);
  }

  select.value = selected;
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
  const typeFilter = document.getElementById('typeFilter').value;
  const scheduledOnlyChecked = document.getElementById('scheduledOnlyCheckbox').checked;

  // Type narrows which projects and models exist, so both dropdowns are
  // rebuilt before their values are read.
  refreshFilterOptions(
    document.getElementById('projectFilter'),
    'All Projects',
    availableProjects(typeFilter, scheduledOnlyChecked),
    name => name
  );
  refreshFilterOptions(
    document.getElementById('modelFilter'),
    'All Models',
    availableModels(typeFilter),
    formatModelName
  );

  const projectFilter = document.getElementById('projectFilter').value;
  const modelFilter = document.getElementById('modelFilter').value;

  const filteredConversations = allConversations.filter(conv => {
    const matchesSearch = !searchTerm ||
      conv.name.toLowerCase().includes(searchTerm) ||
      (conv.summary && conv.summary.toLowerCase().includes(searchTerm));

    const matchesModel = !modelFilter || conv.model === modelFilter;
    const matchesProject = !projectFilter || getProjectName(conv) === projectFilter;
    const matchesType = !typeFilter || typeFilter === 'chat';

    return matchesSearch && matchesModel && matchesProject && matchesType;
  });

  const filteredTasks = allTasks.filter(task => {
    const matchesSearch = !searchTerm ||
      task.title.toLowerCase().includes(searchTerm);

    const matchesProject = !projectFilter || getProjectName(task) === projectFilter;
    // A session matches a model choice only once its model is known.
    const matchesModel = !modelFilter || taskModels.get(task.id) === modelFilter;
    const matchesType = !typeFilter || typeFilter === 'cowork';
    const matchesScheduled = !scheduledOnlyChecked || taskScheduledState(task) !== false;

    return matchesSearch && matchesProject && matchesModel && matchesType && matchesScheduled;
  });

  // Combine and sort
  filteredInteractions = combineAndSortInteractions(filteredConversations, filteredTasks);

  // Update display
  displayInteractions();
  updateStats();
}

// Combine conversations and tasks, then sort
function combineAndSortInteractions(conversations, tasks) {
  const interactions = [
    ...conversations.map(conv => ({
      type: 'chat',
      uuid: conv.uuid,
      id: conv.uuid,
      name: conv.name,
      title: conv.name,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      model: conv.model,
      project: getProjectName(conv),
      summary: conv.summary,
      _original: conv
    })),
    ...tasks.map(task => ({
      type: 'cowork',
      uuid: task.id,
      id: task.id,
      name: task.title,
      title: task.title,
      created_at: task.created_at,
      updated_at: task.updated_at,
      model: null,
      project: task.project_name || null,
      status: task.status,
      _original: task
    }))
  ];

  const [field, direction] = currentSort.split('_');
  interactions.sort((a, b) => compareInteractions(a, b, field, direction));

  return interactions;
}

// A row with nothing to compare on — a Cowork session the list endpoint gave
// no dates or project for — goes last whichever way the sort runs, rather than
// riding the top on comparisons that fail in both directions.
function compareMissing(aMissing, bMissing) {
  if (aMissing && bMissing) return 0;
  return aMissing ? 1 : -1;
}

// Order two interactions by the field and direction the Sort by dropdown (or a
// column header) selected. Returns 0 for ties, leaving equal rows in the order
// they were combined so repeated renders don't reshuffle them.
function compareInteractions(a, b, field, direction) {
  const sign = direction === 'asc' ? 1 : -1;

  switch (field) {
    case 'created':
    case 'updated': {
      const aTime = new Date(a[`${field}_at`]).getTime();
      const bTime = new Date(b[`${field}_at`]).getTime();
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return compareMissing(Number.isNaN(aTime), Number.isNaN(bTime));
      }
      return sign * Math.sign(aTime - bTime);
    }
    case 'name':
    case 'project': {
      const aText = (field === 'name' ? a.name : a.project) || '';
      const bText = (field === 'name' ? b.name : b.project) || '';
      if (!aText || !bText) return compareMissing(!aText, !bText);
      return sign * aText.localeCompare(bText, undefined, { sensitivity: 'base' });
    }
    default:
      return 0;
  }
}

// Sort on a clicked column header: a new column starts newest-first for dates
// and A-Z for text, and clicking the column already sorted on flips it. The
// Sort by dropdown is kept in step, since both drive the same state.
function sortByColumn(field) {
  const [currentField, currentDirection] = currentSort.split('_');

  const direction = field === currentField
    ? (currentDirection === 'asc' ? 'desc' : 'asc')
    : (field === 'name' || field === 'project' ? 'asc' : 'desc');

  currentSort = `${field}_${direction}`;
  document.getElementById('sortBy').value = currentSort;
  applyFiltersAndSort();
}

// Spell out which filters produced an empty list. Combinations like a project
// that holds chats but no Cowork sessions are legitimately empty, so the table
// says which criteria to loosen rather than looking broken.
function emptyResultsMessage() {
  const typeFilter = document.getElementById('typeFilter').value;
  const scheduledOnly = document.getElementById('scheduledOnlyCheckbox').checked;
  const project = document.getElementById('projectFilter').value;
  const model = document.getElementById('modelFilter').value;
  const searchTerm = document.getElementById('searchInput').value.trim();

  if (!allConversations.length && !allTasks.length) {
    return 'No interactions found';
  }

  // Only chats have a model, so asking for a model while viewing sessions can
  // never match — say so rather than listing it as one criterion among several.
  if (model && typeFilter === 'cowork' && !taskModels.size) {
    return escapeHtml(`No Cowork session's model has been read yet, so none can match ${formatModelName(model)}. Clear the Model filter above to see them.`);
  }

  let subject = typeFilter === 'cowork' ? 'Cowork sessions'
    : typeFilter === 'chat' || model ? 'chat conversations'
    : 'interactions';
  if (typeFilter === 'cowork' && scheduledOnly) subject = `scheduled ${subject}`;

  const criteria = [];
  if (project) criteria.push(`in the project “${project}”`);
  if (model) criteria.push(`using ${formatModelName(model)}`);
  if (searchTerm) criteria.push(`matching “${searchTerm}”`);

  const detail = criteria.length ? ` ${criteria.join(' ')}` : '';
  return escapeHtml(`No ${subject}${detail} are available. Try widening the filters above.`);
}

// Display interactions (conversations and tasks) in unified table
function displayInteractions() {
  const tableContent = document.getElementById('tableContent');

  if (filteredInteractions.length === 0) {
    tableContent.innerHTML = `<div class="no-results">${emptyResultsMessage()}</div>`;
    // Both export buttons act on the filtered list, so neither has anything to do.
    document.getElementById('exportAllBtn').disabled = true;
    document.getElementById('exportSelectedBtn').disabled = true;
    return;
  }

  // Mark the column currently sorted on, which the header arrow styling reads.
  const [sortField, sortDirection] = currentSort.split('_');
  const sortableTh = (field, label) =>
    `<th class="sortable${field === sortField ? ` sorted-${sortDirection}` : ''}" data-sort="${field}">${label}</th>`;

  let html = `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="selectAllVisible"></th>
          ${sortableTh('name', 'Name')}
          <th>Type</th>
          ${sortableTh('updated', 'Last Updated')}
          ${sortableTh('created', 'Created')}
          <th>Model / Status</th>
          ${sortableTh('project', 'Project')}
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  filteredInteractions.forEach(interaction => {
    const updatedDate = formatTableDate(interaction.updated_at);
    const createdDate = formatTableDate(interaction.created_at);
    const checked = selectedIds.has(interaction.id) ? 'checked' : '';
    const safeName = escapeHtml(interaction.name);

    if (interaction.type === 'chat') {
      const modelBadgeClass = getModelBadgeClass(interaction.model);
      const safeProjectName = escapeHtml(interaction.project);

      html += `
        <tr data-id="${interaction.uuid}" data-type="chat">
          <td><input type="checkbox" class="row-select" data-id="${interaction.id}" ${checked}></td>
          <td>
            <div class="conversation-name">
              <a href="https://claude.ai/chat/${interaction.uuid}" target="_blank" title="${safeName}">
                ${safeName}
              </a>
            </div>
          </td>
          <td><span class="type-badge chat">Chat</span></td>
          <td class="date">${updatedDate}</td>
          <td class="date">${createdDate}</td>
          <td>
            <span class="model-badge ${modelBadgeClass}">
              ${formatModelName(interaction.model)}
            </span>
          </td>
          <td>${safeProjectName}</td>
          <td>
            <div class="actions">
              <button class="btn-small btn-export" data-id="${interaction.uuid}" data-name="${safeName}" data-type="chat">
                Export
              </button>
              <button class="btn-small btn-view" data-id="${interaction.uuid}" data-type="chat">
                View
              </button>
            </div>
          </td>
        </tr>
      `;
    } else {
      const model = taskModels.get(interaction.id) || '';
      const status = escapeHtml(interaction._original.status || 'Unknown');
      const cell = model
        ? `<span class="model-badge ${getModelBadgeClass(model)}">${escapeHtml(formatModelName(model))}</span>`
        : status;
      const cellTitle = model
        ? 'Model, from the first assistant event in the session'
        : 'Status, from the session list. The model is read when the filters need it, or on export.';

      html += `
        <tr data-id="${interaction.id}" data-type="cowork">
          <td><input type="checkbox" class="row-select" data-id="${interaction.id}" ${checked}></td>
          <td>
            <div class="conversation-name">
              <a href="https://claude.ai/cowork/${interaction.id}" target="_blank" title="${safeName}">
                ${safeName}
              </a>
            </div>
          </td>
          <td><span class="type-badge cowork">Cowork</span></td>
          <td class="date">${updatedDate}</td>
          <td class="date">${createdDate}</td>
          <td title="${cellTitle}">${cell}</td>
          <td>${interaction.project ? escapeHtml(interaction.project) : '—'}</td>
          <td>
            <div class="actions">
              <button class="btn-small btn-export" data-id="${interaction.id}" data-name="${safeName}" data-type="cowork">
                Export
              </button>
              <button class="btn-small btn-view" data-id="${interaction.id}" data-type="cowork">
                View
              </button>
            </div>
          </td>
        </tr>
      `;
    }
  });

  html += `
      </tbody>
    </table>
  `;

  tableContent.innerHTML = html;

  // Column header sorting
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => sortByColumn(th.dataset.sort));
  });

  // Add export button listeners
  document.querySelectorAll('.btn-export').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.type;
      const id = e.target.dataset.id;
      const name = e.target.dataset.name;
      if (type === 'chat') {
        exportConversation(id, name);
      } else {
        exportTask(id, name);
      }
    });
  });

  // Add view button listeners
  document.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.type;
      const id = e.target.dataset.id;
      if (type === 'chat') {
        window.open(`https://claude.ai/chat/${id}`, '_blank');
      } else {
        window.open(`https://claude.ai/cowork/${id}`, '_blank');
      }
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
    filteredInteractions.forEach(interaction => {
      if (e.target.checked) selectedIds.add(interaction.id);
      else selectedIds.delete(interaction.id);
    });
    displayInteractions();
  });

  updateSelectionUI();

  // Enable export all button
  document.getElementById('exportAllBtn').disabled = false;
}

// Reflect current selection in the header checkbox, stats, and Export Selected button
function updateSelectionUI() {
  const visibleIds = filteredInteractions.map(i => i.id);
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
  const totalInteractions = allConversations.length + allTasks.length;
  let text = `Showing ${filteredInteractions.length} of ${totalInteractions} interactions`;
  if (selectedIds.size > 0) text += ` — ${selectedIds.size} selected`;
  if (tasksTruncated) text += ' — the Cowork session list stopped at its page limit, so there may be more';
  stats.textContent = text;
}

// Reading a conversation or a Cowork session is api.js's job; rendering one to
// a file is utils.js's, and saving it deliver.js's.

// A provenance bundle ships the API response exactly as it arrived, so it has
// to be read as text rather than parsed straight into an object.
// Why a chosen format produced nothing, in words that say what to do instead.
function nothingToBundle(format, kind) {
  if (format !== 'provenance') {
    return 'Nothing was written for this interaction.';
  }
  return kind === 'task'
    ? 'Provenance bundles are not available for Cowork sessions yet. Export it as an HTML page instead.'
    : 'This conversation produced no files, so a provenance bundle would have nothing to prove.';
}

function readConversation(orgId, conversationId, format) {
  return format === 'provenance'
    ? fetchConversationDetailRaw(orgId, conversationId)
    : fetchConversationDetail(orgId, conversationId).then(data => ({ data }));
}

// Export single conversation
async function exportConversation(conversationId, conversationName) {
  const opts = exportOptions();

  try {
    showToast(`Exporting ${conversationName}...`);

    const capture = await readConversation(orgId, conversationId, opts.format);
    const data = capture.data;

    // Infer model if null
    applyModel(data);

    const file = await renderConversationExport(data, opts.format, { ...opts, capture, orgId });
    if (!file) {
      showToast(nothingToBundle(opts.format, 'conversation'), true);
      return;
    }

    await deliverOne(downloadDestination(), file);
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
    if (!formatSupports('task', opts.format)) {
      showToast(nothingToBundle(opts.format, 'task'), true);
      return;
    }

    showToast(`Exporting ${sessionTitle}...`);

    const session = await fetchCoworkSession(sessionId);
    const file = await renderTaskExport(session, opts.format, opts);
    if (!file) {
      showToast(nothingToBundle(opts.format, 'task'), true);
      return;
    }

    await deliverOne(downloadDestination(), file);

    if (session.complete === false) {
      showToast(`Exported ${session.title}, but the transcript stops early: ${session.truncated_reason}.`, true);
    } else {
      showToast(`Exported: ${session.title}`);
    }

  } catch (error) {
    console.error('Export error:', error);
    showToast(`Failed to export: ${error.message}`, true);
  }
}

// Export all interactions currently passing the filters
async function exportAllFiltered() {
  const items = filteredInteractions.map(interaction => ({
    type: interaction.type,
    id: interaction.id,
    uuid: interaction.uuid,
    name: interaction.name,
    _original: interaction._original
  }));

  await exportBatch({
    items,
    buttonId: 'exportAllBtn',
    defaultLabel: 'Export All',
    noun: 'interactions',
    renderItem: renderInteractionFile
  });
}

// Export only the checked interactions, regardless of what's currently filtered/visible
async function exportSelected() {
  const items = filteredInteractions
    .filter(i => selectedIds.has(i.id))
    .map(interaction => ({
      type: interaction.type,
      id: interaction.id,
      uuid: interaction.uuid,
      name: interaction.name,
      _original: interaction._original
    }));

  await exportBatch({
    items,
    buttonId: 'exportSelectedBtn',
    defaultLabel: 'Export Selected',
    noun: 'interactions',
    renderItem: renderInteractionFile
  });
}

// One interaction row to one file, in whichever format the header selects.
async function renderInteractionFile(item) {
  const opts = exportOptions();

  if (!formatSupports(item.type, opts.format)) {
    return null;
  }

  if (item.type === 'chat') {
    const capture = await readConversation(orgId, item.uuid, opts.format);
    applyModel(capture.data);
    return renderConversationExport(capture.data, opts.format, { ...opts, capture, orgId });
  }

  const session = await fetchCoworkSession(item.id);
  return renderTaskExport(session, opts.format, opts);
}

// Batch export with this page's progress dialog around it. runBatch in
// deliver.js owns the rendering loop and the archive; everything here is the
// dialog, the cancel button, and the button being pressed.
async function exportBatch({ items, buttonId, defaultLabel, noun, renderItem }) {
  const button = document.getElementById(buttonId);
  button.disabled = true;
  button.textContent = 'Preparing...';

  const progressModal = document.getElementById('progressModal');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressStats = document.getElementById('progressStats');
  progressModal.style.display = 'block';
  progressBar.style.width = '0%';
  progressStats.textContent = '';
  progressText.textContent = `Exporting ${items.length} ${noun}...`;

  let cancelExport = false;
  document.getElementById('cancelExport').onclick = () => {
    cancelExport = true;
    progressText.textContent = 'Cancelling...';
  };

  const opts = exportOptions();

  try {
    const result = await runBatch({
      items,
      renderItem,
      noun,
      destination: zipDestination({
        archiveName: `claude-${noun}-${new Date().toISOString().split('T')[0]}.zip`,
        onProgress: percent => { progressBar.style.width = `${percent}%`; }
      }),
      summary: {
        format: opts.format,
        include_metadata: opts.includeMetadata,
        tags: normalizeTags(opts.tags)
      },
      shouldCancel: () => cancelExport,
      onProgress: ({ phase, percent, completed, failed, total }) => {
        if (phase === 'archiving') {
          progressText.textContent = 'Creating ZIP file...';
          progressBar.style.width = '0%';
          return;
        }
        progressBar.style.width = `${percent}%`;
        progressStats.textContent = `${completed} succeeded, ${failed} failed out of ${total}`;
      }
    });

    progressModal.style.display = 'none';
    showToast(describeBatch(result, noun), result.cancelled);

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

  // Type filter
  document.getElementById('typeFilter').addEventListener('change', (e) => {
    const scheduledOnlyGroup = document.getElementById('scheduledOnlyGroup');
    if (e.target.value === 'cowork') {
      scheduledOnlyGroup.style.display = 'flex';
    } else {
      scheduledOnlyGroup.style.display = 'none';
      document.getElementById('scheduledOnlyCheckbox').checked = false;
    }
    applyFiltersAndSort();
  });

  // Scheduled only checkbox. Turning it on has to check any sessions whose origin
  // isn't known yet, which the list response doesn't tell us.
  document.getElementById('scheduledOnlyCheckbox').addEventListener('change', async () => {
    applyFiltersAndSort();
    if (document.getElementById('scheduledOnlyCheckbox').checked) {
      await resolveTaskPreviews();
    }
  });

  // Model filter. Choosing a model while sessions are in view needs their
  // models, which the list response doesn't carry, so read them on demand for
  // the same reason the scheduled filter does.
  document.getElementById('modelFilter').addEventListener('change', async () => {
    applyFiltersAndSort();
    if (document.getElementById('modelFilter').value &&
        document.getElementById('typeFilter').value !== 'chat') {
      await resolveTaskPreviews();
    }
  });

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
}
