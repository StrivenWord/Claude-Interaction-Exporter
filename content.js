// Runs on claude.ai and does the work the popup asks for: read an interaction,
// render it, hand it to a destination. The reading lives in api.js, the
// rendering in utils.js, and the delivery in deliver.js — this file only wires
// a message to the right three of them.
//
// Like utils.js this file is injected twice — by the manifest and again by
// background.js — so it must stay free of top-level const/let and register its
// message listener only once. See the guard at the bottom of the file.

// The export UI's shared fields, in the shape every renderer expects.
function exportOptionsFrom(request) {
  return {
    includeMetadata: request.includeMetadata,
    includeToolActivity: request.includeToolActivity,
    includeImages: request.includeImages,
    includeThinking: request.includeThinking,
    project: request.project,
    contributor: request.contributor,
    tags: request.tags
  };
}

// JSZip is 95KB and only a batch export needs it, so the manifest deliberately
// keeps it out of every claude.ai page load and the service worker injects it
// into this tab the first time a batch runs.
function ensureZipSupport() {
  if (typeof JSZip !== 'undefined') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'ensureZipSupport' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || !response.success) {
        reject(new Error((response && response.error) || 'Could not load ZIP support.'));
      } else {
        resolve();
      }
    });
  });
}

// The HTML document is rendered with markdown-it and Prism, which the service
// worker injects the first time a format asks for them.
function ensureMarkdownSupport() {
  if (typeof markdownit !== 'undefined') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'ensureMarkdownSupport' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || !response.success) {
        reject(new Error((response && response.error) || 'Could not load Markdown support.'));
      } else {
        resolve();
      }
    });
  });
}

function needsMarkdown(format) {
  return format === 'html' || format === 'provenance';
}

function todayStamp() {
  return new Date().toISOString().split('T')[0];
}

// Handle messages from popup
function handleExportMessage(request, sender, sendResponse) {
  if (request.action === 'exportConversation') {
    console.log('Export conversation request received:', request);

    Promise.all([
      fetchConversationDetail(request.orgId, request.conversationId),
      needsMarkdown(request.format) ? ensureMarkdownSupport() : Promise.resolve()
    ])
      .then(async ([data]) => {
        applyModel(data);

        const file = renderConversationExport(data, request.format, exportOptionsFrom(request));
        const filename = await deliverOne(downloadDestination(), file);

        console.log('Downloaded', filename);
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Export conversation error:', error);
        sendResponse({ success: false, error: error.message, details: error.stack });
      });

    return true;
  }

  if (request.action === 'exportAllConversations') {
    console.log('Export all conversations request received:', request);

    Promise.all([
      fetchConversationList(request.orgId),
      ensureZipSupport(),
      needsMarkdown(request.format) ? ensureMarkdownSupport() : Promise.resolve()
    ])
      .then(async ([conversations]) => {
        console.log(`Fetched ${conversations.length} conversations`);

        const opts = exportOptionsFrom(request);

        const result = await runBatch({
          items: conversations.map(conv => ({ id: conv.uuid, name: conv.name })),
          noun: 'conversations',
          renderItem: async (item) => {
            const data = await fetchConversationDetail(request.orgId, item.id);
            applyModel(data);
            return renderConversationExport(data, request.format, opts);
          },
          destination: zipDestination({ archiveName: `claude-conversations-${todayStamp()}.zip` }),
          summary: {
            format: request.format,
            include_metadata: request.includeMetadata,
            tags: normalizeTags(request.tags)
          }
        });

        sendResponse({
          success: true,
          count: result.completed,
          warnings: result.failed > 0 ? describeBatch(result, 'conversations') : undefined
        });
      })
      .catch(error => {
        console.error('Export all conversations error:', error);
        sendResponse({ success: false, error: error.message, details: error.stack });
      });

    return true;
  }

  if (request.action === 'exportTask') {
    console.log('Export task request received:', request);

    Promise.all([
      fetchCoworkSession(request.sessionId),
      needsMarkdown(request.format) ? ensureMarkdownSupport() : Promise.resolve()
    ])
      .then(async ([session]) => {
        console.log(`Task log replayed: ${session.events.length} events, ${session.turns.length} turns`);

        const file = renderTaskExport(session, request.format, exportOptionsFrom(request));
        const filename = await deliverOne(downloadDestination(), file);

        console.log('Downloaded', filename);
        // A partial read still produces a file, clearly labelled inside — but
        // saying nothing here would leave the label as the only warning, and
        // the file is the thing least likely to be reread.
        sendResponse({
          success: true,
          warnings: session.complete === false
            ? `Exported, but the transcript stops early: ${session.truncated_reason}.`
            : undefined
        });
      })
      .catch(error => {
        console.error('Export task error:', error);
        sendResponse({ success: false, error: error.message, details: error.stack });
      });

    return true;
  }
}

// Register once per page, dispatching through the binding rather than the
// function object so a re-injection's fresh code is what actually runs.
if (!window.__frontgraphExporterListening) {
  window.__frontgraphExporterListening = true;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) =>
    handleExportMessage(request, sender, sendResponse));
}
