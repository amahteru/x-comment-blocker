import {
  browserApi as chrome,
  extractCleanScreenName,
  getStorageDefaults,
  parseKeywords,
  SYNC_INTERVAL_MS,
} from './utils.js';

let userKeywords = [];
let autoBlockKeywords = new Set();
let isLoading = true;
let isEditingAutoBlock = false;

const ICON_EDIT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
const ICON_DEL =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const ICON_CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const ICON_BAN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>';

const keywordList = document.getElementById('keywordList');
const keywordCount = document.getElementById('keywordCount');
const autoBlockCount = document.getElementById('autoBlockCount');
const editAutoBlockBtn = document.getElementById('editAutoBlockBtn');
const saveAutoBlockBtn = document.getElementById('saveAutoBlockBtn');
const newKeywordInput = document.getElementById('newKeyword');
const addBtn = document.getElementById('addBtn');
const importBtn = document.getElementById('importBtn');
const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');
const exportAllBtn = document.getElementById('exportAllBtn');
const importAllBtn = document.getElementById('importAllBtn');
const importAllFile = document.getElementById('importAllFile');
const checkUsernameEl = document.getElementById('checkUsername');
const onlyCommentsEl = document.getElementById('onlyComments');
const blockSpecialCharsEl = document.getElementById('blockSpecialChars');
const blockEmojiEl = document.getElementById('blockEmoji');
const blockGrokEl = document.getElementById('blockGrok');
const enableToggleEl = document.getElementById('enableToggle');
const cloudToggleEl = document.getElementById('cloudToggle');
const cloudInfoEl = document.getElementById('cloudInfo');
const syncBtn = document.getElementById('sync-btn');
const statusEl = document.getElementById('status');
const blockedCountEl = document.getElementById('blockedCount');
const resetCountBtn = document.getElementById('resetCount');

const viewHistoryBtn = document.getElementById('viewHistory');
const historyModal = document.getElementById('historyModal');
const closeHistoryBtn = document.getElementById('closeHistory');
const historyList = document.getElementById('historyList');

let whitelist = [];
const openWhitelistBtn = document.getElementById('openWhitelistBtn');
const whitelistModal = document.getElementById('whitelistModal');
const closeWhitelistBtn = document.getElementById('closeWhitelist');
const whitelistCount = document.getElementById('whitelistCount');
const newWhitelistUser = document.getElementById('newWhitelistUser');
const addWhitelistBtn = document.getElementById('addWhitelistBtn');
const whitelistList = document.getElementById('whitelistList');

const openCloudModalBtn = document.getElementById('openCloudModalBtn');
const cloudModal = document.getElementById('cloudModal');
const closeCloudBtn = document.getElementById('closeCloud');
const cloudKeywordList = document.getElementById('cloudKeywordList');
const cloudScrollContainer = document.getElementById('cloudScrollContainer');
const cloudModalSubtitle = document.getElementById('cloudModalSubtitle');

const toggleCloudSearchBtn = document.getElementById('toggleCloudSearchBtn');
const cloudSearchContainer = document.getElementById('cloudSearchContainer');
const cloudSearchInput = document.getElementById('cloudSearchInput');

const editCloudAutoBlockBtn = document.getElementById('editCloudAutoBlockBtn');
const saveCloudAutoBlockBtn = document.getElementById('saveCloudAutoBlockBtn');
let isEditingCloudAutoBlock = false;

let currentCloudSearchQuery = '';
let cloudSearchDebounceTimer = null;

let statusTimer = 0;
function showStatus(text) {
  statusEl.textContent = text;
  statusEl.classList.add('visible');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.classList.remove('visible');
  }, 1500);
}

async function autoSave() {
  if (isLoading) return;

  await chrome.storage.local.set({
    keywords: userKeywords.join('\n'),
    autoBlockKeywords: autoBlockKeywords.values().toArray(),
    checkUsername: checkUsernameEl.checked,
    onlyComments: onlyCommentsEl.checked,
    blockSpecialChars: blockSpecialCharsEl.checked,
    blockEmoji: blockEmojiEl.checked,
    blockGrok: blockGrokEl.checked,
    enabled: enableToggleEl.checked,
    cloudEnabled: cloudToggleEl.checked,
  });
  showStatus('已自动保存');
}

editAutoBlockBtn.addEventListener('click', () => {
  isEditingAutoBlock = true;
  editAutoBlockBtn.style.display = 'none';
  saveAutoBlockBtn.style.display = 'inline-flex';
  renderUserKeywords();
});

saveAutoBlockBtn.addEventListener('click', () => {
  isEditingAutoBlock = false;
  saveAutoBlockBtn.style.display = 'none';
  editAutoBlockBtn.style.display = 'inline-flex';
  autoSave();
  renderUserKeywords();
});

function updateEnabledState() {
  document.body.classList.toggle('disabled', !enableToggleEl.checked);
}

function el(tag, props, children) {
  const element = document.createElement(tag);
  Object.assign(element, props);
  if (children) {
    element.append(...children);
  }
  return element;
}

function emptyHistoryHint(text = '暂无记录') {
  return el('div', { className: 'history-item' }, [
    el('div', {
      className: 'history-item-text',
      style: 'text-align: center; color: var(--text-muted); padding: 12px 0;',
      textContent: text,
    }),
  ]);
}

function updateBlockBtns(screenName, { disabled = false, loading = false } = {}) {
  document
    .querySelectorAll(`button.btn-block-x[data-screen-name="${screenName}"]`)
    .forEach((btn) => {
      btn.disabled = disabled;
      if (loading) {
        btn.textContent = '请求中...';
        return;
      }
      const isBlocked = currentBlockedUsersOnX.includes(screenName);
      btn.textContent = isBlocked ? '已拉黑' : '拉黑';
      btn.classList.toggle('success', isBlocked);
      btn.title = isBlocked ? '点击解除拉黑' : '在 X 上拉黑该账号';
    });
}

function isKeywordRegex(kw) {
  return kw.length >= 3 && kw.startsWith('/') && /\/[a-zA-Z]*$/.test(kw);
}

