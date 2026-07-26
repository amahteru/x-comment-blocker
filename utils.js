export const CLOUD_KEYWORDS_URL =
  'https://api.github.com/repos/ethanzhou-dev/x-comment-blocker/contents/keywords.txt';
export const SYNC_INTERVAL_MINUTES = 360;
export const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;
export const invisibleCharsRegex = /\p{Default_Ignorable_Code_Point}/gv;

export function extractCleanScreenName(input) {
  if (!input) return '';
  const cleaned = input.replaceAll(invisibleCharsRegex, '').trim();
  const match = cleaned.match(/(?:^|\/|@)(?<handle>[a-zA-Z0-9_]{1,15})(?:\/|\?|$)/);
  if (match) return match.groups.handle.toLowerCase();
  return cleaned
    .replace(/^[@/]+/, '')
    .split(/[/?]/)
    .at(0)
    .toLowerCase();
}

const STORAGE_DEFAULTS = {
  keywords: '',
  cloudEnabled: true,
  cloudKeywords: '',
  checkUsername: true,
  onlyComments: true,
  blockSpecialChars: false,
  blockEmoji: false,
  enabled: true,
  blockedCount: 0,
  blockedHistory: [],
  lastSyncTime: 0,
  syncStatus: '',
  syncError: '',
  cloudETag: '',
  blockedUsersOnX: [],
  historyFilterReason: 'all',
  autoBlockKeywords: [],
  disabledCloudKeywords: [],
  autoBlockQueue: [],
  autoBlockToday: 0,
  autoBlockLastDate: '',
  autoBlockPausedUntil: 0,
  whitelist: [],
};

export function getStorageDefaults(...keys) {
  return Object.fromEntries(
    Iterator.from(keys)
      .filter((key) => Object.hasOwn(STORAGE_DEFAULTS, key))
      .map((key) => [key, Array.isArray(STORAGE_DEFAULTS[key]) ? [] : STORAGE_DEFAULTS[key]]),
  );
}

export function parseKeywords(text) {
  if (!text) return [];
  return Iterator.from(text.split('\n'))
    .map((k) => k.replaceAll(invisibleCharsRegex, '').trim())
    .filter((k) => k)
    .map((k) => {
      if (k.length >= 3 && k.startsWith('/') && /\/[a-zA-Z]*$/.test(k)) {
        return k;
      }
      return k.toLowerCase();
    })
    .toArray();
}

export async function syncCloudKeywords() {
  const { cloudEnabled } = await chrome.storage.local.get(getStorageDefaults('cloudEnabled'));
  if (!cloudEnabled) return false;

  try {
    const headers = { Accept: 'application/vnd.github.v3.raw' };
    const { cloudETag } = await chrome.storage.local.get(getStorageDefaults('cloudETag'));
    if (cloudETag) {
      headers['If-None-Match'] = cloudETag;
    }

    const resp = await fetch(CLOUD_KEYWORDS_URL, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (resp.status === 304) {
      await chrome.storage.local.set({
        lastSyncTime: Date.now(),
        syncStatus: 'ok',
        syncError: '',
      });
      return true;
    }
    if (resp.status === 403 || resp.status === 429) {
      await chrome.storage.local.set({
        syncStatus: 'error',
        syncError: 'API 请求限流，请稍后重试',
      });
      return false;
    }
    if (!resp.ok) {
      await chrome.storage.local.set({
        syncStatus: 'error',
        syncError: `HTTP ${resp.status}`,
      });
      return false;
    }

    const text = await resp.text();
    const newETag = resp.headers.get('ETag') ?? '';

    const cloudList = parseKeywords(text);

    // Clean up stale disabled keywords and auto block keywords
    const storageItems = await chrome.storage.local.get(
      getStorageDefaults('disabledCloudKeywords', 'autoBlockKeywords', 'keywords'),
    );
    const disabledCloudKeywords = storageItems.disabledCloudKeywords ?? [];
    const autoBlockKeywords = storageItems.autoBlockKeywords ?? [];
    const userKws = parseKeywords(storageItems.keywords);

    const cloudListSet = new Set(cloudList);
    const cleanedDisabled = new Set(disabledCloudKeywords)
      .intersection(cloudListSet)
      .values()
      .toArray();
    const allValidKeywordsSet = new Set(Iterator.concat(userKws, cloudListSet));
    const cleanedAutoBlock = new Set(autoBlockKeywords)
      .intersection(allValidKeywordsSet)
      .values()
      .toArray();

    await chrome.storage.local.set({
      cloudKeywords: cloudList.join('\n'),
      disabledCloudKeywords: cleanedDisabled,
      autoBlockKeywords: cleanedAutoBlock,
      cloudETag: newETag,
      lastSyncTime: Date.now(),
      syncStatus: 'ok',
      syncError: '',
    });
    return true;
  } catch (e) {
    const isTimeout = Error.isError(e) && (e.name === 'TimeoutError' || e.name === 'AbortError');
    await chrome.storage.local
      .set({
        syncStatus: 'error',
        syncError: isTimeout ? '同步超时，请检查网络' : '网络连接失败',
      })
      .catch(() => {});
    return false;
  }
}
