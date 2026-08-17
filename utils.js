export const browserApi = globalThis.browser ?? globalThis.chrome;

const CLOUD_KEYWORDS_API =
  'https://api.github.com/repos/amahteru/x-comment-blocker/contents/keywords.txt';
const CLOUD_KEYWORDS_CDN =
  'https://fastly.jsdelivr.net/gh/amahteru/x-comment-blocker@main/keywords.txt';
export const SYNC_INTERVAL_MINUTES = 360;
export const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;
export const invisibleCharsRegex = /\p{Default_Ignorable_Code_Point}/gv;

const fastHandleRegex = /^[@/]?([a-zA-Z0-9_]{1,15})$/;

export function isKeywordRegex(k) {
  return typeof k === 'string' && k.length >= 3 && k.startsWith('/') && /\/[a-zA-Z]*$/v.test(k);
}

export function extractCleanScreenName(input) {
  if (!input) return '';
  const simpleMatch = fastHandleRegex.exec(input);
  if (simpleMatch) {
    return simpleMatch[1].toLowerCase();
  }
  const cleaned = input.replaceAll(invisibleCharsRegex, '').trim();
  const match = cleaned.match(/(?:^|\/|@)(?<handle>[a-zA-Z0-9_]{1,15})(?:\/|\?|$)/v);
  if (match) return match.groups.handle.toLowerCase();
  return '';
}

const STORAGE_DEFAULTS = {
  keywords: '',
  cloudEnabled: true,
  cloudKeywords: '',
  checkUsername: true,
  onlyComments: true,
  blockSpecialChars: false,
  blockEmoji: false,
  blockGrok: false,
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
  autoBlockBatchCount: 0,
  whitelist: [],
};

export function getStorageDefaults(...keys) {
  const result = {};
  for (const key of keys) {
    if (Object.hasOwn(STORAGE_DEFAULTS, key)) {
      result[key] = Array.isArray(STORAGE_DEFAULTS[key]) ? [] : STORAGE_DEFAULTS[key];
    }
  }
  return result;
}

export function parseKeywords(text) {
  if (!text) return [];
  const result = [];
  for (const line of text.split('\n')) {
    const k = line.replaceAll(invisibleCharsRegex, '').trim();
    if (!k) continue;
    if (isKeywordRegex(k)) {
      result.push(k);
    } else {
      result.push(k.toLowerCase());
    }
  }
  return result;
}

export async function syncCloudKeywords() {
  const { cloudEnabled } = await browserApi.storage.local.get(getStorageDefaults('cloudEnabled'));
  if (!cloudEnabled) return false;

  try {
    const headers = { Accept: 'application/vnd.github.v3.raw' };
    const { cloudETag } = await browserApi.storage.local.get(getStorageDefaults('cloudETag'));
    if (cloudETag) {
      headers['If-None-Match'] = cloudETag;
    }

    let resp;
    let isCDN = false;

    try {
      resp = await fetch(CLOUD_KEYWORDS_API, {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 403 || resp.status === 429) {
        throw new Error('API Rate Limit');
      }
      if (!resp.ok && resp.status !== 304) {
        throw new Error(`API HTTP Error: ${resp.status}`);
      }
    } catch (apiError) {
      console.warn('[X-Blocker] API update failed, falling back to CDN:', apiError);
      isCDN = true;
      resp = await fetch(`${CLOUD_KEYWORDS_CDN}?t=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        throw new Error(`CDN HTTP Error: ${resp.status}`);
      }
    }

    if (!isCDN && resp.status === 304) {
      await browserApi.storage.local.set({
        lastSyncTime: Date.now(),
        syncStatus: 'ok',
        syncError: '',
      });
      return true;
    }

    const text = await resp.text();
    const newETag = isCDN ? '' : (resp.headers.get('ETag') ?? '');

    const cloudList = parseKeywords(text);

    const storageItems = await browserApi.storage.local.get(
      getStorageDefaults('disabledCloudKeywords', 'autoBlockKeywords', 'keywords', 'cloudKeywords'),
    );

    const currentCloudList = parseKeywords(storageItems.cloudKeywords ?? '');

    if (isCDN && cloudList.length < currentCloudList.length) {
      console.log(
        `[X-Blocker] CDN cache (${cloudList.length} items) is older than local (${currentCloudList.length} items). Update aborted.`,
      );
      await browserApi.storage.local.set({
        lastSyncTime: Date.now(),
        syncStatus: 'ok',
        syncError: '',
      });
      return true;
    }
    const disabledCloudKeywords = storageItems.disabledCloudKeywords ?? [];
    const autoBlockKeywords = storageItems.autoBlockKeywords ?? [];
    const userKws = parseKeywords(storageItems.keywords);

    const cloudListSet = new Set(cloudList);
    const cleanedDisabled = disabledCloudKeywords.filter((k) => cloudListSet.has(k));
    const allValidKeywordsSet = new Set([...userKws, ...cloudListSet]);
    const cleanedAutoBlock = autoBlockKeywords.filter((k) => allValidKeywordsSet.has(k));

    await browserApi.storage.local.set({
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
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    await browserApi.storage.local
      .set({
        syncStatus: 'error',
        syncError: isTimeout ? '同步超时，请检查网络' : '网络连接失败',
      })
      .catch(() => {});
    return false;
  }
}

