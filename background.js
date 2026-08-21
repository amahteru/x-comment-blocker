import {
  browserApi as chrome,
  extractCleanScreenName,
  getLocalDateString,
  getStorageDefaults,
  parseKeywords,
  SYNC_INTERVAL_MINUTES,
  syncCloudKeywords,
} from './utils.js';

const ALARM_NAME = 'cloudKeywordSync';
let isSyncing = false;

function getAuthHeaders() {
  return {
    authorization:
      'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  };
}

class AsyncQueue {
  queue = [];
  isProcessing = false;
  enqueue(task) {
    const { promise, resolve, reject } = Promise.withResolvers();
    this.queue.push(() => Promise.try(task).then(resolve, reject));
    this.process();
    return promise;
  }
  async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        try {
          await task();
        } catch (e) {
          console.error('[X-Blocker] Queue task error:', e);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

const globalSpamCache = new Set();
const storageQueue = new AsyncQueue();

let inMemoryHistory = null;
let inMemoryBlockedCount = null;
let pendingSpamBatch = [];
let spamBatchTimer = null;
const currentSessionToken = crypto.randomUUID();

function syncGlobalSpamCache() {
  globalSpamCache.clear();
  for (const item of inMemoryHistory ?? []) {
    if (item?.id) {
      globalSpamCache.add(item.id);
    }
  }
  for (const item of pendingSpamBatch) {
    if (item?.id) {
      globalSpamCache.add(item.id);
    }
  }
}

const initHistoryPromise = storageQueue.enqueue(async () => {
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults('blockedCount', 'blockedHistory'),
    );
    inMemoryHistory = items.blockedHistory ?? [];
    inMemoryBlockedCount = items.blockedCount ?? 0;
    syncGlobalSpamCache();
  } catch (e) {
    console.error('[X-Blocker] Init history error:', e);
    inMemoryHistory ??= [];
    inMemoryBlockedCount ??= 0;
  }
});

async function ensureHistoryInitialized() {
  if (inMemoryHistory === null) {
    await initHistoryPromise;
  }
}

async function saveHistoryState() {
  try {
    await chrome.storage.local.set({
      blockedCount: inMemoryBlockedCount,
      blockedHistory: inMemoryHistory,
      _historyRev: currentSessionToken,
    });
  } catch (e) {
    console.error('[X-Blocker] saveHistoryState error:', e);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes._historyRev && changes._historyRev.newValue === currentSessionToken) {
    return;
  }

  if (changes.blockedHistory) {
    inMemoryHistory = changes.blockedHistory.newValue ?? [];
    syncGlobalSpamCache();
  }

  if (changes.blockedCount) {
    inMemoryBlockedCount = changes.blockedCount.newValue ?? 0;
  }
});

async function doSync() {
  if (isSyncing) return { success: false, reason: 'busy' };
  isSyncing = true;

  try {
    const success = await syncCloudKeywords();
    return { success };
  } finally {
    isSyncing = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });

  chrome.alarms.create('autoBlockWatchdog', {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });

  if (chrome.contextMenus) {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'addToBlocklist',
      title: '添加「%s」到屏蔽词',
      contexts: ['selection'],
      documentUrlPatterns: ['*://*.twitter.com/*', '*://*.x.com/*'],
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    doSync();
  } else if (alarm.name === 'autoBlockWatchdog') {
    autoBlockManager.process();
  }
});

const MAX_BLOCK_RETRIES = 5;

class AutoBlockManager {
  isProcessing = false;
  dailyLimit = 300;
  batchLimit = 30;
  minDelayMs = 5000;
  maxDelayMs = 10000;

  queue = [];
  blockedUsersSet = new Set();
  retryCounts = new Map();
  countToday = 0;
  batchCount = 0;
  lastDate = '';
  pausedUntil = 0;
  initialized = false;
  initPromise = null;

  async checkDailyReset() {
    const today = getLocalDateString();
    if (this.lastDate !== today) {
      this.lastDate = today;
      this.countToday = 0;
      this.batchCount = 0;
      await this.saveState({
        autoBlockLastDate: this.lastDate,
        autoBlockToday: this.countToday,
        autoBlockBatchCount: this.batchCount,
      });
    }
  }

