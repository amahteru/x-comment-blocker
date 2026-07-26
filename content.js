/* global getStorageDefaults, parseKeywords, invisibleCharsRegex */
let blockRegexes = [];
let autoBlockRegexes = [];
let lastKeywordsKey = '';
let checkUsername = true;
let onlyComments = true;
let blockSpecialChars = false;
let blockEmoji = false;
let filterEnabled = true;
let filterTimer = null;
let filterVersion = 0;
let whitelistSet = new Set();
let observerFlushScheduled = false;
const localSentIds = new Set();
const tweetStateMap = new WeakMap();
const emojiRegex = /\p{RGI_Emoji}/v;
const spamCharsRegex =
  /[\u02B0-\u02FF\u0F00-\u0FFF\u1D00-\u1D7F\u1D80-\u1DBF\u2070-\u209F\u2100-\u2BFF\uA980-\uA9DF\uAA00-\uAADF\u{13000}-\u{1342F}\u{1D400}-\u{1D7FF}]/v;

function isExtensionAlive() {
  return !!chrome.runtime?.id;
}

function matchesBlocklist(text) {
  if (blockRegexes.length === 0) return false;
  return blockRegexes.some((regex) => regex.test(text));
}

function matchesAutoBlocklist(text) {
  if (autoBlockRegexes.length === 0) return false;
  return autoBlockRegexes.some((regex) => regex.test(text));
}

async function mergeKeywords() {
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults(
        'keywords',
        'cloudEnabled',
        'cloudKeywords',
        'autoBlockKeywords',
        'disabledCloudKeywords',
      ),
    );

    const userKws = parseKeywords(items.keywords);
    const disabledCloudKws = items.disabledCloudKeywords || [];
    const cloudKws = items.cloudEnabled
      ? parseKeywords(items.cloudKeywords).filter((kw) => !disabledCloudKws.includes(kw))
      : [];

    const blockKeywordsSet = new Set(Iterator.concat(cloudKws, userKws));
    const blockKeywords = Array.from(blockKeywordsSet);
    const rawAutoBlockKws = items.autoBlockKeywords || [];
    const autoBlockKws = Array.from(new Set(rawAutoBlockKws).intersection(blockKeywordsSet));

    const newKey = `${blockKeywords.join('\n')}|AUTO:|${autoBlockKws.join('\n')}`;
    if (newKey === lastKeywordsKey) return;
    lastKeywordsKey = newKey;

    function buildRegexes(keywords) {
      if (!keywords || keywords.length === 0) return [];
      const plainKeywords = [];
      const customRegexes = [];

      for (const kw of keywords) {
        let match;
        if (kw.startsWith('/') && (match = kw.match(/^\/(.+)\/([a-zA-Z]*)$/))) {
          try {
            customRegexes.push(new RegExp(match[1], match[2]));
          } catch (e) {
            console.warn('[X-Blocker] Invalid regex ignored:', kw, e);
          }
        } else {
          plainKeywords.push(kw);
        }
      }

      const regexes = [];
      if (plainKeywords.length > 0) {
        const escaped = plainKeywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        escaped.sort((a, b) => b.length - a.length);
        const CHUNK_SIZE = 400;
        for (let i = 0; i < escaped.length; i += CHUNK_SIZE) {
          const chunk = escaped.slice(i, i + CHUNK_SIZE);
          regexes.push(new RegExp(chunk.join('|'), 'i'));
        }
      }
      if (customRegexes.length > 0) {
        regexes.push(...customRegexes);
      }
      return regexes;
    }

    blockRegexes = buildRegexes(blockKeywords);
    autoBlockRegexes = buildRegexes(autoBlockKws);
  } catch (e) {
    console.error('[X-Blocker] mergeKeywords error:', e);
  }
}

