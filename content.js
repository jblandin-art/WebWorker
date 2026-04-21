const DEFAULT_SETTINGS = {
  autosaveInterval: "off",
  cosmeticsEnabled: false,
};

const SCORE_COLUMN_WIDTH = "4.5rem";
const AUTOSAVE_STORAGE_PREFIX = "webworkmaxAutosave:";
const AUTOSAVE_INDEX_KEY = "webworkmaxAutosaveIndex";
const UNSUBMITTED_BANNER_ID = "webworkmax-unsubmitted-banner";
const LEAVE_GUARD_STYLE_ID = "webworkmax-leave-guard-style";
const LEAVE_GUARD_MODAL_ID = "webworkmax-leave-guard-modal";
const UNLOAD_WARNING_MESSAGE = "Changes are saved locally but are not submitted.";

let commentEnhancerInitialized = false;
let localAutosaveInitialized = false;
let localAutosaveApplying = false;
let localAutosaveTimer = null;
let hasUnsubmittedLocalChanges = false;
let isSubmittingGraderForm = false;
let pendingLeaveAction = null;
let baselineFormValuesSignature = null;
const textareaHomes = new WeakMap();
const expandedRows = new WeakMap();
const originalButtonLabels = new WeakMap();
const previewButtonHandlers = new WeakMap();
let commentEnhancerObserver = null;

function getProblemAutosaveKey(url = window.location) {
  const pathname = (url.pathname || "").replace(/\/+$/, "");
  return `${AUTOSAVE_STORAGE_PREFIX}${pathname}`;
}

