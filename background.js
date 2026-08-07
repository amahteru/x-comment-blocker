import {
  browserApi as chrome,
  extractCleanScreenName,
  getStorageDefaults,
  parseKeywords,
  SYNC_INTERVAL_MINUTES,
  syncCloudKeywords,
} from './utils.js';

const ALARM_NAME = 'cloudKeywordSync';
let isSyncing = false;

class SyncLock {
  constructor() {
    isSyncing = true;
  }
  [Symbol.dispose]() {
    isSyncing = false;
  }
}

async function getAuthHeaders() {
  return {
    authorization:
      'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  };
}

class ProcessingLock {
  constructor(obj) {
    this.obj = obj;
    this.obj.isProcessing = true;
  }
  [Symbol.dispose]() {
    this.obj.isProcessing = false;
  }
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
    const _lock = new ProcessingLock(this);

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
      _lock[Symbol.dispose]();
    }
  }
}

const globalSpamCache = new Set();
const storageQueue = new AsyncQueue();

storageQueue.enqueue(async () => {
  const items = await chrome.storage.local.get(getStorageDefaults('blockedHistory'));
  const history = items.blockedHistory ?? [];
  Iterator.from(history)
    .filter((item) => item.id)
    .forEach((item) => {
      globalSpamCache.add(item.id);
    });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.blockedHistory) return;
  storageQueue.enqueue(async () => {
    const items = await chrome.storage.local.get(getStorageDefaults('blockedHistory'));
    const history = items.blockedHistory ?? [];
    globalSpamCache.clear();
    Iterator.from(history)
      .filter((item) => item.id)
      .forEach((item) => {
        globalSpamCache.add(item.id);
      });
  });
});

async function doSync() {
  if (isSyncing) return { success: false, reason: 'busy' };
  const _lock = new SyncLock();

  try {
    const success = await syncCloudKeywords();
    return { success };
  } finally {
    _lock[Symbol.dispose]();
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

  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'addToBlocklist',
    title: '添加「%s」到屏蔽词',
    contexts: ['selection'],
    documentUrlPatterns: ['*://*.twitter.com/*', '*://*.x.com/*'],
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    doSync();
  } else if (alarm.name === 'autoBlockWatchdog') {
    autoBlockManager.process();
  }
});

class AutoBlockManager {
  isProcessing = false;
  dailyLimit = 150;
  minDelayMs = 5000;
  maxDelayMs = 10000;

  queue = [];
  blockedUsersSet = new Set();
  countToday = 0;
  lastDate = '';
  pausedUntil = 0;
  initialized = false;
  initPromise = null;

