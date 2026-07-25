/* global parseKeywords, getStorageDefaults, SYNC_INTERVAL_MS */
let userKeywords = [];
let autoBlockKeywords = [];
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
const checkUsernameEl = document.getElementById('checkUsername');
const onlyCommentsEl = document.getElementById('onlyComments');
const blockSpecialCharsEl = document.getElementById('blockSpecialChars');
const blockEmojiEl = document.getElementById('blockEmoji');
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
    autoBlockKeywords,
    checkUsername: checkUsernameEl.checked,
    onlyComments: onlyCommentsEl.checked,
    blockSpecialChars: blockSpecialCharsEl.checked,
    blockEmoji: blockEmojiEl.checked,
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
    children.forEach((c) =>
      element.appendChild(typeof c === 'string' ? document.createTextNode(c) : c),
    );
  }
  return element;
}

function isKeywordRegex(kw) {
  return kw.length >= 3 && kw.startsWith('/') && /\/[a-zA-Z]*$/.test(kw);
}

addBtn.addEventListener('click', () => {
  addBtn.disabled = true;
  try {
    const rawValue = newKeywordInput.value.trim();
    if (!rawValue) {
      newKeywordInput.focus();
      return;
    }
    const kws = rawValue
      .split('\n')
      .map((k) => k.replace(invisibleCharsRegex, '').trim())
      .filter((k) => k);

    let addedCount = 0;
    for (const rawKw of kws) {
      const kw = isKeywordRegex(rawKw) ? rawKw : rawKw.toLowerCase();

      if (!userKeywords.includes(kw)) {
        userKeywords.push(kw);
        // Do not add to autoblock by default
        addedCount++;
      }
    }
    if (addedCount > 0) {
      newKeywordInput.value = '';
      renderUserKeywords(userKeywords.length - 1);
      autoSave();
    }
  } finally {
    addBtn.disabled = false;
  }
});

function renderUserKeywords(animateIndex = -1, fadeIndex = -1) {
  keywordList.innerHTML = '';

  if (userKeywords.length === 0) {
    keywordList.appendChild(
      el('div', { className: 'empty-hint', textContent: '暂无自定义屏蔽词' }),
    );
    document.querySelector('.keyword-stats').style.display = 'none';
    return;
  }

  document.querySelector('.keyword-stats').style.display = 'flex';

  const fragment = document.createDocumentFragment();

  userKeywords.forEach((kw, index) => {
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
          if (idx !== -1) userKeywords.splice(idx, 1);
          renderUserKeywords();
          autoSave();
        }, 200);
      },
    });

    const isRegex = isKeywordRegex(kw);
    const isAutoBlock = autoBlockKeywords.includes(kw);

    let tagChildren = [];
    if (isEditingAutoBlock) {
      const checkbox = el('input', {
        type: 'checkbox',
        className: 'tag-checkbox',
        checked: isAutoBlock,
        onchange: (e) => {
          if (e.target.checked) {
            if (!autoBlockKeywords.includes(kw)) autoBlockKeywords.push(kw);
          } else {
            autoBlockKeywords = autoBlockKeywords.filter((k) => k !== kw);
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
        className:
          'keyword-tag' +
          (isRegex ? ' regex-tag' : '') +
          (isAutoBlock && !isEditingAutoBlock ? ' is-autoblock' : '') +
          (index === animateIndex ? ' fade-in-tag' : '') +
          (index === fadeIndex ? ' fade-in' : ''),
      },
      tagChildren,
    );

    if (!isEditingAutoBlock) {
      editBtn.onclick = () => startEdit(tag, index);
    }
    fragment.appendChild(tag);
  });

  keywordList.appendChild(fragment);
  keywordCount.textContent = `共 ${userKeywords.length} 个自定义词`;
  autoBlockCount.textContent = autoBlockKeywords.length;
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

  tagEl.appendChild(input);
  tagEl.appendChild(confirmBtn);
  tagEl.appendChild(cancelBtn);

  input.focus();
  input.select();
}

