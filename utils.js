// Shared utility functions for Claude Exporter
//
// This file is injected into claude.ai twice — once by the manifest's
// content_scripts and again by background.js for tabs that were already open.
// Keep it free of top-level const/let: a duplicate declaration is a parse-time
// error that would abort the whole re-injection, leaving a stale copy live.

// Escape a string for safe insertion into innerHTML — both as text content
// and inside a quoted attribute value (conversation titles are user-authored
// and get inserted directly into the browse table's markup; see upstream
// issue #12 for the DOM XSS this closes).
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Helper function to reconstruct the current branch from the message tree
function getCurrentBranch(data) {
  if (!data.chat_messages || !data.current_leaf_message_uuid) {
    return [];
  }
  
  // Create a map of UUID to message for quick lookup
  const messageMap = new Map();
  data.chat_messages.forEach(msg => {
    messageMap.set(msg.uuid, msg);
  });
  
  // Trace back from the current leaf to the root
  const branch = [];
  let currentUuid = data.current_leaf_message_uuid;
  
  while (currentUuid && messageMap.has(currentUuid)) {
    const message = messageMap.get(currentUuid);
    branch.unshift(message); // Add to beginning to maintain order
    currentUuid = message.parent_message_uuid;
    
    // Stop if we hit the root (parent UUID that doesn't exist in our messages)
    if (!messageMap.has(currentUuid)) {
      break;
    }
  }
  
  return branch;
}

// --- frontgraph: the frontmatter is the graph --------------------------
// A browser export is post-hoc and mechanical: it shapes the frontmatter
// shell and scrapes what the API returns for free, but it never reads the
// transcript, so anything requiring judgment — tags, contributor — is typed
// into the export UI rather than derived.