function renderUserKeywords(animateIndex = -1, fadeIndex = -1) {
  if (userKeywords.length === 0) {
    keywordList.replaceChildren(
      el('div', { className: 'empty-hint', textContent: '暂无自定义屏蔽词' }),
    );
    document.querySelector('.keyword-stats').style.display = 'none';
    return;
  }

  document.querySelector('.keyword-stats').style.display = 'flex';

  const tags = userKeywords.map((kw, index) => {
    const editBtn = el('button', {
      className: 'tag-btn tag-btn-edit',
      innerHTML: ICON_EDIT,
      title: '编辑',
    });
    const delBtn = el('button', {
      className: 'tag-btn tag-btn-del',
      innerHTML: ICON_DEL,
      title: '删除',
      onclick: () => {
        if (tag.classList.contains('fade-out-tag')) return;
        tag.classList.remove('fade-in-tag');
        tag.classList.add('fade-out-tag');
        const kwToRemove = kw;
        setTimeout(() => {
          const idx = userKeywords.indexOf(kwToRemove);
          if (idx !== -1) {
            userKeywords = userKeywords.toSpliced(idx, 1);
            autoBlockKeywords.delete(kwToRemove);
          }
          renderUserKeywords();
          autoSave();
        }, 200);
      },
    });

    const isRegex = isKeywordRegex(kw);
    const isAutoBlock = autoBlockKeywords.has(kw);

    let tagChildren = [];
    if (isEditingAutoBlock) {
      const checkbox = el('input', {
        type: 'checkbox',
        className: 'tag-checkbox',
        checked: isAutoBlock,
        onchange: (e) => {
          if (e.target.checked) {
            autoBlockKeywords.add(kw);
          } else {
            autoBlockKeywords.delete(kw);
          }
        },
      });
      tagChildren = [el('span', { className: 'tag-text', textContent: kw, title: kw }), checkbox];
    } else {
      tagChildren = [
        el('span', { className: 'tag-text', textContent: kw, title: kw }),
        editBtn,
        delBtn,
      ];
    }

    const tag = el(
      'span',
      {
        className: `keyword-tag${isRegex ? ' regex-tag' : ''}${isAutoBlock && !isEditingAutoBlock ? ' is-autoblock' : ''}${index === animateIndex ? ' fade-in-tag' : ''}${index === fadeIndex ? ' fade-in' : ''}`,
      },
      tagChildren,
    );

    if (!isEditingAutoBlock) {
      editBtn.onclick = () => startEdit(tag, index);
    }
    return tag;
  });

  keywordList.replaceChildren(...tags);
  keywordCount.textContent = `共 ${userKeywords.length} 个自定义词`;
  autoBlockCount.textContent = autoBlockKeywords.size;
}

function startEdit(tagEl, index) {
  tagEl.innerHTML = '';
  tagEl.classList.add('is-editing');

  const input = el('input', {
    className: 'tag-edit-input',
    value: userKeywords[index],
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      confirmEdit(input, index);
    } else if (e.key === 'Escape') {
      renderUserKeywords(-1, index);
    }
  });

  const confirmBtn = el('button', {
    className: 'tag-btn tag-btn-save',
    innerHTML: ICON_CHECK,
    title: '确认',
    onclick: () => confirmEdit(input, index),
  });
  const cancelBtn = el('button', {
    className: 'tag-btn tag-btn-del',
    innerHTML: ICON_DEL,
    title: '取消',
    onclick: () => renderUserKeywords(-1, index),
  });

  tagEl.append(input, confirmBtn, cancelBtn);

  input.focus();
  input.select();
}

function confirmEdit(inputEl, index) {
  const inputKws = parseKeywords(inputEl.value);
  let changed = false;
  if (inputKws.length > 0) {
    const newVal = inputKws.at(0);
    const existingIndex = userKeywords.indexOf(newVal);
    if (existingIndex === -1 || existingIndex === index) {
      if (userKeywords[index] !== newVal) {
        const oldVal = userKeywords[index];
        userKeywords[index] = newVal;
        if (autoBlockKeywords.has(oldVal)) {
          autoBlockKeywords.delete(oldVal);
          autoBlockKeywords.add(newVal);
        }
        changed = true;
      }
    } else {
      showStatus(isKeywordRegex(newVal) ? '该正则已存在' : '该屏蔽词已存在');
    }
  }
  renderUserKeywords(-1, index);
  if (changed) autoSave();
}

function addKeyword() {
  const inputKws = parseKeywords(newKeywordInput.value);
  if (inputKws.length === 0) return;

  const newKws = new Set(inputKws).difference(new Set(userKeywords)).values().toArray();

  newKeywordInput.value = '';
  newKeywordInput.focus();

  if (newKws.length === 0) {
    showStatus(isKeywordRegex(inputKws.at(0)) ? '该正则已存在' : '该屏蔽词已存在');
    return;
  }

  userKeywords.push(...newKws);
  renderUserKeywords(userKeywords.length - 1);
  autoSave();
  keywordList.scrollTop = keywordList.scrollHeight;
}

addBtn.addEventListener('click', addKeyword);

newKeywordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addKeyword();
  }
});