function ensureLeaveGuardStyles() {
  if (document.getElementById(LEAVE_GUARD_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = LEAVE_GUARD_STYLE_ID;
  style.textContent = `
    #${UNSUBMITTED_BANNER_ID} {
      display: inline-block;
      margin-left: 10px;
      padding: 4px 8px;
      border-radius: 4px;
      background: #c62828;
      color: #ffffff;
      font-size: 0.85rem;
      font-weight: 700;
      vertical-align: middle;
    }

    #${LEAVE_GUARD_MODAL_ID} {
      position: fixed;
      inset: 0;
      background: rgb(0 0 0 / 45%);
      z-index: 2147483646;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    #${LEAVE_GUARD_MODAL_ID}.webworkmax-open {
      display: flex;
    }

    #${LEAVE_GUARD_MODAL_ID} .webworkmax-leave-dialog {
      width: min(520px, 100%);
      background: #ffffff;
      border-radius: 8px;
      border: 1px solid #d0d7de;
      box-shadow: 0 12px 30px rgb(0 0 0 / 28%);
      padding: 16px;
    }

    #${LEAVE_GUARD_MODAL_ID} .webworkmax-leave-title {
      margin: 0 0 10px;
      font-size: 1.05rem;
      font-weight: 700;
      color: #111827;
    }

    #${LEAVE_GUARD_MODAL_ID} .webworkmax-leave-message {
      margin: 0 0 14px;
      color: #111827;
      line-height: 1.4;
    }

    #${LEAVE_GUARD_MODAL_ID} .webworkmax-leave-warning {
      margin: 0 0 16px;
      font-weight: 700;
      color: #b91c1c;
    }

    #${LEAVE_GUARD_MODAL_ID} .webworkmax-leave-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    #${LEAVE_GUARD_MODAL_ID} button {
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 0.9rem;
      cursor: pointer;
    }

    #${LEAVE_GUARD_MODAL_ID} .webworkmax-stay-btn {
      background: #ffffff;
      color: #111827;
    }

    #${LEAVE_GUARD_MODAL_ID} .webworkmax-leave-btn {
      background: #b91c1c;
      border-color: #b91c1c;
      color: #ffffff;
      font-weight: 700;
    }
  `;

  document.head.appendChild(style);
}

function ensureUnsubmittedBanner() {
  const title = document.getElementById("page-title");
  if (!title) {
    return null;
  }

  let banner = document.getElementById(UNSUBMITTED_BANNER_ID);
  if (banner) {
    return banner;
  }

  banner = document.createElement("span");
  banner.id = UNSUBMITTED_BANNER_ID;
  banner.textContent = "Work Not Submitted";
  banner.style.display = "none";
  title.appendChild(banner);
  return banner;
}

function updateUnsubmittedUi() {
  const banner = ensureUnsubmittedBanner();
  if (!banner) {
    return;
  }

  banner.style.display = hasUnsubmittedLocalChanges ? "inline-block" : "none";
}

function setUnsubmittedLocalChanges(value) {
  hasUnsubmittedLocalChanges = Boolean(value);
  updateUnsubmittedUi();
}

function serializeAutosaveValues(values) {
  if (!values) {
    return null;
  }

  const ordered = {};
  const keys = Object.keys(values).sort();
  for (const key of keys) {
    ordered[key] = values[key];
  }

  return JSON.stringify(ordered);
}

function refreshUnsubmittedState() {
  if (!baselineFormValuesSignature) {
    setUnsubmittedLocalChanges(false);
    return;
  }

  const currentValues = collectAutosaveValues();
  const currentSignature = serializeAutosaveValues(currentValues);
  setUnsubmittedLocalChanges(currentSignature !== baselineFormValuesSignature);
}

function ensureLeaveGuardModal() {
  let modal = document.getElementById(LEAVE_GUARD_MODAL_ID);
  if (modal) {
    return modal;
  }

  modal = document.createElement("div");
  modal.id = LEAVE_GUARD_MODAL_ID;
  modal.innerHTML = `
    <div class="webworkmax-leave-dialog" role="dialog" aria-modal="true" aria-labelledby="webworkmax-leave-title">
      <h2 id="webworkmax-leave-title" class="webworkmax-leave-title">Unsubmitted Work Detected</h2>
      <p class="webworkmax-leave-message">You are about to leave this page.</p>
      <p class="webworkmax-leave-warning">Your changes are saved locally but NOT SUBMITTED.</p>
      <div class="webworkmax-leave-actions">
        <button type="button" class="webworkmax-stay-btn">Stay on page</button>
        <button type="button" class="webworkmax-leave-btn">Leave anyway</button>
      </div>
    </div>
  `;

  const stayButton = modal.querySelector(".webworkmax-stay-btn");
  const leaveButton = modal.querySelector(".webworkmax-leave-btn");

  stayButton?.addEventListener("click", () => {
    pendingLeaveAction = null;
    modal.classList.remove("webworkmax-open");
  });

  leaveButton?.addEventListener("click", () => {
    const action = pendingLeaveAction;
    pendingLeaveAction = null;
    modal.classList.remove("webworkmax-open");
    if (action) {
      action();
    }
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      pendingLeaveAction = null;
      modal.classList.remove("webworkmax-open");
    }
  });

  document.body.appendChild(modal);
  return modal;
}

function openLeaveGuardModal(onLeave) {
  const modal = ensureLeaveGuardModal();
  pendingLeaveAction = onLeave;
  modal.classList.add("webworkmax-open");
}

function clearLocalAutosaveForCurrentProblem() {
  const autosaveKey = getProblemAutosaveKey();
  chrome.storage.local.get(AUTOSAVE_INDEX_KEY, (stored) => {
    const index = stored[AUTOSAVE_INDEX_KEY] || {};
    delete index[autosaveKey];
    chrome.storage.local.remove(autosaveKey, () => {
      chrome.storage.local.set({ [AUTOSAVE_INDEX_KEY]: index });
    });
  });
}

function shouldBlockPageLeave() {
  return hasUnsubmittedLocalChanges && !isSubmittingGraderForm;
}

function handlePageLeaveAttempt(event) {
  if (!shouldBlockPageLeave()) {
    return;
  }

  persistAutosaveSnapshot();
  event.preventDefault();
  event.returnValue = UNLOAD_WARNING_MESSAGE;
}

function handleDocumentNavigationClick(event) {
  if (!shouldBlockPageLeave()) {
    return;
  }

  if (event.defaultPrevented || event.button !== 0) {
    return;
  }

  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const link = event.target?.closest?.("a[href]");
  if (!link) {
    return;
  }

  const href = link.getAttribute("href") || "";
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
    return;
  }

  if (link.target && link.target !== "_self") {
    return;
  }

  event.preventDefault();
  persistAutosaveSnapshot();
  openLeaveGuardModal(() => {
    window.location.href = link.href;
  });
}

function handleDocumentFormSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  if (form.id === "problem-grader-form") {
    isSubmittingGraderForm = true;
    window.clearTimeout(localAutosaveTimer);
    const submitValues = collectAutosaveValues();
    baselineFormValuesSignature = serializeAutosaveValues(submitValues);
    setUnsubmittedLocalChanges(false);
    clearLocalAutosaveForCurrentProblem();
    return;
  }

  if (!shouldBlockPageLeave()) {
    return;
  }

  event.preventDefault();
  persistAutosaveSnapshot();
  openLeaveGuardModal(() => {
    isSubmittingGraderForm = true;
    form.submit();
  });
}

function isAutosaveField(element) {
  if (!element || element.disabled) {
    return false;
  }

  if (element.tagName === "TEXTAREA" || element.tagName === "SELECT") {
    return true;
  }

  if (element.tagName !== "INPUT") {
    return false;
  }

  const type = (element.type || "").toLowerCase();
  return ["checkbox", "radio", "text", "number", "email", "search", "tel", "url"].includes(type);
}

function getAutosaveFieldKey(element) {
  const fieldName = element.name || element.id;
  if (!fieldName) {
    return null;
  }

  return `${element.tagName.toLowerCase()}:${fieldName}`;
}

function collectAutosaveSnapshot() {
  const values = collectAutosaveValues();
  if (!values) {
    return null;
  }

  return {
    savedAt: new Date().toISOString(),
    values,
  };
}

function collectAutosaveValues() {
  const form = document.getElementById("problem-grader-form");
  if (!form) {
    return null;
  }

  const fields = form.querySelectorAll("textarea, select, input");
  const values = {};

  for (const field of fields) {
    if (!isAutosaveField(field)) {
      continue;
    }

    const key = getAutosaveFieldKey(field);
    if (!key) {
      continue;
    }

    if (field.tagName === "INPUT") {
      const type = (field.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        values[key] = Boolean(field.checked);
        continue;
      }
    }

    values[key] = field.value;
  }

  if (Object.keys(values).length === 0) {
    return null;
  }

  return values;
}

function applyAutosaveSnapshot(snapshot) {
  if (!snapshot?.values) {
    return;
  }

  const form = document.getElementById("problem-grader-form");
  if (!form) {
    return;
  }

  const fields = form.querySelectorAll("textarea, select, input");
  localAutosaveApplying = true;

  try {
    for (const field of fields) {
      if (!isAutosaveField(field)) {
        continue;
      }

      const key = getAutosaveFieldKey(field);
      if (!key || !Object.hasOwn(snapshot.values, key)) {
        continue;
      }

      const nextValue = snapshot.values[key];
      if (field.tagName === "INPUT") {
        const type = (field.type || "").toLowerCase();
        if (type === "checkbox" || type === "radio") {
          field.checked = Boolean(nextValue);
          continue;
        }
      }

      field.value = `${nextValue ?? ""}`;
    }
  } finally {
    localAutosaveApplying = false;
  }
}

function persistAutosaveSnapshot() {
  if (localAutosaveApplying || isSubmittingGraderForm) {
    return;
  }

  const snapshot = collectAutosaveSnapshot();
  if (!snapshot) {
    return;
  }

  const autosaveKey = getProblemAutosaveKey();
  chrome.storage.local.get(AUTOSAVE_INDEX_KEY, (stored) => {
    const index = stored[AUTOSAVE_INDEX_KEY] || {};
    index[autosaveKey] = snapshot.savedAt;

    chrome.storage.local.set({
      [autosaveKey]: snapshot,
      [AUTOSAVE_INDEX_KEY]: index,
    });
  });

  refreshUnsubmittedState();
}