  async refreshFromStorage() {
    const items = await chrome.storage.local.get(
      getStorageDefaults(
        'autoBlockQueue',
        'autoBlockToday',
        'autoBlockLastDate',
        'autoBlockPausedUntil',
        'autoBlockBatchCount',
        'blockedUsersOnX',
      ),
    );

    this.queue = items.autoBlockQueue ?? [];
    this.countToday = items.autoBlockToday ?? 0;
    this.lastDate = items.autoBlockLastDate ?? '';
    this.pausedUntil = items.autoBlockPausedUntil ?? 0;
    this.batchCount = items.autoBlockBatchCount ?? 0;
    this.blockedUsersSet = new Set(items.blockedUsersOnX ?? []);
  }

  async init() {
    if (this.initialized) return;
    this.initPromise ??= (async () => {
      await this.refreshFromStorage();
      await this.checkDailyReset();

      this.initialized = true;
    })();
    await this.initPromise;
  }

  async saveState(updates) {
    await chrome.storage.local.set(updates);
  }

  async enqueueBatch(screenNames) {
    await this.init();
    if (!screenNames || screenNames.length === 0) return 0;

    const validNames = Array.from(new Set(screenNames.map(extractCleanScreenName))).filter(
      (name) => name && !this.queue.includes(name) && !this.blockedUsersSet.has(name),
    );

    if (validNames.length > 0) {
      this.queue.push(...validNames);
      await this.saveState({ autoBlockQueue: this.queue });
      this.process();
    }

    return validNames.length;
  }