exportBtn.addEventListener('click', () => {
  if (userKeywords.length === 0) {
    showStatus('词库为空');
    return;
  }
  const content = userKeywords.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `x-comment-blocker-keywords-${Temporal.Now.plainDateISO().toString()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus('导出成功');
});

importBtn.addEventListener('click', () => {
  importFile.click();
});

importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const content = await file.text();
    let newKeywords = [];

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        newKeywords = parseKeywords(
          Iterator.from(parsed)
            .map((k) => String(k))
            .toArray()
            .join('\n'),
        );
      }
    } catch {
      newKeywords = parseKeywords(content);
    }

    if (newKeywords.length > 0) {
      const newKws = new Set(newKeywords).difference(new Set(userKeywords));
      if (newKws.size > 0) {
        userKeywords.push(...newKws);
        renderUserKeywords();
        autoSave();
        showStatus(`成功导入 ${newKws.size} 个新词`);
      } else {
        showStatus('未发现新词，词库已包含这些内容');
      }
    } else {
      showStatus('文件内容无效');
    }
  } catch {
    showStatus('文件读取失败');
  } finally {
    importFile.value = '';
  }
});

exportAllBtn.addEventListener('click', async () => {
  try {
    const allItems = await chrome.storage.local.get(null);
    const content = JSON.stringify(allItems, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-comment-blocker-backup-${Temporal.Now.plainDateISO().toString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showStatus('全量导出成功');
  } catch {
    showStatus('导出失败');
  }
});

importAllBtn.addEventListener('click', () => {
  importAllFile.click();
});

function sanitizeImportedState(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'blockedHistory') {
      out[key] = Array.isArray(value)
        ? value
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
              id: typeof item.id === 'string' ? item.id : String(item.id ?? ''),
              text: typeof item.text === 'string' ? item.text : '',
              user: typeof item.user === 'string' ? item.user : '',
              displayName: typeof item.displayName === 'string' ? item.displayName : '',
              reason: typeof item.reason === 'string' ? item.reason : '',
              time: Number(item.time) || 0,
              isAutoBlock: item.isAutoBlock === true,
            }))
        : [];
    } else if (
      [
        'whitelist',
        'autoBlockKeywords',
        'disabledCloudKeywords',
        'autoBlockQueue',
        'blockedUsersOnX',
      ].includes(key)
    ) {
      out[key] = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
    } else if (
      [
        'checkUsername',
        'onlyComments',
        'blockSpecialChars',
        'blockEmoji',
        'blockGrok',
        'enabled',
        'cloudEnabled',
      ].includes(key)
    ) {
      out[key] = value === true;
    } else if (
      [
        'keywords',
        'cloudKeywords',
        'cloudETag',
        'syncStatus',
        'syncError',
        'autoBlockLastDate',
        'historyFilterReason',
      ].includes(key)
    ) {
      out[key] = typeof value === 'string' ? value : String(value ?? '');
    } else if (
      ['blockedCount', 'autoBlockToday', 'autoBlockPausedUntil', 'lastSyncTime'].includes(key)
    ) {
      out[key] = Number(value) || 0;
    } else {
      out[key] = value;
    }
  }
  return out;
}

importAllFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const sanitized = sanitizeImportedState(parsed);
      const currentKeys = Object.keys(await chrome.storage.local.get(null));
      try {
        await chrome.storage.local.set(sanitized);
      } catch {
        showStatus('恢复失败:文件数据超出存储容量,原有数据未受影响');
        return;
      }
      const staleKeys = currentKeys.filter((k) => !(k in sanitized));
      if (staleKeys.length > 0) {
        chrome.storage.local.remove(staleKeys).catch(() => {});
      }
      showStatus('全量恢复成功,重新加载中...');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      showStatus('无效的配置文件格式');
    }
  } catch {
    showStatus('文件读取或解析失败');
  } finally {
    importAllFile.value = '';
  }
});

function formatHistoryTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const localTz = Temporal.Now.timeZoneId();
  const date = Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(localTz);
  const now = Temporal.Now.zonedDateTimeISO(localTz);

  if (date.toPlainDate().equals(now.toPlainDate())) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: localTz,
    }).format(timestamp);
  } else if (date.year === now.year) {
    return `${date.month}月${date.day}日`;
  } else {
    return `${date.year}年${date.month}月${date.day}日`;
  }
}

const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' });

function relativeTime(ts) {
  if (!ts) return '';
  const tsInstant = Temporal.Instant.fromEpochMilliseconds(ts);
  const diffSec = Temporal.Now.instant().until(tsInstant).total('seconds');
  if (diffSec > -60) return '刚刚同步';
  if (diffSec > -3600) return `${rtf.format(Math.ceil(diffSec / 60), 'minute')}同步`;
  if (diffSec > -86400) return `${rtf.format(Math.ceil(diffSec / 3600), 'hour')}同步`;
  return `${rtf.format(Math.ceil(diffSec / 86400), 'day')}同步`;
}

async function updateCloudInfo() {
  const items = await chrome.storage.local.get(
    getStorageDefaults('cloudKeywords', 'lastSyncTime', 'syncStatus', 'syncError'),
  );
  const cloudList = parseKeywords(items.cloudKeywords);
  const countText = cloudList.length > 0 ? `${cloudList.length} 个词` : '';

  cloudInfoEl.classList.remove('error');

  if (items.syncStatus === 'error') {
    cloudInfoEl.classList.add('error');
    cloudInfoEl.textContent = countText ? `${countText} · 同步失败` : '同步失败';
  } else if (items.lastSyncTime) {
    const timeText = relativeTime(items.lastSyncTime);
    cloudInfoEl.textContent = countText ? `${countText} · ${timeText}` : timeText;
  } else {
    cloudInfoEl.textContent = countText;
  }
}

async function renderCloudKeywords() {
  const items = await chrome.storage.local.get(
    getStorageDefaults('cloudKeywords', 'disabledCloudKeywords'),
  );
  let cloudList = parseKeywords(items.cloudKeywords);
  let disabledList = items.disabledCloudKeywords ?? [];

  if (currentCloudSearchQuery !== '') {
    cloudList = cloudList.filter((kw) => kw.toLowerCase().includes(currentCloudSearchQuery));
  }

  if (cloudList.length === 0) {
    cloudKeywordList.replaceChildren(
      el('div', {
        className: 'empty-hint',
        textContent: currentCloudSearchQuery ? '没有找到匹配的屏蔽词' : '暂无云端屏蔽词',
      }),
    );
    if (currentCloudSearchQuery) {
      cloudModalSubtitle.textContent = `(搜索到 ${cloudList.length} 个词)`;
    } else {
      cloudModalSubtitle.textContent = '';
    }
    return;
  }

  cloudModalSubtitle.textContent = currentCloudSearchQuery
    ? `(搜索到 ${cloudList.length} 个词)`
    : `(共 ${cloudList.length} 个词)`;
  const tags = cloudList.map((kw) => {
    const isRegex = isKeywordRegex(kw);
    const textSpan = el('span', { className: 'tag-text', textContent: kw, title: kw });

    highlightText(textSpan, currentCloudSearchQuery);

    const isDisabled = disabledList.includes(kw);
    const isAutoBlock = autoBlockKeywords.has(kw);

    let tagChildren = [];
    if (isEditingCloudAutoBlock) {
      const checkbox = el('input', {
        type: 'checkbox',
        className: 'tag-checkbox',
        checked: isAutoBlock,
        onchange: (e) => {
          if (e.target.checked) {
            autoBlockKeywords.add(kw);
          } else {
            autoBlockKeywords.delete(kw);
          }
        },
      });
      tagChildren = [textSpan, checkbox];
    } else {
      const banBtn = el('button', {
        className: 'tag-btn tag-btn-del',
        innerHTML: ICON_BAN,
        title: isDisabled ? '取消禁用' : '禁用',
        onclick: async () => {
          if (isDisabled) {
            disabledList = disabledList.filter((k) => k !== kw);
          } else {
            disabledList.push(kw);
          }
          await chrome.storage.local.set({ disabledCloudKeywords: disabledList });
          renderCloudKeywords();
        },
      });
      tagChildren = [textSpan, banBtn];
    }

    return el(
      'span',
      {
        className: `keyword-tag${isRegex ? ' regex-tag' : ''}${isDisabled ? ' is-disabled' : ''}${isAutoBlock && !isEditingCloudAutoBlock ? ' is-autoblock' : ''}`,
        style: 'width: calc(50% - 5px);',
      },
      tagChildren,
    );
  });

  cloudKeywordList.replaceChildren(...tags);

  const savedScroll = localStorage.getItem('cloudScrollTop');
  if (!currentCloudSearchQuery && savedScroll) {
    cloudScrollContainer.scrollTop = Number(savedScroll);
  }
}

if (toggleCloudSearchBtn && cloudSearchContainer && cloudSearchInput) {
  toggleCloudSearchBtn.addEventListener('click', () => {
    const isOpen = cloudSearchContainer.classList.toggle('open');
    if (isOpen) {
      cloudSearchInput.focus();
    } else {
      clearTimeout(cloudSearchDebounceTimer);
      cloudSearchInput.value = '';
      if (currentCloudSearchQuery !== '') {
        currentCloudSearchQuery = '';
        renderCloudKeywords();
      }
    }
  });

  cloudSearchInput.addEventListener('input', (e) => {
    currentCloudSearchQuery = e.target.value.toLowerCase();
    clearTimeout(cloudSearchDebounceTimer);
    cloudSearchDebounceTimer = setTimeout(() => renderCloudKeywords(), 200);
  });
}

if (editCloudAutoBlockBtn && saveCloudAutoBlockBtn) {
  editCloudAutoBlockBtn.addEventListener('click', () => {
    isEditingCloudAutoBlock = true;
    editCloudAutoBlockBtn.style.display = 'none';
    saveCloudAutoBlockBtn.style.display = 'inline-flex';
    renderCloudKeywords();
  });

  saveCloudAutoBlockBtn.addEventListener('click', () => {
    isEditingCloudAutoBlock = false;
    saveCloudAutoBlockBtn.style.display = 'none';
    editCloudAutoBlockBtn.style.display = 'inline-flex';
    autoSave();
    renderCloudKeywords();
    renderUserKeywords();
  });
}

openCloudModalBtn.addEventListener('click', () => {
  renderCloudKeywords();
  cloudModal.classList.add('open');
});

closeCloudBtn.addEventListener('click', () => {
  cloudModal.classList.remove('open');
  if (isEditingCloudAutoBlock) {
    isEditingCloudAutoBlock = false;
    saveCloudAutoBlockBtn.style.display = 'none';
    editCloudAutoBlockBtn.style.display = 'inline-flex';
  }
  clearTimeout(cloudSearchDebounceTimer);
  if (cloudSearchContainer?.classList.contains('open')) {
    cloudSearchContainer.classList.remove('open');
    cloudSearchInput.value = '';
    currentCloudSearchQuery = '';
  }
});

let cloudScrollDebounceTimer = null;
cloudScrollContainer.addEventListener('scroll', () => {
  clearTimeout(cloudScrollDebounceTimer);
  if (currentCloudSearchQuery) return;
  const currentScroll = cloudScrollContainer.scrollTop;
  cloudScrollDebounceTimer = setTimeout(() => {
    localStorage.setItem('cloudScrollTop', currentScroll);
  }, 100);
});

async function triggerCloudSync(manual = false) {
  try {
    const result = await chrome.runtime.sendMessage({ action: 'syncNow' });
    if (!result?.success) {
      if (manual) showStatus('同步失败，请检查网络');
    } else {
      if (manual) showStatus('云端词库已同步');

      const items = await chrome.storage.local.get(['autoBlockKeywords']);
      if (items.autoBlockKeywords) {
        autoBlockKeywords = new Set(items.autoBlockKeywords);
      }
      if (cloudModal.classList.contains('open')) {
        renderCloudKeywords();
      }
      renderUserKeywords();
    }
  } catch {
    if (manual) showStatus('同步失败，请检查网络');
  }

  updateCloudInfo();

  if (syncBtn.classList.contains('syncing')) {
    const startTime = Temporal.Instant.fromEpochMilliseconds(
      parseInt(syncBtn.dataset.syncStartTime || Temporal.Now.instant().epochMilliseconds, 10),
    );
    const elapsed = Temporal.Now.instant().since(startTime).total('milliseconds');
    const animationDuration = 1000;
    const mod = elapsed % animationDuration;
    const remaining = mod === 0 ? 0 : animationDuration - mod;

    setTimeout(() => {
      syncBtn.classList.remove('syncing');
    }, remaining);
  }
}

enableToggleEl.addEventListener('change', () => {
  updateEnabledState();
  autoSave();
});

checkUsernameEl.addEventListener('change', () => autoSave());
onlyCommentsEl.addEventListener('change', () => autoSave());
blockSpecialCharsEl.addEventListener('change', () => autoSave());
blockEmojiEl.addEventListener('change', () => autoSave());
blockGrokEl.addEventListener('change', () => autoSave());
cloudToggleEl.addEventListener('change', () => autoSave());

syncBtn.addEventListener('click', () => {
  syncBtn.dataset.syncStartTime = Temporal.Now.instant().epochMilliseconds;
  syncBtn.classList.add('syncing');
  triggerCloudSync(true);
});

document.addEventListener('DOMContentLoaded', async () => {
  const settingsHeader = document.getElementById('settingsHeader');
  const settingsContent = document.getElementById('settingsContent');
  const settingsArrow = document.getElementById('settingsArrow');

  if (settingsHeader) {
    settingsHeader.addEventListener('click', () => {
      settingsContent.classList.toggle('open');
      settingsArrow.classList.toggle('open');
    });
  }

  const items = await chrome.storage.local.get(
    getStorageDefaults(
      'keywords',
      'autoBlockKeywords',
      'checkUsername',
      'onlyComments',
      'blockSpecialChars',
      'blockEmoji',
      'blockGrok',
      'enabled',
      'cloudEnabled',
      'blockedCount',
      'lastSyncTime',
      'cloudKeywords',
      'whitelist',
    ),
  );

  whitelist = items.whitelist ?? [];

  userKeywords = parseKeywords(items.keywords);
  const rawAutoBlockKeywords = items.autoBlockKeywords ?? [];

  const allValidKeywordsSet = new Set(
    Iterator.concat(userKeywords, parseKeywords(items.cloudKeywords || '')),
  );
  autoBlockKeywords = new Set(rawAutoBlockKeywords).intersection(allValidKeywordsSet);
  if (rawAutoBlockKeywords.length !== autoBlockKeywords.size) {
    await chrome.storage.local.set({ autoBlockKeywords: autoBlockKeywords.values().toArray() });
  }

  checkUsernameEl.checked = items.checkUsername;
  onlyCommentsEl.checked = items.onlyComments;
  blockSpecialCharsEl.checked = items.blockSpecialChars;
  blockEmojiEl.checked = items.blockEmoji;
  blockGrokEl.checked = items.blockGrok;
  enableToggleEl.checked = items.enabled;
  cloudToggleEl.checked = items.cloudEnabled;
  blockedCountEl.textContent = items.blockedCount ?? 0;

  updateEnabledState();
  renderUserKeywords();
  isLoading = false;
  updateCloudInfo();

  if (
    !items.lastSyncTime ||
    Temporal.Now.instant().epochMilliseconds - items.lastSyncTime > SYNC_INTERVAL_MS
  ) {
    syncBtn.dataset.syncStartTime = Temporal.Now.instant().epochMilliseconds;
    syncBtn.classList.add('syncing');
    triggerCloudSync();
  }
});

resetCountBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'clearSpamCache' }).catch(() => {});
});

let currentHistory = [];
let filteredHistory = [];
let currentBlockedUsersOnX = [];
let historyNextIndex = 0;
const HISTORY_PAGE_SIZE = 50;
let isHistoryLoading = false;
let currentFilterReason = 'all';
let currentSearchQuery = '';
let searchDebounceTimer = null;

const filterHistoryBtn = document.getElementById('filterHistoryBtn');
const filterDropdown = document.getElementById('filterDropdown');
const blockAllHistoryBtn = document.getElementById('blockAllHistoryBtn');
const toggleSearchBtn = document.getElementById('toggleSearchBtn');
const historySearchContainer = document.getElementById('historySearchContainer');
const historySearchInput = document.getElementById('historySearchInput');

const toggleWhitelistSearchBtn = document.getElementById('toggleWhitelistSearchBtn');
const whitelistSearchContainer = document.getElementById('whitelistSearchContainer');
const whitelistSearchInput = document.getElementById('whitelistSearchInput');
let currentWhitelistSearchQuery = '';
let whitelistSearchDebounceTimer = null;

if (blockAllHistoryBtn) {
  let isConfirmingBlockAll = false;
  let blockAllConfirmTimer = null;
  const originalHtml = blockAllHistoryBtn.innerHTML;

  const resetBtnState = () => {
    isConfirmingBlockAll = false;
    blockAllHistoryBtn.innerHTML = originalHtml;
    blockAllHistoryBtn.classList.remove('danger-confirm');
  };

  blockAllHistoryBtn.addEventListener('click', async (e) => {
    if (blockAllHistoryBtn.disabled) return;

    const usersToBlock = Array.from(
      new Set(
        filteredHistory
          .map((item) => extractCleanScreenName(item.user))
          .filter((name) => /^[a-zA-Z0-9_]{1,15}$/v.test(name))
      )
    );

    if (usersToBlock.length === 0) {
      showStatus('当前列表没有可拉黑的用户');
      return;
    }

    if (!isConfirmingBlockAll) {
      e.stopPropagation();
      isConfirmingBlockAll = true;
      blockAllHistoryBtn.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>确认拉黑(${usersToBlock.length})`;
      blockAllHistoryBtn.classList.add('danger-confirm');
      
      blockAllConfirmTimer = setTimeout(resetBtnState, 3000);
      return;
    }

    clearTimeout(blockAllConfirmTimer);
    resetBtnState();

    blockAllHistoryBtn.disabled = true;
    blockAllHistoryBtn.title = '正在加入拉黑队列...';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'blockAllHistoryUsers',
        users: usersToBlock,
      });
      if (result?.success) {
        if (result.queued > 0) {
          showStatus(`已将 ${result.queued} 个用户加入拉黑队列`);
        } else if (result.total > 0) {
          showStatus('历史用户均已拉黑或正在处理中');
        } else {
          showStatus('暂无可拉黑的历史用户');
        }
      } else {
        showStatus(result?.reason || '批量拉黑失败');
      }
    } catch {
      showStatus('请求失败');
    } finally {
      blockAllHistoryBtn.disabled = false;
      blockAllHistoryBtn.title = '拉黑列表';
    }
  });
}