function scheduleAutosaveSnapshot() {
  if (localAutosaveApplying || isSubmittingGraderForm) {
    return;
  }

  refreshUnsubmittedState();

  window.clearTimeout(localAutosaveTimer);
  localAutosaveTimer = window.setTimeout(() => {
    persistAutosaveSnapshot();
  }, 250);
}

function restoreAutosaveSnapshot() {
  const autosaveKey = getProblemAutosaveKey();
  chrome.storage.local.get(autosaveKey, (stored) => {
    const snapshot = stored[autosaveKey];
    if (!snapshot?.values) {
      refreshUnsubmittedState();
      return;
    }

    applyAutosaveSnapshot(snapshot);
    refreshUnsubmittedState();
  });
}

function initLocalAutosave() {
  if (localAutosaveInitialized || !chrome?.storage?.local) {
    return;
  }

  const form = document.getElementById("problem-grader-form");
  if (!form) {
    return;
  }

  localAutosaveInitialized = true;
  ensureLeaveGuardStyles();
  ensureUnsubmittedBanner();
  ensureLeaveGuardModal();
  baselineFormValuesSignature = serializeAutosaveValues(collectAutosaveValues());
  restoreAutosaveSnapshot();

  form.addEventListener("input", scheduleAutosaveSnapshot, true);
  form.addEventListener("change", scheduleAutosaveSnapshot, true);
  document.addEventListener("click", handleDocumentNavigationClick, true);
  document.addEventListener("submit", handleDocumentFormSubmit, true);
  window.addEventListener("beforeunload", handlePageLeaveAttempt);
}

function isTargetGradingPage(url = window.location) {
  if (url.hostname !== "webwork3.charlotte.edu") {
    return false;
  }

  return /^\/webwork2\/[^/]+\/instructor\/grader\//.test(url.pathname);
}