  async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      try {
        await this.init();

        while (true) {
          await this.refreshFromStorage();
          await this.checkDailyReset();

          const now = Date.now();
          if (this.pausedUntil > now) {
            const remainingSec = Math.ceil((this.pausedUntil - now) / 1000);
            console.warn(`[X-Blocker] Auto block paused for ${remainingSec}s.`);
            break;
          }

          if (this.countToday >= this.dailyLimit) {
            console.warn('[X-Blocker] Auto block daily limit reached.');
            break;
          }

          if (this.batchCount >= this.batchLimit) {
            console.warn('[X-Blocker] Auto block batch limit reached. Pausing for 15 mins.');
            this.pausedUntil = Date.now() + 15 * 60 * 1000;
            this.batchCount = 0;
            await this.saveState({
              autoBlockPausedUntil: this.pausedUntil,
              autoBlockBatchCount: this.batchCount,
            });
            break;
          }

          if (this.queue.length === 0) break;

          const currentItem = this.queue.at(0);

          let outcome = null;
          let failReason = '';
          let pauseUntil = 0;
          try {
            const res = await handleBlockUser(currentItem, true);
            if (res?.success) {
              outcome = 'success';
            } else if (res?.status === 429) {
              outcome = 'rate-limited';
              pauseUntil = Date.now() + 15 * 60 * 1000;
            } else if (res?.permanent || (res?.status && res.status >= 400 && res.status < 500)) {
              outcome = 'failed';
              failReason = res?.reason ?? 'unknown';
            } else {
              outcome = 'transient';
              failReason = res?.reason ?? 'unknown';
            }
          } catch (e) {
            console.error('[X-Blocker] Auto block task execution error:', e);
            outcome = 'transient';
            failReason = 'task error';
          }

          const storageQueue =
            (await chrome.storage.local.get('autoBlockQueue')).autoBlockQueue ?? [];
          const queueUnchanged =
            storageQueue.length === this.queue.length &&
            storageQueue.every((item, index) => item === this.queue[index]);
          if (!queueUnchanged) {
            console.warn('[X-Blocker] Auto block queue changed externally, re-syncing.');
            continue;
          }

          if (outcome === 'success') {
            this.retryCounts.delete(currentItem);
            this.queue.shift();
            this.countToday++;
            this.batchCount++;
            this.blockedUsersSet.add(currentItem);

            if (this.blockedUsersSet.size > 10000) {
              const dropCount = this.blockedUsersSet.size - 10000;
              this.blockedUsersSet = new Set(this.blockedUsersSet.values().drop(dropCount));
            }

            await this.saveState({
              autoBlockQueue: this.queue,
              autoBlockToday: this.countToday,
              autoBlockBatchCount: this.batchCount,
              blockedUsersOnX: Array.from(this.blockedUsersSet),
            });
          } else if (outcome === 'rate-limited') {
            console.warn('[X-Blocker] API rate limited (429). Pausing auto block for 15 mins.');
            this.pausedUntil = pauseUntil;
            this.batchCount = 0;
            await this.saveState({
              autoBlockPausedUntil: this.pausedUntil,
              autoBlockBatchCount: this.batchCount,
            });
            break;
          } else if (outcome === 'transient') {
            const attempts = (this.retryCounts.get(currentItem) ?? 0) + 1;
            this.retryCounts.set(currentItem, attempts);
            if (attempts > MAX_BLOCK_RETRIES) {
              console.error(
                `[X-Blocker] Auto block giving up on ${currentItem} after ${attempts} attempts:`,
                failReason,
              );
              this.queue.shift();
              this.retryCounts.delete(currentItem);
            } else {
              console.warn(
                `[X-Blocker] Auto block transient failure for ${currentItem}, retry ${attempts}/${MAX_BLOCK_RETRIES}:`,
                failReason,
              );
              this.queue.push(this.queue.shift());
              await new Promise((r) =>
                setTimeout(r, Math.min(30_000, 5_000 * 2 ** (attempts - 1))),
              );
            }
            await this.saveState({ autoBlockQueue: this.queue });
          } else {
            this.retryCounts.delete(currentItem);
            console.error('[X-Blocker] Auto block failed for', currentItem, failReason);
            this.queue.shift();
            await this.saveState({ autoBlockQueue: this.queue });
          }

          if (this.queue.length > 0) {
            const delay =
              Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs;
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      } catch (e) {
        console.error('[X-Blocker] AutoBlockManager process error:', e);
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

const autoBlockManager = new AutoBlockManager();
autoBlockManager.init().then(() => {
  autoBlockManager.process();
});

async function blockAllHistoryUsers(usersToBlock) {
  const names = Array.isArray(usersToBlock) ? usersToBlock : [];
  const queued = await autoBlockManager.enqueueBatch(names);
  return { success: true, total: names.length, queued };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'syncNow') {
    doSync().then(sendResponse);
    return true;
  }
  if (message.action === 'blockUserOnX') {
    handleBlockUser(message.screenName, true).then(sendResponse);
    return true;
  }
  if (message.action === 'unblockUserOnX') {
    handleBlockUser(message.screenName, false).then(sendResponse);
    return true;
  }
  if (message.action === 'blockAllHistoryUsers') {
    blockAllHistoryUsers(message.users).then(sendResponse);
    return true;
  }
  if (message.action === 'recordSpam') {
    handleRecordSpam(message.items)
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (message.action === 'clearSpamCache') {
    if (spamBatchTimer) {
      clearTimeout(spamBatchTimer);
      spamBatchTimer = null;
    }
    pendingSpamBatch = [];
    notifyContentScripts({ action: 'clearLocalSentIds' });
    storageQueue
      .enqueue(async () => {
        inMemoryHistory = [];
        inMemoryBlockedCount = 0;
        globalSpamCache.clear();
        await saveHistoryState();
        return { success: true };
      })
      .then(sendResponse);
    return true;
  }
  if (message.action === 'removeSpamRecord') {
    handleRemoveSpamRecord(message.id, message.time).then(sendResponse);
    return true;
  }
});

async function notifyContentScripts(message) {
  const tabs = await chrome.tabs.query({
    url: ['*://*.twitter.com/*', '*://*.x.com/*'],
  });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

function handleRemoveSpamRecord(id, time) {
  const isMatch = (item) => !(item.id === id && (!time || item.time === time));

  if (id) {
    notifyContentScripts({ action: 'removeLocalSentId', id });
  }

  if (pendingSpamBatch.length > 0) {
    const originalPendingLength = pendingSpamBatch.length;
    pendingSpamBatch = pendingSpamBatch.filter(isMatch);
    if (originalPendingLength > pendingSpamBatch.length && id) {
      globalSpamCache.delete(id);
    }
  }

  return storageQueue.enqueue(async () => {
    await ensureHistoryInitialized();

    const originalLength = inMemoryHistory.length;
    inMemoryHistory = inMemoryHistory.filter(isMatch);

    const removedCount = originalLength - inMemoryHistory.length;
    if (removedCount > 0) {
      if (id) {
        globalSpamCache.delete(id);
      }
      inMemoryBlockedCount = Math.max(0, (inMemoryBlockedCount ?? 0) - removedCount);
      await saveHistoryState();
    }
    return { success: true };
  });
}

async function flushSpamBatch() {
  if (spamBatchTimer) {
    clearTimeout(spamBatchTimer);
    spamBatchTimer = null;
  }
  if (pendingSpamBatch.length === 0) return;
  const batch = pendingSpamBatch;
  pendingSpamBatch = [];

  return storageQueue.enqueue(async () => {
    await ensureHistoryInitialized();
    inMemoryHistory.unshift(...batch.toReversed());
    if (inMemoryHistory.length > 5000) {
      const evicted = inMemoryHistory.slice(5000);
      inMemoryHistory.length = 5000;
      for (const item of evicted) {
        if (item?.id) {
          globalSpamCache.delete(item.id);
        }
      }
    }
    inMemoryBlockedCount = (inMemoryBlockedCount ?? 0) + batch.length;
    await saveHistoryState();
  });
}

async function handleRecordSpam(items) {
  if (!items?.length) return;
  await ensureHistoryInitialized();

  const newSpams = [];
  for (const item of items) {
    if (!item?.id || globalSpamCache.has(item.id)) continue;
    globalSpamCache.add(item.id);
    newSpams.push({
      id: item.id,
      text: item.text ? item.text.slice(0, 200) : '',
      user: item.user || '',
      displayName: item.displayName || '',
      reason: item.reason || '',
      time: item.time || Date.now(),
      isAutoBlock: item.isAutoBlock === true,
    });
  }

  if (newSpams.length === 0) return;

  const autoBlockScreenNames = newSpams.filter((s) => s.isAutoBlock && s.user).map((s) => s.user);

  if (autoBlockScreenNames.length > 0) {
    autoBlockManager.enqueueBatch(autoBlockScreenNames);
  }

  pendingSpamBatch.push(...newSpams);
  if (!spamBatchTimer) {
    spamBatchTimer = setTimeout(() => {
      spamBatchTimer = null;
      flushSpamBatch();
    }, 50);
  }
}

async function handleBlockUser(screenName, isBlock) {
  try {
    const cleanName = extractCleanScreenName(screenName);
    if (!cleanName) {
      return { success: false, reason: '无效的用户名', permanent: true };
    }
    const cookie = await chrome.cookies.get({
      url: 'https://x.com',
      name: 'ct0',
    });
    if (!cookie) {
      return { success: false, reason: '无法获取身份凭证，请确保已登录 X' };
    }

    const endpoint = isBlock ? 'create.json' : 'destroy.json';
    const headers = getAuthHeaders();

    headers['x-csrf-token'] = cookie.value;
    headers['content-type'] = 'application/x-www-form-urlencoded';

    const response = await fetch(`https://x.com/i/api/1.1/blocks/${endpoint}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: `screen_name=${encodeURIComponent(cleanName)}`,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      try {
        const data = await response.json();
        if (data?.errors?.length > 0) {
          const messages = data.errors
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ');
          const PERMANENT_ERROR_CODES = new Set([34, 50, 63]);
          const isPermanent = data.errors.every(
            (e) => typeof e.code === 'number' && PERMANENT_ERROR_CODES.has(e.code),
          );
          return { success: false, reason: `API 错误: ${messages}`, permanent: isPermanent };
        }
      } catch {}
      return { success: true, screenName: cleanName };
    } else {
      return {
        success: false,
        reason: `请求失败: HTTP ${response.status}`,
        status: response.status,
      };
    }
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId === 'addToBlocklist' && info.selectionText) {
      const inputKws = parseKeywords(info.selectionText);
      if (inputKws.length === 0) return;

      const items = await chrome.storage.local.get(getStorageDefaults('keywords'));
      const existing = parseKeywords(items.keywords);
      const newKws = new Set(inputKws).difference(new Set(existing));
      if (newKws.size > 0) {
        existing.push(...newKws);
        await chrome.storage.local.set({ keywords: existing.join('\n') });
      }
    }
  });
}