if (toggleSearchBtn && historySearchContainer && historySearchInput) {
  toggleSearchBtn.addEventListener('click', () => {
    const isOpen = historySearchContainer.classList.toggle('open');
    if (isOpen) {
      historySearchInput.focus();
    } else {
      clearTimeout(searchDebounceTimer);
      historySearchInput.value = '';
      if (currentSearchQuery !== '') {
        currentSearchQuery = '';
        applyHistoryFilter();
      }
    }
  });

  historySearchInput.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.toLowerCase();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => applyHistoryFilter(), 200);
  });
}

if (toggleWhitelistSearchBtn && whitelistSearchContainer && whitelistSearchInput) {
  toggleWhitelistSearchBtn.addEventListener('click', () => {
    const isOpen = whitelistSearchContainer.classList.toggle('open');
    if (isOpen) {
      whitelistSearchInput.focus();
    } else {
      clearTimeout(whitelistSearchDebounceTimer);
      whitelistSearchInput.value = '';
      if (currentWhitelistSearchQuery !== '') {
        currentWhitelistSearchQuery = '';
        renderWhitelist();
      }
    }
  });

  whitelistSearchInput.addEventListener('input', (e) => {
    currentWhitelistSearchQuery = e.target.value.toLowerCase();
    clearTimeout(whitelistSearchDebounceTimer);
    whitelistSearchDebounceTimer = setTimeout(() => renderWhitelist(), 200);
  });
}

