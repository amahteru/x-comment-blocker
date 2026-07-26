/* global importScripts, syncCloudKeywords, SYNC_INTERVAL_MINUTES, parseKeywords, getStorageDefaults */
importScripts('utils.js');

const ALARM_NAME = 'cloudKeywordSync';
let isSyncing = false;

async function getAuthHeaders() {
  return {
    authorization:
      'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  };
}

class AsyncQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }
  async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      try {
        await task();
      } catch (e) {
        console.error('[X-Blocker] Queue task error:', e);
      }
    }
    this.isProcessing = false;
  }
}

const globalSpamCache = new Set();
const storageQueue = new AsyncQueue();

storageQueue.enqueue(async () => {
  const items = await chrome.storage.local.get(getStorageDefaults('blockedHistory'));
  const history = items.blockedHistory || [];
  for (const item of history) {
    if (item.id) globalSpamCache.add(item.id);
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
    if (typeof autoBlockManager !== 'undefined') {
      autoBlockManager.process();
    }
  }
});

class AutoBlockManager {
  constructor() {
    this.isProcessing = false;
    this.dailyLimit = 150;
    this.minDelayMs = 5000;
    this.maxDelayMs = 10000;

    this.queue = [];
    this.blockedUsersSet = new Set();
    this.countToday = 0;
    this.lastDate = '';
    this.pausedUntil = 0;
    this.initialized = false;
    this.initPromise = null;
  }

  async checkDailyReset() {
    const today = new Date().toDateString();
    if (this.lastDate !== today) {
      this.lastDate = today;
      this.countToday = 0;
      await this.saveState({
        autoBlockLastDate: this.lastDate,
        autoBlockToday: this.countToday,
      });
    }
  }