(async function init() {
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults(
        'checkUsername',
        'onlyComments',
        'blockSpecialChars',
        'blockEmoji',
        'enabled',
        'whitelist',
      ),
    );

    checkUsername = items.checkUsername;
    onlyComments = items.onlyComments;
    blockSpecialChars = items.blockSpecialChars;
    blockEmoji = items.blockEmoji;
    filterEnabled = items.enabled;
    whitelistSet = new Set(items.whitelist || []);

    await mergeKeywords();
    filterTweets();

    const pendingTweets = new Set();

    const observer = new MutationObserver((mutations) => {
      if (!isExtensionAlive()) {
        observer.disconnect();
        return;
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.getAttribute('data-testid') === 'cellInnerDiv') {
              pendingTweets.add(node);
            } else if (node.querySelector) {
              const innerTweets = node.querySelectorAll('[data-testid="cellInnerDiv"]');
              innerTweets.forEach((t) => pendingTweets.add(t));
            }
          }
        }

        if (mutation.target) {
          const el =
            mutation.target.nodeType === Node.ELEMENT_NODE
              ? mutation.target
              : mutation.target.parentElement;
          if (el?.closest) {
            if (!el.closest('[data-testid="tweetText"], [data-testid="User-Name"]')) {
              continue;
            }
            const closestTweet = el.closest('[data-testid="cellInnerDiv"]');
            if (closestTweet) {
              pendingTweets.add(closestTweet);
            }
          }
        }
      }

      if (pendingTweets.size > 0 && !observerFlushScheduled) {
        observerFlushScheduled = true;
        queueMicrotask(() => {
          observerFlushScheduled = false;
          if (pendingTweets.size > 0) {
            filterTweets(Array.from(pendingTweets));
            pendingTweets.clear();
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  } catch (e) {
    console.error('[X-Blocker] init error:', e);
  }
})();

chrome.runtime.onMessage.addListener((message) => {
  if (!isExtensionAlive()) return;
  if (message.action === 'removeLocalSentId' && message.id) {
    localSentIds.delete(message.id);
    return false;
  }
  if (message.action === 'clearLocalSentIds') {
    localSentIds.clear();
    return false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !isExtensionAlive()) return;

  let needsFilter = false;

  if (changes.enabled) {
    filterEnabled = changes.enabled.newValue;
    needsFilter = true;
  }
  if (changes.checkUsername) {
    checkUsername = changes.checkUsername.newValue;
    needsFilter = true;
  }
  if (changes.onlyComments) {
    onlyComments = changes.onlyComments.newValue;
    needsFilter = true;
  }
  if (changes.blockEmoji) {
    blockEmoji = changes.blockEmoji.newValue;
    needsFilter = true;
  }
  if (changes.blockSpecialChars) {
    blockSpecialChars = changes.blockSpecialChars.newValue;
    needsFilter = true;
  }
  if (changes.whitelist) {
    whitelistSet = new Set(changes.whitelist.newValue || []);
    needsFilter = true;
  }

  if (
    changes.keywords ||
    changes.cloudEnabled ||
    changes.cloudKeywords ||
    changes.autoBlockKeywords ||
    changes.disabledCloudKeywords
  ) {
    mergeKeywords().then(() => {
      filterVersion++;
      scheduleFilter();
    });
  } else if (needsFilter) {
    filterVersion++;
    scheduleFilter();
  }
});

function getTweetTextForKeywords(node) {
  if (!node) return '';
  let text = '';
  function traverse(n) {
    if (n.nodeType === Node.TEXT_NODE) {
      text += n.textContent;
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      if (n.tagName.toLowerCase() === 'img' && n.alt) {
        let altText = n.alt;
        if (
          n.src &&
          (n.src.includes('emoji') || n.src.includes('twemoji')) &&
          !altText.endsWith('\uFE0F')
        ) {
          if (altText.length <= 2) {
            altText += '\uFE0F';
          }
        }
        text += altText;
      } else {
        for (const child of n.childNodes) {
          traverse(child);
        }
      }
    }
  }
  traverse(node);
  return text;
}

function hasEmoji(node) {
  if (!node) return false;

  if (emojiRegex.test(node.textContent || '')) return true;

  const imgs = node.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.src || '';
    if (src.includes('emoji') || src.includes('twemoji')) return true;
    if (img.alt && emojiRegex.test(img.alt)) return true;
  }
  return false;
}

