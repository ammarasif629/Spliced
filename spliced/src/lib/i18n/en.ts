// Localization architecture (Phase 8).
// English is the default locale. To add a locale later, create a sibling
// dictionary (e.g. ko.ts) with the same keys and switch on a locale setting.
// UI strings should be added here as they are introduced.

const en: Record<string, string> = {
  // App
  "app.name": "SPLiCED",
  "app.tagline": "Testimony is evidence, not truth.",

  // Navigation
  "nav.timeGraph": "Time-Graph",
  "nav.testimonies": "Testimonies",
  "nav.sources": "Sources",
  "nav.acceptedChain": "Accepted Chain",
  "nav.settings": "Settings",
  "nav.noScoresNote":
    "No scores are ever stored. Coverage = ratio of corroborated claims, derived at read time.",

  // TopBar
  "top.case": "Case",
  "top.newsroom": "Newsroom (isolated)",
  "top.nickname": "Nickname",

  // Viewport / graph
  "graph.mode2d": "2D",
  "graph.mode3d": "3D",
  "graph.openBoard": "Open Board",
  "graph.focus": "Focus",
  "graph.legend.supports": "Supports",
  "graph.legend.contradicts": "Contradicts",
  "graph.legend.evidence": "Direct evidence",
  "graph.legend.weak": "Weak association",
  "graph.legend.inference": "Inference",
  "graph.controls":
    "WASD/QE move · Shift accelerate · RMB rotate · MMB pan · Wheel zoom (2D: scroll pages, Ctrl+wheel zoom) · LMB drag box-select · Dbl-click focus · F frame · Enter reset view · Drag a card's grip (⠿, top-left) to move it",
  "graph.linkTool": "Create Link",
  "graph.conflicts": "Conflict Review",
  "graph.loading": "Loading viewport…",

  // Support disclosure (Phase 6)
  "support.viewEvidence": "View Supporting Evidence",
  "support.supports": "Supports",
  "support.agreement": "Agreement",
  "support.confidence": "Confidence",
  "support.high": "High",
  "support.medium": "Medium",
  "support.low": "Low",
  "support.panelTitle": "Supporting Evidence",
  "support.testimonies": "Supporting testimonies",
  "support.contradicting": "Contradicting testimonies",
  "support.documents": "Documents & evidence",
  "support.none": "Nothing linked yet.",

  // Whiteboard (Phase 2)
  "board.title": "Investigation Board",
  "board.select": "Select",
  "board.pen": "Pen",
  "board.marker": "Marker",
  "board.highlighter": "Highlighter",
  "board.eraser": "Eraser",
  "board.note": "Note",
  "board.attach": "Attach",
  "board.link": "Link",
  "board.undo": "Undo",
  "board.redo": "Redo",
  "board.history": "History",
  "board.minimize": "Minimize",
  "board.fullscreen": "Fullscreen",
  "board.restore": "Restore",
  "board.close": "Close",
  "board.open": "Open investigation board",
  "board.empty": "Empty board — add notes, drawings, or evidence.",

  // Card disclosure
  "card.seeMore": "See more",
  "card.seeLess": "See less",

  // Conflict detection
  "conflict.badge": "NON-COHERENT TESTIMONY",
  "conflict.self": "Same witness contradicts themselves",
  "conflict.cross": "Witnesses contradict each other",
  "conflict.none": "No conflicts detected.",
  "conflict.noLlm":
    "No LLM is configured, so no contradiction can be detected automatically. Add a ChatGPT-compatible API key in Settings.",
  "conflict.title": "Conflict Review",

  // Viewport extras
  "graph.reset": "Reset Position",

  // Stars
  "star.panelTitle": "Starred",
  "star.empty": "Star (★) billboards or boards to pin them here.",
  "star.newGroup": "New group name…",
  "star.create": "Create",
  "star.deleteGroup": "Delete group",
  "star.focus": "Focus",

  // Page (time-layer) window controls
  "page.spacing": "Page spacing",
  "page.minimize": "Minimize page",
  "page.maximize": "Maximize page",
  "page.delete": "Delete page",
  "page.restore": "Restore page",
  "page.deletedPages": "Deleted pages",
  "page.prev": "Previous page",
  "page.next": "Next page",
  "page.prevShort": "Prev",
  "page.nextShort": "Next",
  "page.exitMax": "Exit maximized view",
  "page.deselect": "Deselect page",
  "page.deleteConfirm":
    "Delete this page permanently? Every testimony with a claim on this page will be deleted from the database, along with all of their claims and links. This cannot be undone.",
  "card.delete": "Delete bulletin",
  "card.deleteConfirm":
    "Delete this bulletin permanently? Its links are removed too, and if its testimony has no other claims the testimony is deleted as well. This cannot be undone.",
  "nav.menu": "Menu",
  "graph.inspector": "Inspector",

  // Common
  "common.reject": "Reject",
  "common.restore": "Restore",
  "common.rejected": "Rejected",
  "common.loading": "Loading…",
  "common.submit": "Submit",
};

export function t(key: string): string {
  return en[key] ?? key;
}

export default en;