if (filterHistoryBtn && filterDropdown) {
  filterHistoryBtn.addEventListener('click', () => {
    filterDropdown.classList.toggle('open');
    document.getElementById('moreDropdown')?.classList.remove('open');
  });

  const moreActionsBtn = document.getElementById('moreActionsBtn');
  const moreDropdown = document.getElementById('moreDropdown');
  if (moreActionsBtn && moreDropdown) {
    moreActionsBtn.addEventListener('click', () => {
      moreDropdown.classList.toggle('open');
      filterDropdown.classList.remove('open');
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#filterDropdown') && !e.target.closest('#filterHistoryBtn')) {
      filterDropdown.classList.remove('open');
    }
    if (moreDropdown && !e.target.closest('#moreDropdown') && !e.target.closest('#moreActionsBtn')) {
      moreDropdown.classList.remove('open');
    }
  });

  moreDropdown?.addEventListener('click', (e) => {
    if (e.target.closest('.dropdown-option')) {
      moreDropdown.classList.remove('open');
    }
  });

  filterDropdown.addEventListener('click', async (e) => {
    const option = e.target.closest('.dropdown-option');
    if (option) {
      const reason = option.dataset.reason;
      if (reason !== currentFilterReason) {
        filterDropdown.querySelectorAll('.dropdown-option').forEach((opt) => {
          opt.classList.remove('active');
        });
        option.classList.add('active');

        currentFilterReason = reason;
        await chrome.storage.local.set({ historyFilterReason: reason });

        applyHistoryFilter();
      }
    }
  });
}