  async init() {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const defaults = getStorageDefaults(
          'autoBlockQueue',
          'autoBlockToday',
          'autoBlockLastDate',
          'autoBlockPausedUntil',
          'blockedUsersOnX',
        );
        const items = await chrome.storage.local.get(defaults);

        this.queue = items.autoBlockQueue || [];
        this.countToday = items.autoBlockToday || 0;
        this.lastDate = items.autoBlockLastDate || '';
        this.pausedUntil = items.autoBlockPausedUntil || 0;
        this.blockedUsersSet = new Set(items.blockedUsersOnX || []);

        await this.checkDailyReset();

        this.initialized = true;
      })();
    }
    await this.initPromise;
  }

  async saveState(updates) {
    await chrome.storage.local.set(updates);
  }

  async enqueueBatch(screenNames) {
    await this.init();
    if (!screenNames || screenNames.length === 0) return;

    let changed = false;
    for (const screenName of screenNames) {
      const cleanName = extractCleanScreenName(screenName);
      if (cleanName && !this.queue.includes(cleanName) && !this.blockedUsersSet.has(cleanName)) {
        this.queue.push(cleanName);
        changed = true;
      }
    }

    if (changed) {
      await this.saveState({ autoBlockQueue: this.queue });
      this.process();
    }
  }

  async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.init();

      while (true) {
        await this.checkDailyReset();

        if (this.pausedUntil > Date.now()) {
          console.warn(
            `[X-Blocker] Auto block paused for ${Math.ceil((this.pausedUntil - Date.now()) / 1000)}s.`,
          );
          break;
        }

        if (this.countToday >= this.dailyLimit) {
          console.warn('[X-Blocker] Auto block daily limit reached.');
          break;
        }

        if (this.queue.length === 0) break;

        const currentItem = this.queue[0];

        try {
          const res = await handleBlockUser(currentItem, true);
          if (res?.success) {
            this.queue.shift();
            this.countToday++;
            this.blockedUsersSet.add(currentItem);

            let blockedUsersArray = Array.from(this.blockedUsersSet);
            if (blockedUsersArray.length > 5000) {
              blockedUsersArray = blockedUsersArray.slice(-5000);
              this.blockedUsersSet = new Set(blockedUsersArray);
            }

            await this.saveState({
              autoBlockQueue: this.queue,
              autoBlockToday: this.countToday,
              blockedUsersOnX: blockedUsersArray,
            });
          } else if (
            res?.reason &&
            (res.reason.includes('429') || res.reason.includes('HTTP 429'))
          ) {
            console.warn('[X-Blocker] API rate limited (429). Pausing auto block for 15 mins.');
            this.pausedUntil = Date.now() + 15 * 60 * 1000;
            await this.saveState({ autoBlockPausedUntil: this.pausedUntil });
            break;
          } else {
            console.error(
              '[X-Blocker] Auto block failed for',
              currentItem,
              res ? res.reason : 'unknown',
            );
            this.queue.shift();
            await this.saveState({ autoBlockQueue: this.queue });
          }
        } catch (e) {
          console.error('[X-Blocker] Auto block task execution error:', e);
          this.queue.shift();
          await this.saveState({ autoBlockQueue: this.queue });
        }

        if (this.queue.length > 0) {
          const delay =
            Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

var autoBlockManager = new AutoBlockManager();
autoBlockManager.init().then(() => autoBlockManager.process());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void sender;
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
  if (message.action === 'recordSpam') {
    handleRecordSpam(message.items);
    sendResponse({ success: true });
    return false;
  }
  if (message.action === 'clearSpamCache') {
    storageQueue.enqueue(async () => {
      globalSpamCache.clear();
      await chrome.storage.local.set({ blockedCount: 0, blockedHistory: [] });
    });
    notifyContentScripts({ action: 'clearLocalSentIds' });
    sendResponse({ success: true });
    return false;
  }
  if (message.action === 'removeSpamRecord') {
    handleRemoveSpamRecord(message.id, message.time);
    sendResponse({ success: true });
    return false;
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
    if (id) {
      globalSpamCache.delete(id);
    }
    const storageItems = await chrome.storage.local.get(
      getStorageDefaults('blockedCount', 'blockedHistory'),
    );
    let history = storageItems.blockedHistory || [];
    const originalLength = history.length;
    history = history.filter((item) => !(item.id === id && item.time === time));

    const removedCount = originalLength - history.length;
    if (removedCount > 0) {
      const newCount = Math.max(0, (storageItems.blockedCount || 0) - removedCount);
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
    const newSpams = [];
    for (const item of items) {
      if (!globalSpamCache.has(item.id)) {
        globalSpamCache.add(item.id);
        newSpams.push({
          id: item.id,
          text: item.text,
          user: item.user,
          displayName: item.displayName,
          reason: item.reason,
          time: item.time,
          isAutoBlock: item.isAutoBlock,
        });
        if (globalSpamCache.size > 5000) {
          const iter = globalSpamCache.values();
          for (let i = 0; i < 1000; i++) globalSpamCache.delete(iter.next().value);
        }
      }
    }

    if (newSpams.length === 0) return;

    const storageItems = await chrome.storage.local.get(
      getStorageDefaults('blockedCount', 'blockedHistory'),
    );

    const autoBlockScreenNames = newSpams.filter((s) => s.isAutoBlock).map((s) => s.user);
    if (autoBlockScreenNames.length > 0) {
      autoBlockManager.enqueueBatch(autoBlockScreenNames);
    }

    const history = storageItems.blockedHistory || [];
    const historyIds = new Set(history.map((h) => h.id));
    const uniqueSpams = newSpams.filter((s) => !historyIds.has(s.id));

    if (uniqueSpams.length === 0) return;

    history.unshift(...uniqueSpams);
    if (history.length > 2000) {
      history.length = 2000;
    }

    await chrome.storage.local.set({
      blockedCount: (storageItems.blockedCount || 0) + uniqueSpams.length,
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
      body: `screen_name=${encodeURIComponent(cleanName)}`,
    });

    if (response.ok) {
      return { success: true, screenName: cleanName };
    } else {
      return { success: false, reason: `请求失败: HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'addToBlocklist' && info.selectionText) {
    const inputKws = parseKeywords(info.selectionText);
    if (inputKws.length === 0) return;

    const items = await chrome.storage.local.get(getStorageDefaults('keywords'));
    const existing = parseKeywords(items.keywords);
    let added = false;
    for (const kw of inputKws) {
      if (!existing.includes(kw)) {
        existing.push(kw);
        added = true;
      }
    }
    if (added) {
      await chrome.storage.local.set({ keywords: existing.join('\n') });
    }
  }
});