function slugify(text) {
  const slug = (text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'untitled';
}

function formatDateYYYYMMDD(isoString) {
  const d = isoString ? new Date(isoString) : new Date(0);
  return d.toISOString().slice(0, 10);
}

// Quote a scalar for safe YAML embedding (titles/URLs may contain ": ", quotes, etc.)
function yamlScalar(value) {
  const str = String(value ?? '');
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Collapse a multi-paragraph API string (e.g. summary) to one safe YAML line
function collapseWhitespace(str) {
  return String(str ?? '').replace(/\s+/g, ' ').trim();
}

// Tags are typed by hand at export time, so take whatever the field holds and
// clean it rather than rejecting it: split on commas, drop the "#" Obsidian
// users reflexively prefix, hyphenate interior spaces, and strip anything
// outside the character set Obsidian accepts in a tag. Returns a deduped,
// lowercased array so "Research, research" can't split the graph in two.
function normalizeTags(input) {
  const raw = Array.isArray(input) ? input.join(',') : String(input ?? '');
  const seen = new Set();
  const tags = [];

  for (const candidate of raw.split(',')) {
    const tag = candidate
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_/-]+/gu, '')
      .replace(/^[-/]+|[-/]+$/g, '');

    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  return tags;
}

// Obsidian's own frontmatter shape: a block sequence under the key. Sanitized
// tags only hold letters, digits, _, - and /, so the only ones needing quotes
// are those a YAML parser would read as a number, date or boolean.
function yamlTagList(tags) {
  if (!tags.length) {
    return 'tags: []';
  }
  const ambiguous = /^([\d-]+|true|false|yes|no|on|off|null)$/i;
  const items = tags.map(tag => `  - ${ambiguous.test(tag) ? yamlScalar(tag) : tag}`);
  return ['tags:', ...items].join('\n');
}

// JSON exports carry the same tags the markdown frontmatter would, as an array.
function withExportTags(data, tags) {
  return { ...data, tags: normalizeTags(tags) };
}

// Fields the API supplies are scraped: summary, and project — via
// project_name on conversations that belong to a Claude.ai Project, or the
// literal "None" when a conversation isn't in one. created/updated preserve
// the API's own created_at/updated_at verbatim, alongside the derived
// YYYY-MM-DD date used for the filename. project, contributor and tags come
// from the export UI, which overrides the scraped project.
function buildFrontgraphFrontmatter(data, opts = {}) {
  // API shape is inconsistent across endpoints: the single-conversation
  // fetch (used here at export time) returns a flat project_name, but the
  // bulk list endpoint returns a nested project: {uuid, name} instead.
  // Check both so this doesn't silently break if that ever flips.
  const project = opts.project || data.project_name || (data.project && data.project.name) || 'None';
  const lines = [
    '---',
    `title: ${yamlScalar(data.name || 'Untitled Conversation')}`,
    `date: ${formatDateYYYYMMDD(data.created_at)}`,
    `created: ${yamlScalar(data.created_at || '')}`,
    `updated: ${yamlScalar(data.updated_at || '')}`,
    'type: conversation',
    'status: reference',
    `project: ${yamlScalar(project)}`,
    `contributor: ${opts.contributor || ''}`,
    yamlTagList(normalizeTags(opts.tags)),
    'source: claude-conversation',
    `source_url: ${yamlScalar(`https://claude.ai/chat/${data.uuid || ''}`)}`,
    `model: ${data.model || ''}`,
    `session_id: ${data.uuid || ''}`,
    `summary: ${yamlScalar(collapseWhitespace(data.summary))}`,
    '---',
    ''
  ];
  return lines.join('\n');
}

// Filename convention: [YYYY-MM-DD]-[slug].md
function buildFrontgraphFilename(data) {
  return `${formatDateYYYYMMDD(data.created_at)}-${slugify(data.name)}.md`;
}

// Convert to markdown format
function convertToMarkdown(data, includeMetadata, frontmatterOpts) {
  let markdown = buildFrontgraphFrontmatter(data, frontmatterOpts || {});
  markdown += `# ${data.name || 'Untitled Conversation'}\n\n`;

  if (includeMetadata) {
    markdown += `**Created:** ${new Date(data.created_at).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(data.updated_at).toLocaleString()}\n`;
    markdown += `**Model:** ${data.model}\n`;
    if (data.truncated !== undefined) {
      markdown += `**Truncated:** ${data.truncated}\n`;
    }
    markdown += '\n---\n\n';
  }

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  for (const message of branchMessages) {
    const sender = message.sender === 'human' ? '**You**' : '**Claude**';
    markdown += `${sender}:\n\n`;

    // Show attachments if metadata enabled
    if (includeMetadata && message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        markdown += `> **Attachment:** ${attachment.file_name || '(unnamed)'}`;
        if (attachment.file_size) {
          const sizeKB = (attachment.file_size / 1024).toFixed(1);
          markdown += ` (${sizeKB} KB)`;
        }
        if (attachment.file_type) {
          markdown += ` [${attachment.file_type}]`;
        }
        markdown += '\n';
        if (attachment.extracted_content) {
          markdown += `>\n> <details><summary>Extracted content</summary>\n>\n> \`\`\`\n> ${attachment.extracted_content.replace(/\n/g, '\n> ')}\n> \`\`\`\n>\n> </details>\n`;
        }
      }
      markdown += '\n';
    }

    if (message.content) {
      for (const content of message.content) {
        if (content.text) {
          markdown += `${content.text}\n\n`;
        }
      }
    } else if (message.text) {
      markdown += `${message.text}\n\n`;
    }

    if (includeMetadata && message.created_at) {
      markdown += `*${new Date(message.created_at).toLocaleString()}*\n\n`;
    }

    markdown += '---\n\n';
  }
  
  return markdown;
}

// Convert to plain text
function convertToText(data, includeMetadata, opts = {}) {
  let text = '';

  // Add metadata header if requested
  if (includeMetadata) {
    const tags = normalizeTags(opts.tags);
    text += `${data.name || 'Untitled Conversation'}\n`;
    text += `Created: ${new Date(data.created_at).toLocaleString()}\n`;
    text += `Updated: ${new Date(data.updated_at).toLocaleString()}\n`;
    text += `Model: ${data.model}\n`;
    if (tags.length) {
      text += `Tags: ${tags.join(', ')}\n`;
    }
    text += '\n---\n\n';
  }
  
  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);
  
  // Use simplified format
  let humanSeen = false;
  let assistantSeen = false;
  
  branchMessages.forEach((message) => {
    // Get the message text
    let messageText = '';
    if (message.content) {
      for (const content of message.content) {
        if (content.text) {
          messageText += content.text;
        }
      }
    } else if (message.text) {
      messageText = message.text;
    }
    
    // Use full label on first occurrence, then abbreviate
    let senderLabel;
    if (message.sender === 'human') {
      senderLabel = humanSeen ? 'H' : 'Human';
      humanSeen = true;
    } else {
      senderLabel = assistantSeen ? 'A' : 'Assistant';
      assistantSeen = true;
    }
    
    text += `${senderLabel}: ${messageText}\n\n`;
  });
  
  return text.trim();
}

// Download file utility
function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Functions are available globally in the browser context
// No need for module.exports in browser extensions