function updateFilterOptions() {
  if (!filterDropdown) return;

  const reasonsSet = new Set();
  currentHistory.forEach((item) => {
    if (item.reason) reasonsSet.add(item.reason);
    if (currentBlockedUsersOnX.includes(extractCleanScreenName(item.user))) {
      reasonsSet.add('__blocked_on_x__');
    }
  });

  const reasons = reasonsSet
    .values()
    .toArray()
    .toSorted((a, b) => {
      if (a === '__blocked_on_x__') return -1;
      if (b === '__blocked_on_x__') return 1;
      return a.localeCompare(b);
    });

  if (currentFilterReason !== 'all' && !reasons.includes(currentFilterReason)) {
    currentFilterReason = 'all';
  }

  const allOption = document.createElement('div');
  allOption.className = `dropdown-option ${currentFilterReason === 'all' ? 'active' : ''}`;
  allOption.dataset.reason = 'all';
  allOption.textContent = '全部原因';

  const optionNodes = reasons.map((reason) => {
    const opt = document.createElement('div');
    opt.className = `dropdown-option ${currentFilterReason === reason ? 'active' : ''}`;
    opt.dataset.reason = reason;
    opt.textContent = reason === '__blocked_on_x__' ? '已拉黑' : reason;
    return opt;
  });

  filterDropdown.replaceChildren(allOption, ...optionNodes);
}

function highlightText(element, query) {
  if (!query) return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const matches = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent;
    const regex = new RegExp(RegExp.escape(query), 'giv');
    for (const match of text.matchAll(regex)) {
      matches.push({ node, index: match.index, length: query.length });
    }
  }
  matches.toReversed().forEach(({ node, index, length }) => {
    const after = node.splitText(index);
    after.splitText(length);
    const mark = document.createElement('mark');
    mark.className = 'search-highlight';
    mark.textContent = after.textContent;
    after.parentNode.replaceChild(mark, after);
  });
}

function applyHistoryFilter() {
  let filtered = currentHistory;
  const blockedUsersSet = new Set(currentBlockedUsersOnX);

  if (currentFilterReason !== 'all') {
    if (currentFilterReason === '__blocked_on_x__') {
      filtered = filtered.filter((item) => {
        const screenName = extractCleanScreenName(item.user);
        return blockedUsersSet.has(screenName);
      });
    } else {
      filtered = filtered.filter((item) => item.reason === currentFilterReason);
    }
  }

  if (currentSearchQuery !== '') {
    filtered = filtered.filter((item) => {
      const text = item.text?.toLowerCase() ?? '';

      let user = item.user?.toLowerCase() ?? '';
      if (user) {
        if (user.startsWith('/')) {
          user = `@${user.substring(1)}`;
        } else if (!user.startsWith('@')) {
          user = `@${user}`;
        }
      }

      const displayName = item.displayName?.toLowerCase() ?? '';
      return (
        text.includes(currentSearchQuery) ||
        user.includes(currentSearchQuery) ||
        displayName.includes(currentSearchQuery)
      );
    });
  }

  filteredHistory = filtered;

  historyNextIndex = 0;
  historyList.replaceChildren();
  historyList.scrollTop = 0;

  if (filteredHistory.length === 0) {
    historyList.replaceChildren(emptyHistoryHint());
    return;
  }

  renderHistoryPage();
}

