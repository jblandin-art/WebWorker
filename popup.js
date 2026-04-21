const DEFAULT_SETTINGS = {
  cosmeticsEnabled: false,
};

const AUTOSAVE_STORAGE_PREFIX = "webworkmaxAutosave:";
const COSMETICS_KEY = "cosmeticsEnabled";

const viewAutosaveButton = document.getElementById("viewAutosaveButton");
const autosaveInfoEl = document.getElementById("autosaveInfo");
const cosmeticsToggle = document.getElementById("cosmeticsEnabled");
const statusEl = document.getElementById("status");

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);

  window.clearTimeout(showStatus.timerId);
  showStatus.timerId = window.setTimeout(() => {
    statusEl.textContent = "";
    statusEl.classList.remove("error");
  }, 1400);
}

function applySettings(settings) {
  cosmeticsToggle.checked = Boolean(settings[COSMETICS_KEY]);
}

function saveSettings() {
  const nextSettings = {
    [COSMETICS_KEY]: cosmeticsToggle.checked,
  };

  chrome.storage.sync.set(nextSettings, () => {
    if (chrome.runtime.lastError) {
      showStatus("Could not save settings", true);
      return;
    }

    showStatus("Settings Saved");
  });
}

function getProblemAutosaveKeyFromUrl(urlString) {
  if (!urlString) {
    return null;
  }

  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  if (url.hostname !== "webwork3.charlotte.edu") {
    return null;
  }

  if (!/^\/webwork2\/[^/]+\/instructor\/grader\//.test(url.pathname)) {
    return null;
  }

  const pathname = (url.pathname || "").replace(/\/+$/, "");
  return `${AUTOSAVE_STORAGE_PREFIX}${pathname}`;
}

function showAutosaveInfoForActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs?.[0];
    const autosaveKey = getProblemAutosaveKeyFromUrl(activeTab?.url);

    if (!autosaveKey) {
      autosaveInfoEl.textContent = "Open a WeBWorK grader page to view autosave time";
      return;
    }

    chrome.storage.local.get(autosaveKey, (stored) => {
      const snapshot = stored[autosaveKey];
      if (!snapshot?.savedAt) {
        autosaveInfoEl.textContent = "Last autosave for this problem: None yet";
        return;
      }

      const date = new Date(snapshot.savedAt);
      const formatted = Number.isNaN(date.getTime()) ? snapshot.savedAt : date.toLocaleString();
      autosaveInfoEl.textContent = `Last autosave for this problem: ${formatted}`;
    });
  });
}

function initPopup() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    if (chrome.runtime.lastError) {
      showStatus("Could not load settings", true);
      return;
    }

    applySettings(settings);
  });

  viewAutosaveButton.addEventListener("click", showAutosaveInfoForActiveTab);

  cosmeticsToggle.addEventListener("change", saveSettings);
}

if (!chrome?.storage?.sync) {
  showStatus("Storage is unavailable", true);
} else {
  initPopup();
}
