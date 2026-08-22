// Note: Organization ID is now stored in extension settings
// Users need to configure it in the extension options page
//
// Like utils.js, this file is injected twice — by the manifest and again by
// background.js — so it must stay free of top-level const/let and register its
// message listener only once. See the guard at the bottom of the file.
//
// inferModel, the Cowork parsers and every format renderer live in utils.js,
// which the manifest loads as a content script ahead of this file.

// Fetch conversation data
async function fetchConversation(orgId, conversationId) {
  const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation: ${response.status}`);
  }

  return await response.json();
}

// Fetch all conversations
async function fetchAllConversations(orgId) {
  const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch conversations: ${response.status}`);
  }

  return await response.json();
}

// Cowork endpoints live under /v1/code rather than the org-scoped /api tree.
// Listing sessions and replaying one are both owned by utils.js —
// fetchCoworkList and fetchCoworkSession — since the browse page needs them too.

// Handle messages from popup
function handleExportMessage(request, sender, sendResponse) {
  if (request.action === 'exportConversation') {
    console.log('Export conversation request received:', request);

    fetchConversation(request.orgId, request.conversationId)
      .then(data => {
        console.log('Conversation data fetched successfully:', data);

        // Infer model if null
        data.model = inferModel(data);

        let content, filename, type;

        const exportOpts = { project: request.project, contributor: request.contributor, tags: request.tags };

        switch (request.format) {
          case 'markdown':
            content = convertToMarkdown(data, request.includeMetadata, exportOpts);
            filename = buildFrontgraphFilename(data);
            type = 'text/markdown';
            break;
          case 'text':
            content = convertToText(data, request.includeMetadata, exportOpts);
            filename = `claude-conversation-${data.name || request.conversationId}.txt`;
            type = 'text/plain';
            break;
          default:
            content = JSON.stringify(withExportTags(data, request.tags), null, 2);
            filename = `claude-conversation-${data.name || request.conversationId}.json`;
            type = 'application/json';
        }

        console.log('Downloading file:', filename);
        downloadFile(content, filename, type);
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Export conversation error:', error);
        sendResponse({
          success: false,
          error: error.message,
          details: error.stack
        });
      });

    return true;
  }

  if (request.action === 'exportAllConversations') {
    console.log('Export all conversations request received:', request);

    fetchAllConversations(request.orgId)
      .then(async conversations => {
        console.log(`Fetched ${conversations.length} conversations`);

        if (request.format === 'json') {
          // For JSON, export as a single file with all conversations
          const filename = `claude-all-conversations-${new Date().toISOString().split('T')[0]}.json`;
          const tagged = conversations.map(conv => withExportTags(conv, request.tags));
          console.log('Downloading all conversations as JSON:', filename);
          downloadFile(JSON.stringify(tagged, null, 2), filename);
          sendResponse({ success: true, count: conversations.length });
        } else {
          // For other formats, create individual files
          let count = 0;
          let errors = [];

          for (const conv of conversations) {
            try {
              console.log(`Fetching full conversation ${count + 1}/${conversations.length}: ${conv.uuid}`);
              const fullConv = await fetchConversation(request.orgId, conv.uuid);

              // Infer model if null
              fullConv.model = inferModel(fullConv);

              let content, filename, type;
              const exportOpts = { project: request.project, contributor: request.contributor, tags: request.tags };

              if (request.format === 'markdown') {
                content = convertToMarkdown(fullConv, request.includeMetadata, exportOpts);
                filename = buildFrontgraphFilename(fullConv);
                type = 'text/markdown';
              } else {
                content = convertToText(fullConv, request.includeMetadata, exportOpts);
                filename = `claude-${conv.name || conv.uuid}.txt`;
                type = 'text/plain';
              }

              downloadFile(content, filename, type);
              count++;

              // Add a small delay to avoid overwhelming the API
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              console.error(`Failed to export conversation ${conv.uuid}:`, error);
              errors.push(`${conv.name || conv.uuid}: ${error.message}`);
            }
          }

          if (errors.length > 0) {
            console.warn('Some conversations failed to export:', errors);
            sendResponse({
              success: true,
              count,
              warnings: `Exported ${count}/${conversations.length} conversations. Some failed: ${errors.join('; ')}`
            });
          } else {
            sendResponse({ success: true, count });
          }
        }
      })
      .catch(error => {
        console.error('Export all conversations error:', error);
        sendResponse({
          success: false,
          error: error.message,
          details: error.stack
        });
      });

    return true;
  }

  if (request.action === 'exportTask') {
    console.log('Export task request received:', request);

    fetchCoworkSession(request.sessionId)
      .then(session => {
        console.log(`Task log replayed: ${session.events.length} events, ${session.turns.length} turns`);

        const { content, filename, type } = renderTaskExport(session, request.format, {
          includeMetadata: request.includeMetadata,
          project: request.project,
          contributor: request.contributor,
          tags: request.tags
        });

        console.log('Downloading file:', filename);
        downloadFile(content, filename, type);
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Export task error:', error);
        sendResponse({
          success: false,
          error: error.message,
          details: error.stack
        });
      });

    return true;
  }

  if (request.action === 'exportAllTasks') {
    console.log('Export all tasks request received:', request);

    fetchCoworkList()
      .then(async rows => {
        console.log(`Fetched ${rows.length} Cowork sessions`);

        let count = 0;
        const errors = [];

        for (const row of rows) {
          try {
            const session = await fetchCoworkSession(row.id);

            // Only scheduled runs are tasks; the same list carries sessions
            // started by hand, which the conversation exports don't cover but
            // aren't what this action was asked for.
            if (request.scheduledOnly && !session.scheduled) continue;

            const { content, filename, type } = renderTaskExport(session, request.format, {
              includeMetadata: request.includeMetadata,
              project: request.project,
              contributor: request.contributor,
              tags: request.tags
            });

            downloadFile(content, filename, type);
            count++;

            // Add a small delay to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`Failed to export task ${row.id}:`, error);
            errors.push(`${row.title || row.id}: ${error.message}`);
          }
        }

        if (errors.length > 0) {
          console.warn('Some tasks failed to export:', errors);
          sendResponse({
            success: true,
            count,
            warnings: `Exported ${count}/${rows.length} tasks. Some failed: ${errors.join('; ')}`
          });
        } else {
          sendResponse({ success: true, count });
        }
      })
      .catch(error => {
        console.error('Export all tasks error:', error);
        sendResponse({
          success: false,
          error: error.message,
          details: error.stack
        });
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