function renderHistoryPage() {
  if (isHistoryLoading) return;
  isHistoryLoading = true;

  const start = historyNextIndex;
  const end = Math.min(start + HISTORY_PAGE_SIZE, filteredHistory.length);

  if (start >= filteredHistory.length) {
    isHistoryLoading = false;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const item = filteredHistory[i];
    const handle = extractCleanScreenName(item.user);

    const userInfo = el('div', { className: 'history-item-user-info' });
    if (handle && item.displayName) {
      const nameSpan = el('span', {
        className: 'history-display-name',
        textContent: item.displayName,
        title: item.displayName,
      });
      const handleSpan = el('span', { className: 'history-handle', textContent: `@${handle}` });
      highlightText(nameSpan, currentSearchQuery);
      highlightText(handleSpan, currentSearchQuery);
      userInfo.append(nameSpan, handleSpan);
    } else if (handle) {
      const handleSpan = el('span', { className: 'history-handle', textContent: `@${handle}` });
      highlightText(handleSpan, currentSearchQuery);
      userInfo.append(handleSpan);
    } else {
      const userSpan = el('span', {
        className: 'history-display-name',
        textContent: item.user ?? '未知用户',
      });
      highlightText(userSpan, currentSearchQuery);
      userInfo.append(userSpan);
    }

    const removeBtn = el('button', {
      className: 'btn-remove-x',
      innerHTML: ICON_DEL,
      title: '从记录中移除此项',
    });
    const actionsChildren = [
      el('span', { className: 'history-time', textContent: formatHistoryTime(item.time) }),
      removeBtn,
    ];

    if (handle) {
      const screenName = handle;
      const blockBtn = el('button', { className: 'btn-block-x' });
      blockBtn.dataset.screenName = screenName;

      const isBlocked = currentBlockedUsersOnX.includes(screenName);
      blockBtn.textContent = isBlocked ? '已拉黑' : '拉黑';
      blockBtn.classList.toggle('success', isBlocked);
      blockBtn.title = isBlocked ? '点击解除拉黑' : '在 X 上拉黑该账号';

      blockBtn.onclick = async () => {
        const isCurrentlyBlocked = currentBlockedUsersOnX.includes(screenName);
        updateBlockBtns(screenName, { disabled: true, loading: true });

        try {
          const action = isCurrentlyBlocked ? 'unblockUserOnX' : 'blockUserOnX';
          const res = await chrome.runtime.sendMessage({ action, screenName });
          if (res?.success) {
            const currentItems = await chrome.storage.local.get(
              getStorageDefaults('blockedUsersOnX'),
            );
            let currentList = currentItems.blockedUsersOnX ?? [];

            if (!isCurrentlyBlocked) {
              if (!currentList.includes(screenName)) currentList.push(screenName);
            } else {
              currentList = currentList.filter((u) => u !== screenName);
            }

            await chrome.storage.local.set({ blockedUsersOnX: currentList });
            currentBlockedUsersOnX = currentList;
          } else {
            showStatus(res?.reason || '操作失败');
          }
        } catch {
          showStatus('请求失败');
        }
        updateBlockBtns(screenName);
      };
      actionsChildren.push(blockBtn);
    }

    const actionsDiv = el('div', { className: 'history-item-actions' }, actionsChildren);

    let displayText = item.text || '[无内容或已隐藏]';
    if (item.reason) displayText = `[${item.reason}] ${displayText}`;
    const textDiv = el('div', { className: 'history-item-text', textContent: displayText });
    highlightText(textDiv, currentSearchQuery);

    const div = el('div', { className: 'history-item' }, [
      el('div', { className: 'history-item-header' }, [userInfo, actionsDiv]),
      textDiv,
    ]);

    removeBtn.onclick = async () => {
      removeBtn.disabled = true;
      div.style.opacity = '0.5';
      await chrome.runtime
        .sendMessage({ action: 'removeSpamRecord', id: item.id, time: item.time })
        .catch(() => {});
      div.remove();

      currentHistory = currentHistory.filter((h) => !(h.id === item.id && h.time === item.time));
      filteredHistory = filteredHistory.filter((h) => !(h.id === item.id && h.time === item.time));

      const oldReason = currentFilterReason;
      updateFilterOptions();
      if (oldReason !== currentFilterReason) {
        await chrome.storage.local.set({ historyFilterReason: currentFilterReason });
        applyHistoryFilter();
        return;
      }

      historyNextIndex = Math.max(0, historyNextIndex - 1);
      if (filteredHistory.length === 0) {
        historyList.replaceChildren(emptyHistoryHint());
      } else if (historyList.querySelectorAll('.history-item').length === 0) {
        renderHistoryPage();
      }
    };

    fragment.appendChild(div);
  }
  historyList.appendChild(fragment);

  Iterator.from(historyList.querySelectorAll('.history-display-name'))
    .filter((span) => span.scrollWidth > span.clientWidth)
    .forEach((span) => {
      span.classList.add('is-overflowing');
    });

  historyNextIndex = end;
  isHistoryLoading = false;
}

historyList.addEventListener('scroll', () => {
  if (historyList.scrollTop + historyList.clientHeight >= historyList.scrollHeight - 50) {
    renderHistoryPage();
  }
});

viewHistoryBtn.addEventListener('click', async () => {
  historyModal.classList.add('open');
  historyList.replaceChildren(emptyHistoryHint('加载中...'));

  const items = await chrome.storage.local.get(
    getStorageDefaults('blockedHistory', 'blockedUsersOnX', 'historyFilterReason'),
  );
  currentHistory = items.blockedHistory ?? [];
  currentBlockedUsersOnX = items.blockedUsersOnX ?? [];

  const oldReason = items.historyFilterReason || 'all';
  currentFilterReason = oldReason;
  updateFilterOptions();

  if (currentFilterReason !== oldReason) {
    await chrome.storage.local.set({ historyFilterReason: currentFilterReason });
  }

  applyHistoryFilter();
});

closeHistoryBtn.addEventListener('click', () => {
  historyModal.classList.remove('open');
  clearTimeout(searchDebounceTimer);
  if (historySearchContainer?.classList.contains('open')) {
    historySearchContainer.classList.remove('open');
    historySearchInput.value = '';
    currentSearchQuery = '';
  }
});