  async checkDailyReset() {
    const today = Temporal.Now.plainDateISO().toString();
    if (this.lastDate !== today) {
      this.lastDate = today;
      this.countToday = 0;
      await this.saveState({
        autoBlockLastDate: this.lastDate,
        autoBlockToday: this.countToday,
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
        'blockedUsersOnX',
      ),
    );

    this.queue = items.autoBlockQueue ?? [];
    this.countToday = items.autoBlockToday ?? 0;
    this.lastDate = items.autoBlockLastDate ?? '';
    this.pausedUntil = items.autoBlockPausedUntil ?? 0;
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
    await this.refreshFromStorage();
    if (!screenNames || screenNames.length === 0) return 0;

    const validNames = Iterator.from(screenNames)
      .map(extractCleanScreenName)
      .filter((name) => name && !this.queue.includes(name) && !this.blockedUsersSet.has(name))
      .toArray();

    if (validNames.length > 0) {
      this.queue.push(...validNames);
      await this.saveState({ autoBlockQueue: this.queue });
      this.process();
    }

    return validNames.length;
  }

  async process() {
    if (this.isProcessing) return;
    const _lock = new ProcessingLock(this);

    try {
      try {
        await this.init();

        while (true) {
          await this.refreshFromStorage();
          await this.checkDailyReset();

          const now = Temporal.Now.instant();
          if (this.pausedUntil > now.epochMilliseconds) {
            const pausedUntilInstant = Temporal.Instant.fromEpochMilliseconds(this.pausedUntil);
            console.warn(
              `[X-Blocker] Auto block paused for ${Math.ceil(now.until(pausedUntilInstant).total('seconds'))}s.`,
            );
            break;
          }

          if (this.countToday >= this.dailyLimit) {
            console.warn('[X-Blocker] Auto block daily limit reached.');
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
            } else if (
              res?.reason &&
              (res.reason.includes('429') || res.reason.includes('HTTP 429'))
            ) {
              outcome = 'rate-limited';
              pauseUntil = Temporal.Now.instant().epochMilliseconds + 15 * 60 * 1000;
            } else {
              outcome = 'failed';
              failReason = res?.reason ?? 'unknown';
            }
          } catch (e) {
            console.error('[X-Blocker] Auto block task execution error:', e);
            outcome = 'failed';
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
            this.queue.shift();
            this.countToday++;
            this.blockedUsersSet.add(currentItem);

            if (this.blockedUsersSet.size > 10000) {
              const dropCount = this.blockedUsersSet.size - 10000;
              this.blockedUsersSet = new Set(this.blockedUsersSet.values().drop(dropCount));
            }

            await this.saveState({
              autoBlockQueue: this.queue,
              autoBlockToday: this.countToday,
              blockedUsersOnX: this.blockedUsersSet.values().toArray(),
            });
          } else if (outcome === 'rate-limited') {
            console.warn('[X-Blocker] API rate limited (429). Pausing auto block for 15 mins.');
            this.pausedUntil = pauseUntil;
            await this.saveState({ autoBlockPausedUntil: this.pausedUntil });
            break;
          } else {
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
      _lock[Symbol.dispose]();
    }
  }
}

const autoBlockManager = new AutoBlockManager();
autoBlockManager.init().then(() => {
  autoBlockManager.process();
});

async function blockAllHistoryUsers(usersToBlock = null) {
  let names = [];
  if (usersToBlock && Array.isArray(usersToBlock)) {
    names = usersToBlock;
  } else {
    const items = await chrome.storage.local.get(getStorageDefaults('blockedHistory'));
    const screenNames = new Set(
      Iterator.from(items.blockedHistory ?? [])
        .map((item) => extractCleanScreenName(item.user))
        .filter((name) => /^[a-zA-Z0-9_]{1,15}$/v.test(name)),
    );
    names = screenNames.values().toArray();
  }
  const queued = await autoBlockManager.enqueueBatch(names);
  return { success: true, total: names.length, queued };
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'syncNow') {
    return doSync();
  }
  if (message.action === 'blockUserOnX') {
    return handleBlockUser(message.screenName, true);
  }
  if (message.action === 'unblockUserOnX') {
    return handleBlockUser(message.screenName, false);
  }
  if (message.action === 'blockAllHistoryUsers') {
    return blockAllHistoryUsers(message.users);
  }
  if (message.action === 'recordSpam') {
    handleRecordSpam(message.items);
    return Promise.resolve({ success: true });
  }
  if (message.action === 'clearSpamCache') {
    storageQueue.enqueue(async () => {
      await chrome.storage.local.set({ blockedCount: 0, blockedHistory: [] });
    });
    notifyContentScripts({ action: 'clearLocalSentIds' });
    return Promise.resolve({ success: true });
  }
  if (message.action === 'removeSpamRecord') {
    handleRemoveSpamRecord(message.id, message.time);
    return Promise.resolve({ success: true });
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
  if (id) {
    notifyContentScripts({ action: 'removeLocalSentId', id });
  }

  storageQueue.enqueue(async () => {
    const storageItems = await chrome.storage.local.get(
      getStorageDefaults('blockedCount', 'blockedHistory'),
    );
    let history = storageItems.blockedHistory ?? [];
    const originalLength = history.length;
    history = history.filter((item) => !(item.id === id && item.time === time));

    const removedCount = originalLength - history.length;
    if (removedCount > 0) {
      const newCount = Math.max(0, (storageItems.blockedCount ?? 0) - removedCount);
      await chrome.storage.local.set({
        blockedCount: newCount,
        blockedHistory: history,
      });
    }
  });
}

function handleRecordSpam(items) {
  if (!items || items.length === 0) return;

  storageQueue.enqueue(async () => {
    const newSpams = Iterator.from(items)
      .filter((item) => !globalSpamCache.has(item.id))
      .map((item) => {
        globalSpamCache.add(item.id);
        return {
          id: item.id,
          text: item.text.slice(0, 200),
          user: item.user,
          displayName: item.displayName,
          reason: item.reason,
          time: item.time,
          isAutoBlock: item.isAutoBlock,
        };
      })
      .toArray();

    if (newSpams.length === 0) return;

    const storageItems = await chrome.storage.local.get(
      getStorageDefaults('blockedCount', 'blockedHistory'),
    );

    const { autoBlock: autoBlockSpams = [] } = Object.groupBy(newSpams, (s) =>
      s.isAutoBlock ? 'autoBlock' : 'manual',
    );
    const autoBlockScreenNames = autoBlockSpams.map((s) => s.user);

    if (autoBlockScreenNames.length > 0) {
      autoBlockManager.enqueueBatch(autoBlockScreenNames);
    }

    const history = storageItems.blockedHistory ?? [];
    const historyIds = new Set(Iterator.from(history).map((h) => h.id));
    const uniqueSpams = newSpams.filter((s) => !historyIds.has(s.id));

    if (uniqueSpams.length === 0) return;

    history.unshift(...uniqueSpams);
    if (history.length > 10000) {
      history.length = 10000;
    }

    await chrome.storage.local.set({
      blockedCount: (storageItems.blockedCount ?? 0) + uniqueSpams.length,
      blockedHistory: history,
    });
  });
}

async function handleBlockUser(screenName, isBlock) {
  try {
    const cleanName = extractCleanScreenName(screenName);
    if (!cleanName) {
      return { success: false, reason: '无效的用户名' };
    }
    const cookie = await chrome.cookies.get({
      url: 'https://x.com',
      name: 'ct0',
    });
    if (!cookie) {
      return { success: false, reason: '无法获取身份凭证，请确保已登录 X' };
    }

    const endpoint = isBlock ? 'create.json' : 'destroy.json';
    const headers = await getAuthHeaders();

    headers['x-csrf-token'] = cookie.value;
    headers['content-type'] = 'application/x-www-form-urlencoded';

    const response = await fetch(`https://x.com/i/api/1.1/blocks/${endpoint}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: `screen_name=${encodeURIComponent(cleanName)}`,
    });

    if (response.ok) {
      return { success: true, screenName: cleanName };
    } else {
      return { success: false, reason: `请求失败: HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

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
