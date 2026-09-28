// Prism highlights the whole page on load unless told otherwise, which is the
// wrong behaviour for a library we only ever call directly: injected into
// claude.ai it would rewrite code blocks in the conversation the user is
// reading. Prism reads this flag off an existing global when it initialises, so
// this has to load first.
window.Prism = window.Prism || {};
window.Prism.manual = true;
window.Prism.disableWorkerMessageHandler = true;