function renderWhitelist(animateIndex = -1, fadeIndex = -1) {
  const filteredWhitelist = whitelist.filter((handle) =>
    handle.toLowerCase().includes(currentWhitelistSearchQuery),
  );

  if (filteredWhitelist.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = whitelist.length === 0 ? '暂无白名单用户' : '未找到匹配的白名单用户';
    whitelistList.replaceChildren(hint);
    whitelistCount.textContent = `(${whitelist.length})`;
    return;
  }

  whitelistCount.textContent = `(${whitelist.length})`;

  const nodes = filteredWhitelist.map((handle) => {
    const index = whitelist.indexOf(handle);
    const itemEl = document.createElement('span');
    itemEl.className =
      'keyword-tag' +
      (index === animateIndex ? ' fade-in-tag' : '') +
      (index === fadeIndex ? ' fade-in' : '');
    const textSpan = document.createElement('span');
    textSpan.className = 'tag-text';
    textSpan.textContent = `@${handle}`;

    const editBtn = document.createElement('button');
    editBtn.className = 'tag-btn tag-btn-edit';
    editBtn.title = '编辑';
    editBtn.innerHTML = ICON_EDIT;
    editBtn.onclick = () => startEditWhitelist(itemEl, handle);

    const delBtn = document.createElement('button');
    delBtn.className = 'tag-btn tag-btn-del';
    delBtn.title = '删除';
    delBtn.innerHTML = ICON_DEL;
    delBtn.onclick = () => {
      itemEl.classList.remove('fade-in-tag');
      itemEl.classList.add('fade-out-tag');
      const hToRemove = handle;
      setTimeout(async () => {
        whitelist = whitelist.filter((h) => h !== hToRemove);
        await chrome.storage.local.set({ whitelist });
        renderWhitelist();
      }, 200);
    };

    itemEl.append(textSpan, editBtn, delBtn);
    return itemEl;
  });

  whitelistList.replaceChildren(...nodes);
}

function startEditWhitelist(tagEl, oldHandle) {
  tagEl.innerHTML = '';
  tagEl.classList.add('is-editing');

  const input = document.createElement('input');
  input.className = 'tag-edit-input';
  input.value = oldHandle;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      confirmEditWhitelist(input, oldHandle);
    } else if (e.key === 'Escape') {
      renderWhitelist();
    }
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'tag-btn tag-btn-save';
  confirmBtn.innerHTML = ICON_CHECK;
  confirmBtn.title = '确认';
  confirmBtn.onclick = () => confirmEditWhitelist(input, oldHandle);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'tag-btn tag-btn-del';
  cancelBtn.innerHTML = ICON_DEL;
  cancelBtn.title = '取消';
  cancelBtn.onclick = () => renderWhitelist();

  tagEl.append(input, confirmBtn, cancelBtn);

  input.focus();
  input.select();
}

async function confirmEditWhitelist(inputEl, oldHandle) {
  const newVal = extractCleanScreenName(inputEl.value);
  if (!newVal) {
    showStatus('请输入有效的用户名');
    return;
  }

  const existingIndex = whitelist.indexOf(newVal);
  const oldIndex = whitelist.indexOf(oldHandle);

  if (existingIndex === -1 || existingIndex === oldIndex) {
    if (whitelist[oldIndex] !== newVal) {
      whitelist[oldIndex] = newVal;
      await chrome.storage.local.set({ whitelist });
      renderWhitelist();
    } else {
      renderWhitelist();
    }
  } else {
    showStatus('该用户已在白名单中');
    renderWhitelist();
  }
}

openWhitelistBtn.addEventListener('click', async () => {
  const items = await chrome.storage.local.get(getStorageDefaults('whitelist'));
  whitelist = items.whitelist ?? [];
  renderWhitelist();
  whitelistModal.classList.add('open');
});

closeWhitelistBtn.addEventListener('click', () => {
  whitelistModal.classList.remove('open');
  clearTimeout(whitelistSearchDebounceTimer);
  if (whitelistSearchContainer?.classList.contains('open')) {
    whitelistSearchContainer.classList.remove('open');
    whitelistSearchInput.value = '';
    currentWhitelistSearchQuery = '';
  }
});

addWhitelistBtn.addEventListener('click', async () => {
  const val = newWhitelistUser.value;
  const handle = extractCleanScreenName(val);
  if (!handle) {
    showStatus('请输入有效的用户名');
    return;
  }
  if (!whitelist.includes(handle)) {
    whitelist.push(handle);
    await chrome.storage.local.set({ whitelist });
    renderWhitelist(whitelist.length - 1);
    newWhitelistUser.value = '';
    whitelistList.scrollTop = whitelistList.scrollHeight;
  } else {
    showStatus('该用户已在白名单中');
  }
});

newWhitelistUser.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addWhitelistBtn.click();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.blockedCount) {
    blockedCountEl.textContent = changes.blockedCount.newValue || 0;
  }
  if (changes.blockedUsersOnX) {
    currentBlockedUsersOnX = changes.blockedUsersOnX.newValue ?? [];
    const screenNames = new Set(
      Iterator.from(document.querySelectorAll('button.btn-block-x')).map(
        (btn) => btn.dataset.screenName,
      ),
    );
    screenNames.forEach((name) => updateBlockBtns(name));
  }
  if (changes.blockedHistory && historyModal.classList.contains('open')) {
    const newHistory = changes.blockedHistory.newValue || [];
    const oldHistory = changes.blockedHistory.oldValue || [];
    const isNewItemAdded =
      newHistory.length > oldHistory.length ||
      (newHistory.length > 0 &&
        oldHistory.length > 0 &&
        newHistory.length === oldHistory.length &&
        newHistory[0].id !== oldHistory[0].id);

    if (isNewItemAdded) {
      currentHistory = newHistory;
      refreshHistoryDisplay();
    }
  }
});

async function refreshHistoryDisplay() {
  const prevScrollTop = historyList.scrollTop;
  const prevScrollHeight = historyList.scrollHeight;
  const prevRenderedCount = historyList.querySelectorAll('.history-item').length;
  const prevFilteredLength = filteredHistory.length;

  const oldReason = currentFilterReason;
  updateFilterOptions();
  if (oldReason !== currentFilterReason) {
    await chrome.storage.local.set({ historyFilterReason: currentFilterReason });
    applyHistoryFilter();
    return;
  }

  applyHistoryFilter();

  const addedCount = Math.max(0, filteredHistory.length - prevFilteredLength);
  const targetCount = Math.min(prevRenderedCount + addedCount, filteredHistory.length);
  while (historyNextIndex < targetCount) {
    renderHistoryPage();
  }

  const heightDiff = historyList.scrollHeight - prevScrollHeight;
  if (prevScrollTop === 0) {
    historyList.scrollTop = 0;
  } else {
    historyList.scrollTop = Math.max(0, prevScrollTop + heightDiff);
  }
}