function getTweetStatusInfo(tweet, pageStatusId) {
  const timeNodes = tweet.querySelectorAll('time');
  for (const timeEl of timeNodes) {
    const link = timeEl.closest('a');
    if (link) {
      const href = link.getAttribute('href');
      const match = href ? href.match(/\/status\/(\d+)/i) : null;
      if (match) {
        return {
          id: match[1],
          isMainTweet: pageStatusId ? match[1] === pageStatusId : false,
        };
      }
    }
  }
  return { id: null, isMainTweet: false };
}

function getPageContext() {
  const urlMatch = window.location.pathname.match(/\/status\/(\d+)/i);
  return {
    pageStatusId: urlMatch ? urlMatch[1] : null,
    isPhotoVideoOverlay: /\/status\/\d+\/(?:photo|video)\//i.test(window.location.pathname),
  };
}

function resolveStatusPage(tweet, pageContext) {
  if (pageContext.isPhotoVideoOverlay) {
    if (tweet.closest('[role="dialog"]') !== null) return true;
    const state = tweetStateMap.get(tweet);
    if (state?.isStatusPage !== undefined) return state.isStatusPage;
    return false;
  }
  return !!pageContext.pageStatusId;
}

function detectSpam(textNode, userNode, rawTweetText, rawUserName, isStatusPage, isMainTweet) {
  const tweetBody = rawTweetText.replace(invisibleCharsRegex, '');
  const userName = rawUserName;
  let stableHandle = '';
  let displayName = '';

  const handleLink = userNode?.querySelector('a[href^="/"]');
  if (handleLink) {
    const rawHref = handleLink.getAttribute('href') || '';
    stableHandle = extractCleanScreenName(rawHref);
    displayName = getTweetTextForKeywords(handleLink).replace(invisibleCharsRegex, '').trim();
  }

  if (stableHandle && whitelistSet.has(stableHandle)) {
    return { isSpam: false };
  }

  if (isStatusPage && !isMainTweet) {
    if (blockEmoji && textNode && hasEmoji(textNode)) {
      return {
        isSpam: true,
        isAutoBlock: false,
        blockReason: '表情屏蔽',
        userName,
        stableHandle,
        displayName,
      };
    }
    if (blockSpecialChars && textNode && spamCharsRegex.test(textNode.textContent)) {
      return {
        isSpam: true,
        isAutoBlock: false,
        blockReason: '特殊字符屏蔽',
        userName,
        stableHandle,
        displayName,
      };
    }
  }

  const cleanUserName = userName
    ? userName.replace(/[\s_.-]+/g, '').replace(invisibleCharsRegex, '')
    : '';

  if (matchesAutoBlocklist(tweetBody)) {
    return {
      isSpam: true,
      isAutoBlock: true,
      blockReason: '内容屏蔽',
      userName,
      stableHandle,
      displayName,
    };
  }

  if (checkUsername && userName && matchesAutoBlocklist(cleanUserName)) {
    return {
      isSpam: true,
      isAutoBlock: true,
      blockReason: '昵称屏蔽',
      userName,
      stableHandle,
      displayName,
    };
  }

  if (matchesBlocklist(tweetBody)) {
    return {
      isSpam: true,
      isAutoBlock: false,
      blockReason: '内容屏蔽',
      userName,
      stableHandle,
      displayName,
    };
  }

  if (checkUsername && userName && matchesBlocklist(cleanUserName)) {
    return {
      isSpam: true,
      isAutoBlock: false,
      blockReason: '昵称屏蔽',
      userName,
      stableHandle,
      displayName,
    };
  }

  return {
    isSpam: false,
    isAutoBlock: false,
    blockReason: '',
    userName,
    stableHandle,
    displayName,
  };
}

