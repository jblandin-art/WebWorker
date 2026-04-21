const AUTOSAVE_STORAGE_PREFIX = "webworkmaxAutosave:";
const AUTOSAVE_INDEX_KEY = "webworkmaxAutosaveIndex";
const AUTOSAVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function cleanupOldAutosaves() {
  chrome.storage.local.get(AUTOSAVE_INDEX_KEY, (stored) => {
    if (chrome.runtime.lastError) {
      return;
    }

    const index = stored[AUTOSAVE_INDEX_KEY] || {};
    const now = Date.now();
    const keysToRemove = [];
    const updatedIndex = { ...index };

    for (const [autosaveKey, savedAtString] of Object.entries(index)) {
      const savedAt = new Date(savedAtString).getTime();
      if (Number.isNaN(savedAt)) {
        keysToRemove.push(autosaveKey);
        delete updatedIndex[autosaveKey];
        continue;
      }

      if (now - savedAt > AUTOSAVE_MAX_AGE_MS) {
        keysToRemove.push(autosaveKey);
        delete updatedIndex[autosaveKey];
      }
    }

    if (keysToRemove.length === 0) {
      return;
    }

    chrome.storage.local.remove(keysToRemove, () => {
      if (chrome.runtime.lastError) {
        return;
      }

      chrome.storage.local.set({ [AUTOSAVE_INDEX_KEY]: updatedIndex });
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  cleanupOldAutosaves();
});

chrome.alarms.create("cleanupAutosaves", { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanupAutosaves") {
    cleanupOldAutosaves();
  }
});
