(async () => {
  const browserApi = globalThis.browser ?? globalThis.chrome;
  const {
    browserApi: chrome,
    getStorageDefaults,
    getResolvedCategoryToggles,
    parseKeywords,
    parseCategorizedKeywords,
    invisibleCharsRegex,
    extractCleanScreenName,
  } = await import(browserApi.runtime.getURL('utils.js'));
  let blockRegexes = [];
  let autoBlockRegexes = [];
  let lastKeywordsKey = '';
  let checkUsername = true;
  let onlyComments = true;
  let blockSpecialChars = false;
  let blockEmoji = false;
  let blockGrok = false;
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

  function buildTrieRegex(plainKeywords) {
    if (!plainKeywords?.length) return null;
    const seen = new Set();
    const MAX_KEYWORD_LENGTH = 1000;
    for (const kw of plainKeywords) {
      if (typeof kw !== 'string') continue;
      const cleaned = kw.trim().toLowerCase();
      if (cleaned && cleaned.length <= MAX_KEYWORD_LENGTH) seen.add(cleaned);
    }
    if (!seen.size) return null;
    const sorted = Array.from(seen).sort((a, b) => a.length - b.length);

    const pruned = [];
    for (const kw of sorted) {
      if (!pruned.some((p) => kw.includes(p))) pruned.push(kw);
    }

    const root = {};
    for (const kw of pruned) {
      let node = root;
      for (const ch of kw) node = node[ch] ??= {};
    }

    const escapeChar = (c) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c);
    function stringify(node) {
      const keys = Object.keys(node);
      if (!keys.length) return '';
      const branches = keys.map((k) => escapeChar(k) + stringify(node[k]));
      return branches.length > 1 ? `(?:${branches.join('|')})` : branches[0];
    }

    return new RegExp(stringify(root), 'iu');
  }

  async function mergeKeywords() {
    try {
      const items = await chrome.storage.local.get(
        getStorageDefaults(
          'keywords',
          'cloudEnabled',
          'cloudKeywords',
          'cloudCategoryToggles',
          'cloudCategoryKeywords',
          'cloudCategoryUsernames',
          'autoBlockKeywords',
          'disabledCloudKeywords',
        ),
      );

      const userKws = parseKeywords(items.keywords);
      const disabledCloudKws = items.disabledCloudKeywords ?? [];
      let cloudKws = [];
      if (items.cloudEnabled) {
        const categorized = parseCategorizedKeywords(items.cloudKeywords ?? '');
        const toggles = getResolvedCategoryToggles(items);
        const candidateCloudKws = [];
        for (const [catName, list] of Object.entries(categorized)) {
          if (toggles[catName] ?? true) {
            candidateCloudKws.push(...list);
          }
        }
        cloudKws = new Set(candidateCloudKws)
          .difference(new Set(disabledCloudKws))
          .values()
          .toArray();
      }

      const blockKeywordsSet = new Set([...cloudKws, ...userKws]);
      const blockKeywords = blockKeywordsSet.values().toArray();
      const rawAutoBlockKws = items.autoBlockKeywords ?? [];
      const autoBlockKws = new Set(rawAutoBlockKws)
        .intersection(blockKeywordsSet)
        .values()
        .toArray();

      const newKey = `${blockKeywords.join('\n')}|AUTO:|${autoBlockKws.join('\n')}`;
      if (newKey === lastKeywordsKey) return;
      lastKeywordsKey = newKey;

      function buildRegexes(keywords) {
        if (!keywords || keywords.length === 0) return [];
        const plainKeywords = [];
        const customRegexes = [];

        for (const kw of keywords) {
          const match = kw.startsWith('/')
            ? kw.match(/^\/(?<pattern>.+)\/(?<flags>[a-zA-Z]*)$/)
            : null;
          if (match) {
            try {
              const cleanFlags = match.groups.flags.replace(/[gy]/g, '');
              customRegexes.push(new RegExp(match.groups.pattern, cleanFlags));
            } catch (e) {
              console.warn('[X-Blocker] Invalid regex ignored:', kw, e);
            }
          } else {
            plainKeywords.push(kw);
          }
        }

        const regexes = [];
        if (plainKeywords.length > 0) {
          const trieRegex = buildTrieRegex(plainKeywords);
          if (trieRegex) regexes.push(trieRegex);
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

  function getEnclosingTweetIfRelevant(target) {
    if (!target) return null;
    const elem = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
    if (!elem) return null;
    const enclosingCell = elem.closest('[data-testid="cellInnerDiv"]');
    if (!enclosingCell) return null;
    if (elem.closest('[data-testid="tweetText"], [data-testid="User-Name"]')) {
      return enclosingCell;
    }
    return null;
  }

  (async function init() {
    try {
      const items = await chrome.storage.local.get(
        getStorageDefaults(
          'checkUsername',
          'onlyComments',
          'blockSpecialChars',
          'blockEmoji',
          'blockGrok',
          'enabled',
          'whitelist',
        ),
      );

      checkUsername = items.checkUsername;
      onlyComments = items.onlyComments;
      blockSpecialChars = items.blockSpecialChars;
      blockEmoji = items.blockEmoji;
      blockGrok = items.blockGrok;
      filterEnabled = items.enabled;
      whitelistSet = new Set(items.whitelist ?? []);

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
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.getAttribute('data-testid') === 'cellInnerDiv') {
              pendingTweets.add(node);
            } else if (node.firstElementChild) {
              for (const inner of node.querySelectorAll('[data-testid="cellInnerDiv"]')) {
                pendingTweets.add(inner);
              }
            }
          }

          const tweet = getEnclosingTweetIfRelevant(mutation.target);
          if (tweet) {
            pendingTweets.add(tweet);
          }
        }

        if (pendingTweets.size > 0 && !observerFlushScheduled) {
          observerFlushScheduled = true;
          queueMicrotask(() => {
            observerFlushScheduled = false;
            if (pendingTweets.size > 0) {
              filterTweets(pendingTweets.values().toArray());
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
      return;
    }
    if (message.action === 'clearLocalSentIds') {
      localSentIds.clear();
      return;
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
    if (changes.blockGrok) {
      blockGrok = changes.blockGrok.newValue;
      needsFilter = true;
    }
    if (changes.blockSpecialChars) {
      blockSpecialChars = changes.blockSpecialChars.newValue;
      needsFilter = true;
    }
    if (changes.whitelist) {
      whitelistSet = new Set(changes.whitelist.newValue ?? []);
      needsFilter = true;
    }

    if (
      changes.keywords ||
      changes.cloudEnabled ||
      changes.cloudKeywords ||
      changes.cloudCategoryToggles ||
      changes.cloudCategoryKeywords ||
      changes.cloudCategoryUsernames ||
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
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let currentNode = walker.currentNode;
    while (currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        text += currentNode.textContent;
      } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
        const tagName = currentNode.tagName.toLowerCase();
        if (['br', 'div', 'p'].includes(tagName)) {
          if (text && !text.endsWith('\n')) text += '\n';
        } else if (tagName === 'img' && currentNode.alt) {
          let altText = currentNode.alt;
          if (
            currentNode.src &&
            (currentNode.src.includes('emoji') || currentNode.src.includes('twemoji')) &&
            !altText.endsWith('\uFE0F')
          ) {
            if (altText.length <= 2) {
              altText += '\uFE0F';
            }
          }
          text += altText;
        }
      }
      currentNode = walker.nextNode();
    }
    return text;
  }

  function hasEmoji(node) {
    if (!node) return false;

    if (emojiRegex.test(node.textContent ?? '')) return true;

    return Iterator.from(node.querySelectorAll('img')).some((img) => {
      const src = img.src ?? '';
      if (src.includes('emoji') || src.includes('twemoji')) return true;
      return emojiRegex.test(img.alt ?? '');
    });
  }

  function getTweetStatusInfo(tweet, pageStatusId) {
    const timeElements = tweet.querySelectorAll('time');
    for (let i = 0; i < timeElements.length; i++) {
      const href = timeElements[i].closest('a')?.getAttribute('href');
      if (href) {
        const match = href.match(/\/status\/(\d+)/iv);
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
    const urlMatch = window.location.pathname.match(/\/status\/(\d+)/iv);
    return {
      pageStatusId: urlMatch ? urlMatch[1] : null,
      isPhotoVideoOverlay: /\/status\/\d+\/(?:photo|video)\//iv.test(window.location.pathname),
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

  function hasGrokCard(tweet) {
    if (!tweet) return false;
    return !!tweet.querySelector('a[href*="/i/grok/share"], meta[content*="/i/grok/share"]');
  }

  function detectSpam(
    tweet,
    textNode,
    userNode,
    rawTweetText,
    userName,
    isStatusPage,
    isMainTweet,
  ) {
    const tweetBody = rawTweetText.replaceAll(invisibleCharsRegex, '');
    let stableHandle = '';
    let displayName = '';

    const handleLink = userNode?.querySelector('a[href^="/"]');
    if (handleLink) {
      const rawHref = handleLink.getAttribute('href') || '';
      stableHandle = extractCleanScreenName(rawHref);
      displayName = getTweetTextForKeywords(handleLink).replaceAll(invisibleCharsRegex, '').trim();
    }

    if (stableHandle && whitelistSet.has(stableHandle)) {
      return { isSpam: false };
    }

    if (blockGrok && hasGrokCard(tweet)) {
      return {
        isSpam: true,
        isAutoBlock: false,
        blockReason: 'Grok屏蔽',
        userName,
        stableHandle,
        displayName,
      };
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
      ? userName.replaceAll(/[\s_.\-]+/gv, '').replaceAll(invisibleCharsRegex, '')
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

    const userCandidates = [cleanUserName, userName, stableHandle].filter(Boolean);
    const matchesUserRegexes = (regexes) => {
      if (!regexes.length || !userCandidates.length) return false;
      return userCandidates.some((c) => regexes.some((r) => r.test(c)));
    };

    if (checkUsername && matchesUserRegexes(autoBlockRegexes)) {
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

    if (checkUsername && matchesUserRegexes(blockRegexes)) {
      return {
        isSpam: true,
        isAutoBlock: false,
        blockReason: '昵称屏蔽',
        userName,
        stableHandle,
        displayName,
      };
    }

    return { isSpam: false };
  }

  function isDiscoverMoreHeader(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.querySelector('article')) return false;
    return !!node.querySelector('h2, [role="heading"]');
  }

  function isAfterDiscoverMore(tweet) {
    let curr = tweet.previousElementSibling;
    while (curr) {
      if (isDiscoverMoreHeader(curr)) return true;
      const prevState = tweetStateMap.get(curr);
      if (prevState?.isDiscoverMore !== undefined) {
        return prevState.isDiscoverMore;
      }
      curr = curr.previousElementSibling;
    }
    return false;
  }

  function isReplyToParent(tweet, userNode = null, textNode = null) {
    if (tweet.querySelector('div[style*="width: 2px"], div[style*="width:2px"]')) {
      return true;
    }

    const article = tweet.querySelector('article');
    if (!article) return false;

    const actualUserNode = userNode ?? tweet.querySelector('[data-testid="User-Name"]');
    const actualTextNode = textNode ?? tweet.querySelector('[data-testid="tweetText"]');
    const allLinks = article.querySelectorAll('a[href^="/"]');

    for (let i = 0; i < allLinks.length; i++) {
      const link = allLinks[i];
      if (actualUserNode?.contains(link)) continue;
      if (actualTextNode?.contains(link)) continue;
      if (link.querySelector('time') || link.closest('time')) continue;
      if (
        link.querySelector('img') ||
        link.closest('[data-testid*="Avatar"], [data-testid*="avatar"]')
      ) {
        continue;
      }

      if (actualTextNode) {
        if (link.compareDocumentPosition(actualTextNode) & Node.DOCUMENT_POSITION_FOLLOWING) {
          return true;
        }
      } else {
        return true;
      }
    }
    return false;
  }

  function filterTweets(specificTweets = null) {
    if (!isExtensionAlive()) return;

    const tweets = specificTweets || document.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (tweets.length === 0) return;

    const pendingSpam = [];
    const pageContext = getPageContext();
    let isPastDiscoverMore = false;

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      let state = tweetStateMap.get(tweet);
      if (!state) {
        state = {};
        tweetStateMap.set(tweet, state);
      }

      const isStatusPage = resolveStatusPage(tweet, pageContext);
      let logicalPageStatusId = pageContext.pageStatusId;
      if (pageContext.isPhotoVideoOverlay && tweet.closest('[role="dialog"]') === null) {
        logicalPageStatusId = state.pageStatusId ?? pageContext.pageStatusId;
      } else {
        state.pageStatusId = pageContext.pageStatusId;
      }
      state.isStatusPage = isStatusPage;

      let isDiscoverMore = false;
      if (isStatusPage) {
        if (!specificTweets) {
          if (isDiscoverMoreHeader(tweet)) {
            isPastDiscoverMore = true;
            isDiscoverMore = false;
          } else {
            isDiscoverMore = isPastDiscoverMore;
          }
        } else {
          isDiscoverMore = isAfterDiscoverMore(tweet);
        }
      }
      state.isDiscoverMore = isDiscoverMore;

      const userNode = tweet.querySelector('[data-testid="User-Name"]');
      const textNode = tweet.querySelector('[data-testid="tweetText"]');
      const rawTweetText = textNode ? getTweetTextForKeywords(textNode) : '';
      const rawUserName = userNode ? getTweetTextForKeywords(userNode) : '';
      const hasGrok = blockGrok ? hasGrokCard(tweet) : false;

      const quickHash = `${rawTweetText}|${rawUserName}|${filterVersion}|${isStatusPage}|${logicalPageStatusId || ''}|${hasGrok}|${isDiscoverMore}`;
      if (state.quickHash === quickHash) {
        if (state.isSpam) {
          tweet.classList.add('x-comment-blocker-hidden');
        } else {
          tweet.classList.remove('x-comment-blocker-hidden');
        }
        continue;
      }

      if (tweet.closest('[aria-hidden="true"]')) continue;

      let shouldCheck =
        filterEnabled && (blockRegexes.length > 0 || blockEmoji || blockSpecialChars || blockGrok);
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
            continue;
          }
        }
      }

      if (shouldCheck && onlyComments && (isMainTweet || isDiscoverMore)) shouldCheck = false;

      const effectiveStatusPage = isStatusPage && !isDiscoverMore;
      const spamResult = shouldCheck
        ? detectSpam(
            tweet,
            textNode,
            userNode,
            rawTweetText,
            rawUserName,
            effectiveStatusPage,
            isMainTweet,
          )
        : null;
      const isSpam = spamResult?.isSpam ?? false;

      state.quickHash = quickHash;
      state.isSpam = isSpam;

      if (isSpam) {
        const { isAutoBlock, blockReason, userName, stableHandle, displayName } = spamResult;
        tweet.classList.remove('x-comment-blocker-hidden-reply');
        tweet.classList.add('x-comment-blocker-hidden');
        let normalizedBody = rawTweetText
          .replaceAll(invisibleCharsRegex, '')
          .replaceAll(/\s+/gv, ' ')
          .trim();

        if (blockReason === 'Grok屏蔽') {
          const grokMeta = tweet.querySelector(
            'a[href*="/i/grok/share"], meta[content*="/i/grok/share"]',
          );
          const grokLink = grokMeta ? grokMeta.getAttribute('content') || grokMeta.href : '';
          if (grokLink) {
            normalizedBody = normalizedBody ? `${normalizedBody}\n${grokLink}` : grokLink;
          }
        }

        const uniqueId = tweetId ?? `${normalizedBody}|${stableHandle}`;

        if (!localSentIds.has(uniqueId)) {
          localSentIds.add(uniqueId);
          if (localSentIds.size > 5000) {
            for (const val of localSentIds.values().take(500)) {
              localSentIds.delete(val);
            }
          }

          pendingSpam.push({
            id: uniqueId,
            text: normalizedBody,
            user: stableHandle || userName,
            displayName: displayName || '',
            reason: blockReason,
            time: Temporal.Now.instant().epochMilliseconds,
            isAutoBlock: isAutoBlock,
          });
        }
      } else {
        const prev = tweet.previousElementSibling;
        let isHiddenReply = false;

        if (
          !isDiscoverMore &&
          prev &&
          (prev.classList.contains('x-comment-blocker-hidden') ||
            prev.classList.contains('x-comment-blocker-hidden-reply'))
        ) {
          if (isReplyToParent(tweet, userNode, textNode)) {
            isHiddenReply = true;
          }
        }

        if (isHiddenReply) {
          tweet.classList.add('x-comment-blocker-hidden-reply');
        } else {
          tweet.classList.remove('x-comment-blocker-hidden-reply');
        }

        tweet.classList.remove('x-comment-blocker-hidden');
      }
    }

    if (pendingSpam.length > 0) {
      try {
        chrome.runtime.sendMessage({ action: 'recordSpam', items: pendingSpam }).catch(() => {});
      } catch {}
    }
  }

  function scheduleFilter() {
    if (!isExtensionAlive()) return;
    if (filterTimer) cancelAnimationFrame(filterTimer);
    filterTimer = requestAnimationFrame(() => filterTweets());
  }
})();