function filterTweets(specificTweets = null) {
  if (!isExtensionAlive()) return;

  const tweets = specificTweets || document.querySelectorAll('[data-testid="cellInnerDiv"]');
  if (tweets.length === 0) return;

  const pendingSpam = [];
  const pageContext = getPageContext();

  tweets.forEach((tweet) => {
    const userNode = tweet.querySelector('[data-testid="User-Name"]');
    const textNode = tweet.querySelector('[data-testid="tweetText"]');
    const isStatusPage = resolveStatusPage(tweet, pageContext);

    let state = tweetStateMap.getOrInsert(tweet, {});

    let logicalPageStatusId = pageContext.pageStatusId;
    if (pageContext.isPhotoVideoOverlay && tweet.closest('[role="dialog"]') === null) {
      logicalPageStatusId = state.pageStatusId || pageContext.pageStatusId;
    } else {
      state.pageStatusId = pageContext.pageStatusId;
    }
    state.isStatusPage = isStatusPage;

    const rawTweetText = textNode ? getTweetTextForKeywords(textNode) : '';
    const rawUserName = userNode ? getTweetTextForKeywords(userNode) : '';

    const quickHash =
      rawTweetText +
      '|' +
      rawUserName +
      '|' +
      filterVersion +
      '|' +
      isStatusPage +
      '|' +
      (logicalPageStatusId || '');
    if (state.quickHash === quickHash) {
      if (state.isSpam) {
        if (!tweet.classList.contains('x-comment-blocker-hidden')) {
          tweet.classList.add('x-comment-blocker-hidden');
        }
      } else {
        tweet.classList.remove('x-comment-blocker-hidden');
      }
      return;
    }

    if (tweet.closest('[aria-hidden="true"]')) return;
    state.quickHash = quickHash;

    let shouldCheck = filterEnabled && (blockRegexes.length > 0 || blockEmoji || blockSpecialChars);
    if (shouldCheck && onlyComments && !isStatusPage) shouldCheck = false;

    let isMainTweet = false;
    let tweetId = null;
    if (shouldCheck) {
      const statusInfo = getTweetStatusInfo(tweet, logicalPageStatusId || null);
      tweetId = statusInfo.id;

      if (isStatusPage && logicalPageStatusId) {
        isMainTweet = statusInfo.isMainTweet;
        if (!tweet.querySelector('article')) {
          state.quickHash = '';
          return;
        }
      }
    }

    if (shouldCheck && onlyComments && isMainTweet) shouldCheck = false;

    let isSpam = false;
    let isAutoBlock = false;
    let blockReason = '';
    let userName = '';
    let stableHandle = '';
    let displayName = '';

    if (shouldCheck) {
      const result = detectSpam(
        textNode,
        userNode,
        rawTweetText,
        rawUserName,
        isStatusPage,
        isMainTweet,
      );
      isSpam = result.isSpam;
      isAutoBlock = result.isAutoBlock;
      blockReason = result.blockReason;
      userName = result.userName;
      stableHandle = result.stableHandle;
      displayName = result.displayName;
    }

    state.isSpam = isSpam;
    if (isSpam) {
      if (!tweet.classList.contains('x-comment-blocker-hidden')) {
        tweet.classList.add('x-comment-blocker-hidden');
      }
      const normalizedBody = rawTweetText
        .replace(invisibleCharsRegex, '')
        .replace(/\s+/g, ' ')
        .trim();

      const uniqueId = tweetId ?? `${normalizedBody}|${stableHandle}`;

      if (!localSentIds.has(uniqueId)) {
        localSentIds.add(uniqueId);
        if (localSentIds.size > 2000) {
          const iter = localSentIds.values();
          for (let i = 0; i < 500; i++) localSentIds.delete(iter.next().value);
        }

        pendingSpam.push({
          id: uniqueId,
          text: normalizedBody,
          user: stableHandle || userName,
          displayName: displayName || '',
          reason: blockReason,
          time: Date.now(),
          isAutoBlock: isAutoBlock,
        });
      }
    } else {
      tweet.classList.remove('x-comment-blocker-hidden');
    }
  });

  if (pendingSpam.length > 0) {
    try {
      chrome.runtime.sendMessage({ action: 'recordSpam', items: pendingSpam }).catch(() => {});
    } catch {
      // Ignore error if background script is not ready
    }
  }
}

function scheduleFilter() {
  if (!isExtensionAlive()) return;
  if (filterTimer) cancelAnimationFrame(filterTimer);
  filterTimer = requestAnimationFrame(() => filterTweets());
}