function confirmEdit(inputEl, index) {
  const inputKws = parseKeywords(inputEl.value);
  let changed = false;
  if (inputKws.length > 0) {
    const newVal = inputKws[0];
    const existingIndex = userKeywords.indexOf(newVal);
    if (existingIndex === -1 || existingIndex === index) {
      if (userKeywords[index] !== newVal) {
        userKeywords[index] = newVal;
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

  const newKws = inputKws.filter((kw) => !userKeywords.includes(kw));

  newKeywordInput.value = '';
  newKeywordInput.focus();

  if (newKws.length === 0) {
    showStatus(isKeywordRegex(inputKws[0]) ? '该正则已存在' : '该屏蔽词已存在');
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
  a.download = `x-comment-blocker-keywords-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus('导出成功');
});

importBtn.addEventListener('click', () => {
  importFile.click();
});

importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    let newKeywords = [];

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        newKeywords = parseKeywords(parsed.map((k) => String(k)).join('\n'));
      }
    } catch {
      newKeywords = parseKeywords(content);
    }

    if (newKeywords.length > 0) {
      let addedCount = 0;
      newKeywords.forEach((kw) => {
        if (!userKeywords.includes(kw)) {
          userKeywords.push(kw);
          addedCount++;
        }
      });
      if (addedCount > 0) {
        renderUserKeywords();
        autoSave();
        showStatus(`成功导入 ${addedCount} 个新词`);
      } else {
        showStatus('未发现新词，词库已包含这些内容');
      }
    } else {
      showStatus('文件内容无效');
    }
  };
  reader.onerror = () => {
    showStatus('文件读取失败');
  };
  reader.readAsText(file);
  importFile.value = '';
});

function formatHistoryTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const isThisYear = date.getFullYear() === now.getFullYear();

  if (isToday) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } else if (isThisYear) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  } else {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return '刚刚同步';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前同步`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前同步`;
  return `${Math.floor(diff / 86400)}天前同步`;
}

function updateCloudInfo() {
  chrome.storage.local
    .get(getStorageDefaults('cloudKeywords', 'lastSyncTime', 'syncStatus', 'syncError'))
    .then((items) => {
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
    });
}

function renderCloudKeywords() {
  chrome.storage.local
    .get(getStorageDefaults('cloudKeywords', 'disabledCloudKeywords'))
    .then((items) => {
      let cloudList = parseKeywords(items.cloudKeywords);
      let disabledList = items.disabledCloudKeywords || [];

      if (currentCloudSearchQuery !== '') {
        cloudList = cloudList.filter((kw) => kw.toLowerCase().includes(currentCloudSearchQuery));
      }

      cloudKeywordList.innerHTML = '';

      if (cloudList.length === 0) {
        cloudKeywordList.appendChild(
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
      const fragment = document.createDocumentFragment();

      cloudList.forEach((kw) => {
        const isRegex = isKeywordRegex(kw);
        const textSpan = el('span', { className: 'tag-text', textContent: kw, title: kw });

        highlightText(textSpan, currentCloudSearchQuery);

        const isDisabled = disabledList.includes(kw);
        const isAutoBlock = autoBlockKeywords.includes(kw);

        let tagChildren = [];
        if (isEditingCloudAutoBlock) {
          const checkbox = el('input', {
            type: 'checkbox',
            className: 'tag-checkbox',
            checked: isAutoBlock,
            onchange: (e) => {
              if (e.target.checked) {
                if (!autoBlockKeywords.includes(kw)) autoBlockKeywords.push(kw);
              } else {
                autoBlockKeywords = autoBlockKeywords.filter((k) => k !== kw);
              }
            },
          });
          tagChildren = [textSpan, checkbox];
        } else {
          const banBtn = el('button', {
            className: 'tag-btn tag-btn-del',
            innerHTML: ICON_BAN,
            title: isDisabled ? '取消禁用' : '禁用',
            onclick: () => {
              if (isDisabled) {
                disabledList = disabledList.filter((k) => k !== kw);
              } else {
                disabledList.push(kw);
              }
              chrome.storage.local.set({ disabledCloudKeywords: disabledList });
              renderCloudKeywords();
            },
          });
          tagChildren = [textSpan, banBtn];
        }

        const tag = el(
          'span',
          {
            className:
              'keyword-tag' +
              (isRegex ? ' regex-tag' : '') +
              (isDisabled ? ' is-disabled' : '') +
              (isAutoBlock && !isEditingCloudAutoBlock ? ' is-autoblock' : ''),
            style: 'width: calc(50% - 5px);',
          },
          tagChildren,
        );
        fragment.appendChild(tag);
      });

      cloudKeywordList.appendChild(fragment);

      const savedScroll = localStorage.getItem('cloudScrollTop');
      if (!currentCloudSearchQuery && savedScroll) {
        cloudScrollContainer.scrollTop = Number(savedScroll);
      }
    });
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
    renderUserKeywords(); // update counts
  });
}

openCloudModalBtn.addEventListener('click', () => {
  renderCloudKeywords();
  cloudModal.classList.add('open');
});

closeCloudBtn.addEventListener('click', () => {
  cloudModal.classList.remove('open');
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
    if (!result || !result.success) {
      if (manual) showStatus('同步失败，请检查网络');
    } else {
      if (manual) showStatus('云端词库已同步');
      // Reload state after successful sync
      const items = await chrome.storage.local.get(['autoBlockKeywords']);
      if (items.autoBlockKeywords) {
        autoBlockKeywords = items.autoBlockKeywords;
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
    const startTime = parseInt(syncBtn.dataset.syncStartTime || Date.now());
    const elapsed = Date.now() - startTime;
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
cloudToggleEl.addEventListener('change', () => autoSave());

syncBtn.addEventListener('click', () => {
  syncBtn.dataset.syncStartTime = Date.now();
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
      'enabled',
      'cloudEnabled',
      'blockedCount',
      'lastSyncTime',
      'cloudKeywords',
      'whitelist'
    ),
  );

  whitelist = items.whitelist || [];

  userKeywords = parseKeywords(items.keywords);
  autoBlockKeywords = items.autoBlockKeywords || [];

  // Clean up autoBlockKeywords (remove words that are no longer in either list)
  const allValidKeywords = [...userKeywords, ...parseKeywords(items.cloudKeywords || '')];
  const originalAutoBlockLength = autoBlockKeywords.length;
  autoBlockKeywords = autoBlockKeywords.filter((kw) => allValidKeywords.includes(kw));
  if (originalAutoBlockLength !== autoBlockKeywords.length) {
    chrome.storage.local.set({ autoBlockKeywords });
  }

  checkUsernameEl.checked = items.checkUsername;
  onlyCommentsEl.checked = items.onlyComments;
  blockSpecialCharsEl.checked = items.blockSpecialChars;
  blockEmojiEl.checked = items.blockEmoji;
  enableToggleEl.checked = items.enabled;
  cloudToggleEl.checked = items.cloudEnabled;
  blockedCountEl.textContent = items.blockedCount || 0;

  updateEnabledState();
  renderUserKeywords();
  isLoading = false;
  updateCloudInfo();

  if (!items.lastSyncTime || Date.now() - items.lastSyncTime > SYNC_INTERVAL_MS) {
    syncBtn.dataset.syncStartTime = Date.now();
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
const toggleSearchBtn = document.getElementById('toggleSearchBtn');
const historySearchContainer = document.getElementById('historySearchContainer');
const historySearchInput = document.getElementById('historySearchInput');

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

if (filterHistoryBtn && filterDropdown) {
  filterHistoryBtn.addEventListener('click', () => {
    filterDropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#filterDropdown') && !e.target.closest('#filterHistoryBtn')) {
      filterDropdown.classList.remove('open');
    }
  });

  filterDropdown.addEventListener('click', (e) => {
    const option = e.target.closest('.filter-option');
    if (option) {
      const reason = option.dataset.reason;
      if (reason !== currentFilterReason) {
        filterDropdown
          .querySelectorAll('.filter-option')
          .forEach((opt) => opt.classList.remove('active'));
        option.classList.add('active');

        currentFilterReason = reason;
        chrome.storage.local.set({ historyFilterReason: reason });

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

  const reasons = Array.from(reasonsSet);
  // Sort so that '__blocked_on_x__' is always at a predictable position if desired, or just leave it at the end
  // Sort alphabetically but put __blocked_on_x__ at the top
  reasons.sort((a, b) => {
    if (a === '__blocked_on_x__') return -1;
    if (b === '__blocked_on_x__') return 1;
    return a.localeCompare(b);
  });

  if (currentFilterReason !== 'all' && !reasons.includes(currentFilterReason)) {
    currentFilterReason = 'all';
  }

  filterDropdown.innerHTML = '';

  const allOption = document.createElement('div');
  allOption.className = `filter-option ${currentFilterReason === 'all' ? 'active' : ''}`;
  allOption.dataset.reason = 'all';
  allOption.textContent = '全部原因';
  filterDropdown.appendChild(allOption);

  reasons.forEach((reason) => {
    const opt = document.createElement('div');
    opt.className = `filter-option ${currentFilterReason === reason ? 'active' : ''}`;
    opt.dataset.reason = reason;
    opt.textContent = reason === '__blocked_on_x__' ? '已拉黑' : reason;
    filterDropdown.appendChild(opt);
  });
}

function highlightText(element, query) {
  if (!query) return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const matches = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent;
    const lower = text.toLowerCase();
    let start = 0;
    let idx;
    while ((idx = lower.indexOf(query, start)) !== -1) {
      matches.push({ node, index: idx, length: query.length });
      start = idx + query.length;
    }
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    const { node, index, length } = matches[i];
    const after = node.splitText(index);
    after.splitText(length);
    const mark = document.createElement('mark');
    mark.className = 'search-highlight';
    mark.textContent = after.textContent;
    after.parentNode.replaceChild(mark, after);
  }
}

function applyHistoryFilter() {
  let filtered = currentHistory;

  if (currentFilterReason !== 'all') {
    if (currentFilterReason === '__blocked_on_x__') {
      filtered = filtered.filter((item) => {
        const screenName = extractCleanScreenName(item.user);
        return currentBlockedUsersOnX.includes(screenName);
      });
    } else {
      filtered = filtered.filter((item) => item.reason === currentFilterReason);
    }
  }

  if (currentSearchQuery !== '') {
    filtered = filtered.filter((item) => {
      const text = (item.text || '').toLowerCase();

      let user = (item.user || '').toLowerCase();
      if (user.startsWith('/')) {
        user = '@' + user.substring(1);
      }

      const displayName = (item.displayName || '').toLowerCase();
      return (
        text.includes(currentSearchQuery) ||
        user.includes(currentSearchQuery) ||
        displayName.includes(currentSearchQuery)
      );
    });
  }

  filteredHistory = filtered;

  historyNextIndex = 0;
  historyList.innerHTML = '';

  if (filteredHistory.length === 0) {
    historyList.innerHTML = `
      <div class="history-item">
          <div class="history-item-text" style="text-align: center; color: var(--text-muted); padding: 12px 0;">
              暂无记录
          </div>
      </div>
    `;
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
    const div = document.createElement('div');
    div.className = 'history-item';

    const header = document.createElement('div');
    header.className = 'history-item-header';

    const userInfo = document.createElement('div');
    userInfo.className = 'history-item-user-info';

    const handle = extractCleanScreenName(item.user);

    if (handle) {
      if (item.displayName) {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'history-display-name';
        nameSpan.textContent = item.displayName;
        nameSpan.title = item.displayName;
        highlightText(nameSpan, currentSearchQuery);

        const handleSpan = document.createElement('span');
        handleSpan.className = 'history-handle';
        handleSpan.textContent = `@${handle}`;
        highlightText(handleSpan, currentSearchQuery);

        userInfo.appendChild(nameSpan);
        userInfo.appendChild(handleSpan);
      } else {
        const userSpan = document.createElement('span');
        userSpan.className = 'history-handle';
        userSpan.textContent = `@${handle}`;
        highlightText(userSpan, currentSearchQuery);
        userInfo.appendChild(userSpan);
      }
    } else {
      const userSpan = document.createElement('span');
      userSpan.className = 'history-display-name';
      userSpan.textContent = item.user || '未知用户';
      highlightText(userSpan, currentSearchQuery);
      userInfo.appendChild(userSpan);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'history-item-actions';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'history-time';
    timeSpan.textContent = formatHistoryTime(item.time);
    actionsDiv.appendChild(timeSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-x';
    removeBtn.innerHTML = ICON_DEL;
    removeBtn.title = '从记录中移除此项';
    removeBtn.onclick = async () => {
      removeBtn.disabled = true;
      div.style.opacity = '0.5';
      await chrome.runtime
        .sendMessage({
          action: 'removeSpamRecord',
          id: item.id,
          time: item.time,
        })
        .catch(() => {});
      div.remove();

      currentHistory = currentHistory.filter((h) => !(h.id === item.id && h.time === item.time));
      filteredHistory = filteredHistory.filter((h) => !(h.id === item.id && h.time === item.time));

      const oldReason = currentFilterReason;
      updateFilterOptions();
      if (oldReason !== currentFilterReason) {
        chrome.storage.local.set({ historyFilterReason: currentFilterReason });
        applyHistoryFilter();
        return;
      }

      historyNextIndex = Math.max(0, historyNextIndex - 1);
      if (filteredHistory.length === 0) {
        historyList.innerHTML = `
            <div class="history-item">
                <div class="history-item-text" style="text-align: center; color: var(--text-muted); padding: 12px 0;">
                    暂无记录
                </div>
            </div>
        `;
      } else if (historyList.querySelectorAll('.history-item').length === 0) {
        renderHistoryPage();
      }
    };
    actionsDiv.appendChild(removeBtn);

    if (handle) {
      const blockBtn = document.createElement('button');
      blockBtn.className = 'btn-block-x';

      const screenName = handle;
      blockBtn.dataset.screenName = screenName;

      const updateBtnState = () => {
        const isBlocked = currentBlockedUsersOnX.includes(screenName);
        if (isBlocked) {
          blockBtn.textContent = '已拉黑';
          blockBtn.classList.add('success');
          blockBtn.title = '点击解除拉黑';
        } else {
          blockBtn.textContent = '拉黑';
          blockBtn.classList.remove('success');
          blockBtn.title = '在 X 上拉黑该账号';
        }
      };
      updateBtnState();

      blockBtn.onclick = async () => {
        const isCurrentlyBlocked = currentBlockedUsersOnX.includes(screenName);

        document
          .querySelectorAll(`button.btn-block-x[data-screen-name="${screenName}"]`)
          .forEach((btn) => {
            btn.disabled = true;
            btn.textContent = '请求中...';
          });

        try {
          const action = isCurrentlyBlocked ? 'unblockUserOnX' : 'blockUserOnX';
          const res = await chrome.runtime.sendMessage({ action, screenName });
          if (res && res.success) {
            const currentItems = await chrome.storage.local.get(
              getStorageDefaults('blockedUsersOnX'),
            );
            let currentList = currentItems.blockedUsersOnX || [];

            if (!isCurrentlyBlocked) {
              if (!currentList.includes(screenName)) currentList.push(screenName);
            } else {
              currentList = currentList.filter((u) => u !== screenName);
            }

            await chrome.storage.local.set({ blockedUsersOnX: currentList });
            currentBlockedUsersOnX = currentList;

            document
              .querySelectorAll(`button.btn-block-x[data-screen-name="${screenName}"]`)
              .forEach((btn) => {
                const isNowBlocked = currentBlockedUsersOnX.includes(screenName);
                if (isNowBlocked) {
                  btn.textContent = '已拉黑';
                  btn.classList.add('success');
                  btn.title = '点击解除拉黑';
                } else {
                  btn.textContent = '拉黑';
                  btn.classList.remove('success');
                  btn.title = '在 X 上拉黑该账号';
                }
                btn.disabled = false;
              });
          } else {
            document
              .querySelectorAll(`button.btn-block-x[data-screen-name="${screenName}"]`)
              .forEach((btn) => {
                btn.disabled = false;
                const isBlocked = currentBlockedUsersOnX.includes(screenName);
                btn.textContent = isBlocked ? '已拉黑' : '拉黑';
              });
            showStatus(res?.reason || '操作失败');
          }
        } catch {
          document
            .querySelectorAll(`button.btn-block-x[data-screen-name="${screenName}"]`)
            .forEach((btn) => {
              btn.disabled = false;
              const isBlocked = currentBlockedUsersOnX.includes(screenName);
              btn.textContent = isBlocked ? '已拉黑' : '拉黑';
            });
          showStatus('请求失败');
        }
      };
      actionsDiv.appendChild(blockBtn);
    }

    header.appendChild(userInfo);
    header.appendChild(actionsDiv);

    let displayText = item.text || '[无内容或已隐藏]';
    if (item.reason) {
      displayText = `[${item.reason}] ${displayText}`;
    }

    const textDiv = document.createElement('div');
    textDiv.className = 'history-item-text';
    textDiv.textContent = displayText;
    highlightText(textDiv, currentSearchQuery);

    div.appendChild(header);
    div.appendChild(textDiv);
    fragment.appendChild(div);
  }
  historyList.appendChild(fragment);

  const nameSpans = Array.from(historyList.querySelectorAll('.history-display-name'));
  const overflowingSpans = nameSpans.filter((span) => span.scrollWidth > span.clientWidth);
  overflowingSpans.forEach((span) => span.classList.add('is-overflowing'));

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
  historyList.innerHTML = `
        <div class="history-item">
            <div class="history-item-text" style="text-align: center; color: var(--text-muted); padding: 12px 0;">
                加载中...
            </div>
        </div>
    `;

  const items = await chrome.storage.local.get(
    getStorageDefaults('blockedHistory', 'blockedUsersOnX', 'historyFilterReason'),
  );
  currentHistory = items.blockedHistory || [];
  currentBlockedUsersOnX = items.blockedUsersOnX || [];

  const oldReason = items.historyFilterReason || 'all';
  currentFilterReason = oldReason;
  updateFilterOptions();

  if (currentFilterReason !== oldReason) {
    chrome.storage.local.set({ historyFilterReason: currentFilterReason });
  }

  applyHistoryFilter();
});

closeHistoryBtn.addEventListener('click', () => {
  historyModal.classList.remove('open');
  clearTimeout(searchDebounceTimer);
  if (historySearchContainer && historySearchContainer.classList.contains('open')) {
    historySearchContainer.classList.remove('open');
    historySearchInput.value = '';
    currentSearchQuery = '';
  }
});

function renderWhitelist() {
  whitelistList.innerHTML = '';
  if (whitelist.length === 0) {
    whitelistList.innerHTML = '<div class="empty-hint">暂无白名单用户</div>';
    whitelistCount.textContent = '(0)';
    return;
  }
  
  whitelistCount.textContent = `(${whitelist.length})`;
  
  whitelist.forEach((handle) => {
    const itemEl = document.createElement('span');
    itemEl.className = 'keyword-tag';
    
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
      whitelist = whitelist.filter(h => h !== handle);
      chrome.storage.local.set({ whitelist }, () => {
        renderWhitelist();
      });
    };
    
    itemEl.appendChild(textSpan);
    itemEl.appendChild(editBtn);
    itemEl.appendChild(delBtn);
    whitelistList.appendChild(itemEl);
  });
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

  tagEl.appendChild(input);
  tagEl.appendChild(confirmBtn);
  tagEl.appendChild(cancelBtn);

  input.focus();
  input.select();
}

function confirmEditWhitelist(inputEl, oldHandle) {
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
      chrome.storage.local.set({ whitelist }, () => {
        renderWhitelist();
      });
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
  whitelist = items.whitelist || [];
  renderWhitelist();
  whitelistModal.classList.add('open');
});

closeWhitelistBtn.addEventListener('click', () => {
  whitelistModal.classList.remove('open');
});

addWhitelistBtn.addEventListener('click', () => {
  const val = newWhitelistUser.value;
  const handle = extractCleanScreenName(val);
  if (!handle) {
    showStatus('请输入有效的用户名');
    return;
  }
  if (!whitelist.includes(handle)) {
    whitelist.unshift(handle);
    chrome.storage.local.set({ whitelist }, () => {
      renderWhitelist();
      newWhitelistUser.value = '';
    });
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
    currentBlockedUsersOnX = changes.blockedUsersOnX.newValue || [];
    document.querySelectorAll('button.btn-block-x').forEach((btn) => {
      const screenName = btn.dataset.screenName;
      const isBlocked = currentBlockedUsersOnX.includes(screenName);
      if (isBlocked) {
        btn.textContent = '已拉黑';
        btn.classList.add('success');
        btn.title = '点击解除拉黑';
      } else {
        btn.textContent = '拉黑';
        btn.classList.remove('success');
        btn.title = '在 X 上拉黑该账号';
      }
    });
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

function refreshHistoryDisplay() {
  const prevScrollTop = historyList.scrollTop;
  const prevScrollHeight = historyList.scrollHeight;
  const prevRenderedCount = historyList.querySelectorAll('.history-item').length;
  const prevFilteredLength = filteredHistory.length;

  const oldReason = currentFilterReason;
  updateFilterOptions();
  if (oldReason !== currentFilterReason) {
    chrome.storage.local.set({ historyFilterReason: currentFilterReason });
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