function ensureCommentEnhancerStyles() {
  if (document.getElementById("webworkmax-comment-enhancer-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "webworkmax-comment-enhancer-style";
  style.textContent = `
    .webworkmax-comment-expand-row > td {
      padding: 8px 12px 14px;
      background: #f7faf7;
      border-top: none;
    }

    .webworkmax-comment-expand-spacer {
      background: transparent;
      border-top: none;
      padding: 0;
    }

    .webworkmax-comment-expand-panel {
      width: 100%;
      max-width: 100%;
    }

    .webworkmax-comment-expand-panel textarea {
      display: block;
      min-height: 84px;
      resize: vertical;
    }

    .webworkmax-grade-comment-cell {
      text-align: center;
    }
  `;

  document.head.appendChild(style);
}

function getMarkCorrectColumnIndex(table) {
  if (!table) {
    return -1;
  }

  const rows = table.rows;
  for (const row of rows) {
    const cells = row.querySelectorAll("th, td");
    for (const cell of cells) {
      if (/Mark\s+Correct/i.test(cell.textContent || "")) {
        return cell.cellIndex;
      }
    }
  }

  return -1;
}

function getScoreColumnIndex(table) {
  if (!table) {
    return -1;
  }

  const rows = table.rows;
  for (const row of rows) {
    const scoreControl = row.querySelector("select.score-selector");
    if (scoreControl) {
      const scoreCell = scoreControl.closest("td");
      if (scoreCell) {
        return scoreCell.cellIndex;
      }
    }
  }

  return -1;
}

function setScoreColumnWidth(table, columnIndex) {
  if (!table || columnIndex < 0) {
    return;
  }

  const rows = table.rows;
  for (const row of rows) {
    if (columnIndex >= row.cells.length) {
      continue;
    }

    row.cells[columnIndex].style.width = SCORE_COLUMN_WIDTH;
    row.cells[columnIndex].style.minWidth = SCORE_COLUMN_WIDTH;
  }
}

function clearScoreColumnWidth(table, columnIndex) {
  if (!table || columnIndex < 0) {
    return;
  }

  const rows = table.rows;
  for (const row of rows) {
    if (columnIndex >= row.cells.length) {
      continue;
    }

    row.cells[columnIndex].style.width = "";
    row.cells[columnIndex].style.minWidth = "";
  }
}

function setColumnDisplay(table, columnIndex, displayValue) {
  if (!table || columnIndex < 0) {
    return;
  }

  const rows = table.rows;
  for (const row of rows) {
    if (columnIndex >= row.cells.length) {
      continue;
    }

    row.cells[columnIndex].style.display = displayValue;
  }
}

function restoreGradingCells(row) {
  if (!row) {
    return;
  }

  const table = row.closest("table");
  const markCorrectColumnIndex = getMarkCorrectColumnIndex(table);
  setColumnDisplay(table, markCorrectColumnIndex, "");

  const scoreColumnIndex = getScoreColumnIndex(table);
  clearScoreColumnWidth(table, scoreColumnIndex);

  const scoreControl = row.querySelector("select.score-selector");
  const checkboxControl = row.querySelector('input.mark_correct[type="checkbox"]');
  const commentTextarea = row.querySelector('textarea[name$=".comment"]');

  const checkboxCell = checkboxControl?.closest("td");
  const commentCell = commentTextarea?.closest("td");

  if (checkboxCell) {
    checkboxCell.style.display = "";
    checkboxCell.style.width = "";
    checkboxCell.style.minWidth = "";
  }

  if (checkboxControl) {
    checkboxControl.style.transform = "";
    checkboxControl.style.transformOrigin = "";
  }

  if (commentCell) {
    commentCell.classList.remove("webworkmax-grade-comment-cell");
    commentCell.style.textAlign = "";
  }
}

function applyGradingCells(row) {
  if (!row) {
    return;
  }

  const table = row.closest("table");
  const markCorrectColumnIndex = getMarkCorrectColumnIndex(table);
  setColumnDisplay(table, markCorrectColumnIndex, "none");

  const scoreColumnIndex = getScoreColumnIndex(table);
  setScoreColumnWidth(table, scoreColumnIndex);

  const scoreControl = row.querySelector("select.score-selector");
  const checkboxControl = row.querySelector('input.mark_correct[type="checkbox"]');
  const commentTextarea = row.querySelector('textarea[name$=".comment"]');

  const checkboxCell = checkboxControl?.closest("td");
  const commentCell = commentTextarea?.closest("td");

  if (checkboxCell) {
    checkboxCell.style.display = "none";
    checkboxCell.style.width = "";
    checkboxCell.style.minWidth = "";
  }

  if (checkboxControl) {
    checkboxControl.style.transform = "";
    checkboxControl.style.transformOrigin = "";
  }

  if (commentCell) {
    commentCell.classList.add("webworkmax-grade-comment-cell");
    commentCell.style.textAlign = "center";
  }
}

function toggleMarkAllButton(row, enabled) {
  if (!row) {
    return;
  }

  const cells = row.querySelectorAll("th, td");
  for (const cell of cells) {
    if (!/Mark\s+Correct/i.test(cell.textContent || "")) {
      continue;
    }

    const button = Array.from(cell.querySelectorAll('input[type="button"], button')).find((element) => {
      const text = `${element.value || ""} ${element.textContent || ""} ${element.title || ""}`;
      return /Mark\s+All/i.test(text);
    });

    if (!button) {
      continue;
    }

    if (enabled) {
      if (!button.dataset.webworkmaxOriginalDisplay) {
        button.dataset.webworkmaxOriginalDisplay = button.style.display || "";
      }

      button.style.display = "none";
    } else {
      button.style.display = button.dataset.webworkmaxOriginalDisplay || "";
      delete button.dataset.webworkmaxOriginalDisplay;
    }
  }
}

function showExpandedCommentTextarea(row, textarea, shouldSelect = false) {
  if (!row || !textarea || expandedRows.has(textarea)) {
    return;
  }

  const table = row.closest("table");
  if (!table) {
    return;
  }

  const colCount = Math.max(row.cells.length, 1);
  const leadColumns = Math.min(2, Math.max(colCount - 1, 0));
  const editorColumns = Math.max(colCount - leadColumns, 1);
  const expandRow = document.createElement("tr");
  expandRow.className = "webworkmax-comment-expand-row";

  if (leadColumns > 0) {
    const spacerCell = document.createElement("td");
    spacerCell.className = "webworkmax-comment-expand-spacer";
    spacerCell.colSpan = leadColumns;
    expandRow.appendChild(spacerCell);
  }

  const expandCell = document.createElement("td");
  expandCell.colSpan = editorColumns;

  const panel = document.createElement("div");
  panel.className = "webworkmax-comment-expand-panel";

  const essayAnswer = row.querySelector(".essay-answer");
  if (essayAnswer && essayAnswer.clientWidth > 0) {
    panel.style.width = `${essayAnswer.clientWidth}px`;
  }

  textarea.rows = 3;
  textarea.style.resize = "vertical";
  textarea.style.width = "100%";
  textarea.style.maxWidth = "100%";
  textarea.style.display = "block";
  textarea.removeAttribute("aria-hidden");

  panel.appendChild(textarea);
  expandCell.appendChild(panel);
  expandRow.appendChild(expandCell);

  row.insertAdjacentElement("afterend", expandRow);
  expandedRows.set(textarea, expandRow);

  if (shouldSelect) {
    textarea.focus();
    textarea.select();
  }
}

function hideExpandedCommentTextarea(textarea) {
  if (!textarea) {
    return;
  }

  const expandRow = expandedRows.get(textarea);
  if (!expandRow) {
    return;
  }

  const home = textareaHomes.get(textarea);
  if (home?.container) {
    home.container.insertBefore(textarea, home.beforeNode || null);
  }

  textarea.style.display = "none";
  textarea.setAttribute("aria-hidden", "true");

  expandRow.remove();
  expandedRows.delete(textarea);
}

function restoreCommentRow(row) {
  if (!row) {
    return;
  }

  const textarea = row.querySelector('textarea[name$=".comment"]');
  if (!textarea) {
    return;
  }

  const expandRow = expandedRows.get(textarea);
  if (expandRow) {
    hideExpandedCommentTextarea(textarea);
  }

  const home = textareaHomes.get(textarea);
  if (home?.container && textarea.parentElement !== home.container) {
    home.container.insertBefore(textarea, home.beforeNode || null);
  }

  textarea.style.display = "";
  textarea.removeAttribute("aria-hidden");

  const nextElement = textarea.nextElementSibling;
  if (nextElement && nextElement.tagName === "BR") {
    nextElement.style.display = "";
  }

  const button =
    row.querySelector('input[type="button"][name$=".preview"]') ||
    row.querySelector('input[type="button"]');

  if (button) {
    const buttonHandler = previewButtonHandlers.get(button);
    if (buttonHandler) {
      button.removeEventListener("click", buttonHandler, true);
      previewButtonHandlers.delete(button);
    }

    const originalLabel = originalButtonLabels.get(button) || "Preview";
    button.value = originalLabel;
    button.classList.add("preview");
    delete button.dataset.webworkmaxEnlargeBound;
  }

  toggleMarkAllButton(row, false);
}

function enhanceCommentRow(row) {
  if (!row || row.dataset.webworkmaxCommentEnhanced === "true") {
    return;
  }

  restoreGradingCells(row);
  applyGradingCells(row);
  toggleMarkAllButton(row, true);

  const textarea = row.querySelector('textarea[name$=".comment"]');
  if (!textarea) {
    return;
  }

  const previewButton =
    row.querySelector('input.preview[type="button"]') ||
    row.querySelector('input[type="button"][name$=".preview"]');

  if (!previewButton) {
    return;
  }

  if (!originalButtonLabels.has(previewButton)) {
    originalButtonLabels.set(previewButton, previewButton.value || "Preview");
  }

  if (!textareaHomes.has(textarea)) {
    textareaHomes.set(textarea, {
      container: textarea.parentElement,
      beforeNode: textarea.nextSibling,
    });
  }

  textarea.style.display = "none";
  textarea.setAttribute("aria-hidden", "true");

  const commentCell = textarea.closest("td");
  if (commentCell) {
    commentCell.classList.add("webworkmax-grade-comment-cell");
    commentCell.style.textAlign = "center";
  }

  const nextElement = textarea.nextElementSibling;
  if (nextElement && nextElement.tagName === "BR") {
    nextElement.style.display = "none";
  }

  previewButton.value = "Comment";
  previewButton.classList.remove("preview");
  previewButton.dataset.webworkmaxEnlargeBound = "true";

  const existingHandler = previewButtonHandlers.get(previewButton);
  if (existingHandler) {
    previewButton.removeEventListener("click", existingHandler, true);
    previewButtonHandlers.delete(previewButton);
  }

  const toggleCommentHandler = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (expandedRows.has(textarea)) {
      hideExpandedCommentTextarea(textarea);
      previewButton.value = "Comment";
      return;
    }

      showExpandedCommentTextarea(row, textarea, true);
    previewButton.value = "Hide";
  };

  previewButtonHandlers.set(previewButton, toggleCommentHandler);

  previewButton.addEventListener("click", toggleCommentHandler, true);

  if (textarea.value.trim().length > 0) {
    showExpandedCommentTextarea(row, textarea, false);
    previewButton.value = "Hide";
  }

  row.dataset.webworkmaxCommentEnhanced = "true";
}

function enhanceGradingCommentEditors() {
  ensureCommentEnhancerStyles();

  const rows = document.querySelectorAll("tr");
  for (const row of rows) {
    toggleMarkAllButton(row, true);
    enhanceCommentRow(row);
  }
}

function initCommentEnhancer() {
  if (commentEnhancerInitialized) {
    return;
  }

  commentEnhancerInitialized = true;
  enhanceGradingCommentEditors();

  commentEnhancerObserver = new MutationObserver(() => {
    enhanceGradingCommentEditors();
  });

  commentEnhancerObserver.observe(document.body, { childList: true, subtree: true });
}

function teardownCommentEnhancer() {
  if (commentEnhancerObserver) {
    commentEnhancerObserver.disconnect();
    commentEnhancerObserver = null;
  }

  commentEnhancerInitialized = false;

  const rows = document.querySelectorAll("tr");
  for (const row of rows) {
    toggleMarkAllButton(row, false);
    restoreCommentRow(row);
    restoreGradingCells(row);
    row.dataset.webworkmaxCommentEnhanced = "";
  }

  const style = document.getElementById("webworkmax-comment-enhancer-style");
  if (style) {
    style.remove();
  }
}

function applyCosmetics(enabled) {
  document.documentElement.classList.toggle("webworkmax-cosmetics-enabled", Boolean(enabled));

  if (enabled) {
    initCommentEnhancer();
  } else {
    teardownCommentEnhancer();
  }
}

function syncFromSettings(settings) {
  if (!isTargetGradingPage()) {
    return;
  }

  applyCosmetics(settings.cosmeticsEnabled);
}

function init() {
  if (!isTargetGradingPage() || !chrome?.storage?.sync) {
    return;
  }

  initLocalAutosave();

  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    if (chrome.runtime.lastError) {
      return;
    }

    syncFromSettings(settings);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (!Object.hasOwn(changes, "cosmeticsEnabled")) {
      return;
    }

    applyCosmetics(changes.cosmeticsEnabled.newValue);
  });
}

init();