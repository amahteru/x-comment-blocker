# 云端词库分类与筛选功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构云端词库数据结构，将推特用户名从常规词库中分离到底部并添加分类标头；在云端词库弹窗中新增与历史记录一致的过滤按钮与下拉菜单，支持独立选取与启用“常规屏蔽词”和“用户名”分类，并在评论区拦截中即时生效。

**Architecture:** 
- 在 `keywords.txt` 中使用 `# 用户名` 标头将 216 个推特用户名移至末尾，`utils.js` 提供 `parseCategorizedKeywords` 分类解析与存储默认值。
- 在 `popup.html`/`popup.css`/`popup.js` 中新增 `#filterCloudBtn` 与 `#cloudFilterDropdown`，通过勾选状态独立控制分类开关与列表展示。
- 在 `content.js` 的 `mergeKeywords` 中根据启用的分类组合合并规则并注入评论区屏蔽引擎。

**Tech Stack:** JavaScript (ESM, Chrome Extension MV3), CSS3, Node.js `node:test` (单元测试), Biome (代码校验与格式化).

## Global Constraints
- 遵循 Chrome Extension MV3 规范与现有代码风格，使用原生 JavaScript (ESM)。
- 保持与现有“屏蔽历史”过滤菜单视觉风格（`.dropdown-menu`, `.dropdown-option`, `.active`）完全一致。
- 确保全量导出/导入备份功能对新增分类配置的兼容性。

---

### Task 1: Reorganize `keywords.txt` & Implement Categorized Parsing in `utils.js`

**Files:**
- Modify: `keywords.txt`
- Modify: `utils.js`
- Test: `tests/utils.test.js`

**Interfaces:**
- Produces: `parseCategorizedKeywords(text: string): { keywords: string[], usernames: string[] }`
- Produces: `STORAGE_DEFAULTS.cloudCategoryKeywords: true`, `STORAGE_DEFAULTS.cloudCategoryUsernames: true`

- [ ] **Step 1: Write the failing unit tests for parser and categorized keywords**

```javascript
// tests/utils.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKeywords, parseCategorizedKeywords, getStorageDefaults } from '../utils.js';

test('parseKeywords skips comment lines starting with #', () => {
  const sample = '词条1\n# 这是注释\n词条2\n# 用户名\naleksyl';
  const result = parseKeywords(sample);
  assert.deepEqual(result, ['词条1', '词条2', 'aleksyl']);
});

test('parseCategorizedKeywords correctly separates keywords and usernames', () => {
  const sample = `
    词条A
    /正则B/i
    # 用户名
    aleksyl
    riseoookk
  `;
  const result = parseCategorizedKeywords(sample);
  assert.deepEqual(result.keywords, ['词条a', '/正则B/i']);
  assert.deepEqual(result.usernames, ['aleksyl', 'riseoookk']);
});

test('getStorageDefaults contains cloudCategoryKeywords and cloudCategoryUsernames', () => {
  const defaults = getStorageDefaults('cloudCategoryKeywords', 'cloudCategoryUsernames');
  assert.equal(defaults.cloudCategoryKeywords, true);
  assert.equal(defaults.cloudCategoryUsernames, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/utils.test.js`
Expected: FAIL with `parseCategorizedKeywords is not a function`

- [ ] **Step 3: Update `keywords.txt` and implement `parseCategorizedKeywords` in `utils.js`**

1. Move the 216 usernames from line 340 (`aleksyl`) to line 555 (`riseoookk`) to the bottom of `keywords.txt`, preceded by `# 用户名`.
2. In `utils.js`:
   - Update `parseKeywords(text)` to skip lines starting with `#`.
   - Implement `export function parseCategorizedKeywords(text)`:
     ```javascript
     export function parseCategorizedKeywords(text) {
       const result = { keywords: [], usernames: [] };
       if (!text) return result;
       let currentCategory = 'keywords';
       for (const line of text.split('\n')) {
         const cleaned = line.replaceAll(invisibleCharsRegex, '').trim();
         if (!cleaned) continue;
         if (cleaned.startsWith('#')) {
           if (cleaned.includes('用户名')) {
             currentCategory = 'usernames';
           } else if (cleaned.includes('常规') || cleaned.includes('默认')) {
             currentCategory = 'keywords';
           }
           continue;
         }
         const item = isKeywordRegex(cleaned) ? cleaned : cleaned.toLowerCase();
         if (currentCategory === 'usernames') {
           result.usernames.push(item);
         } else {
           result.keywords.push(item);
         }
       }
       return result;
     }
     ```
   - Update `STORAGE_DEFAULTS`:
     ```javascript
     cloudCategoryKeywords: true,
     cloudCategoryUsernames: true,
     ```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/utils.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add keywords.txt utils.js tests/utils.test.js
git commit -m "feat: add categorized keywords parsing and separate usernames in keywords.txt"
```

---

### Task 2: Cloud Modal Filter UI & Dropdown in `popup.html`, `popup.css`, and `popup.js`

**Files:**
- Modify: `popup.html`
- Modify: `popup.css`
- Modify: `popup.js`

**Interfaces:**
- Consumes: `parseCategorizedKeywords`, `getStorageDefaults` from `utils.js`
- Produces: `#filterCloudBtn`, `#cloudFilterDropdown` DOM elements and category toggle logic

- [ ] **Step 1: Update `popup.html` with filter button and dropdown menu**

In `popup.html` inside `#cloudModal` header actions, to the left of `#editCloudAutoBlockBtn`:
```html
<button type="button" class="icon-btn" id="filterCloudBtn" title="过滤词库分类">
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="21" y1="4" x2="14" y2="4"></line>
    <line x1="10" y1="4" x2="3" y2="4"></line>
    <line x1="21" y1="12" x2="12" y2="12"></line>
    <line x1="8" y1="12" x2="3" y2="12"></line>
    <line x1="21" y1="20" x2="16" y2="20"></line>
    <line x1="12" y1="20" x2="3" y2="20"></line>
    <line x1="14" y1="2" x2="14" y2="6"></line>
    <line x1="8" y1="10" x2="8" y2="14"></line>
    <line x1="16" y1="18" x2="16" y2="22"></line>
  </svg>
</button>
<div class="dropdown-menu" id="cloudFilterDropdown" style="right: 88px;"></div>
```

- [ ] **Step 2: Update `popup.js` to handle cloud category toggles, dropdown menu, and list filtering**

1. Import `parseCategorizedKeywords` from `./utils.js`.
2. Add variables `cloudCategoryKeywords = true`, `cloudCategoryUsernames = true`.
3. Load states in `DOMContentLoaded`:
   ```javascript
   cloudCategoryKeywords = items.cloudCategoryKeywords ?? true;
   cloudCategoryUsernames = items.cloudCategoryUsernames ?? true;
   ```
4. Bind `#filterCloudBtn` and `#cloudFilterDropdown`:
   - Toggle open class on button click.
   - Render options:
     - `常规屏蔽词` (`cloudCategoryKeywords` 为 true 时添加 `active` 类)
     - `用户名` (`cloudCategoryUsernames` 为 true 时添加 `active` 类)
   - Click handler on options toggles the boolean, saves to `chrome.storage.local`, and calls `renderCloudKeywords()`.
   - Global click listener closes `#cloudFilterDropdown` when clicking outside.
5. In `renderCloudKeywords()`:
   - Call `parseCategorizedKeywords(items.cloudKeywords)`.
   - Combine active lists:
     ```javascript
     let activeList = [];
     if (cloudCategoryKeywords) activeList.push(...categorized.keywords);
     if (cloudCategoryUsernames) activeList.push(...categorized.usernames);
     ```
   - Filter `activeList` by `currentCloudSearchQuery`.
   - If `activeList.length === 0`: display empty hint (e.g. `!cloudCategoryKeywords && !cloudCategoryUsernames ? '未启用任何云端分类' : (currentCloudSearchQuery ? '没有找到匹配的屏蔽词' : '暂无云端屏蔽词')`).
   - Render tags for `activeList`.
6. Update `selectAllCloudBtn` to toggle auto-block for current `activeList`.
7. Update `sanitizeImportedState` to validate `cloudCategoryKeywords` and `cloudCategoryUsernames`.

- [ ] **Step 3: Test popup logic and interactions**

Run: `node --test tests/utils.test.js`
Check syntax and formatting with `npx @biomejs/biome check popup.js popup.html popup.css`

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "feat: add cloud keyword category filter dropdown and UI interactions"
```

---

### Task 3: Content Script & Background Sync Integration

**Files:**
- Modify: `content.js`
- Modify: `background.js`
- Test: `tests/integration.test.js`

**Interfaces:**
- Consumes: `cloudCategoryKeywords`, `cloudCategoryUsernames`, `parseCategorizedKeywords` in `content.js`

- [ ] **Step 1: Write integration unit test for content script keyword assembly**

```javascript
// tests/integration.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCategorizedKeywords } from '../utils.js';

test('mergeKeywords logic respects category toggles', () => {
  const rawCloud = '敏感词1\n# 用户名\nbad_user';
  const categorized = parseCategorizedKeywords(rawCloud);
  
  // Both enabled
  let enabledList = [...categorized.keywords, ...categorized.usernames];
  assert.deepEqual(enabledList, ['敏感词1', 'bad_user']);

  // Only keywords enabled
  enabledList = [...categorized.keywords];
  assert.deepEqual(enabledList, ['敏感词1']);

  // Only usernames enabled
  enabledList = [...categorized.usernames];
  assert.deepEqual(enabledList, ['bad_user']);
});
```

- [ ] **Step 2: Update `content.js`**

1. In `content.js`, import `parseCategorizedKeywords`.
2. In `mergeKeywords()`:
   - Retrieve `cloudCategoryKeywords` and `cloudCategoryUsernames` from `chrome.storage.local`.
   - Parse cloud keywords with `parseCategorizedKeywords(items.cloudKeywords)`.
   - Filter active cloud keywords:
     ```javascript
     const activeCloudKws = [];
     if (items.cloudCategoryKeywords ?? true) activeCloudKws.push(...categorized.keywords);
     if (items.cloudCategoryUsernames ?? true) activeCloudKws.push(...categorized.usernames);
     ```
   - Subtract `disabledCloudKeywords` from `activeCloudKws`.
3. In `chrome.storage.onChanged` listener:
   - Check `changes.cloudCategoryKeywords` and `changes.cloudCategoryUsernames`.
   - Trigger `mergeKeywords()` and `scheduleFilter()`.

- [ ] **Step 3: Run integration test**

Run: `node --test tests/integration.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add content.js background.js tests/integration.test.js
git commit -m "feat: integrate cloud category filters into content script blocking engine"
```

---

### Task 4: Full Code Verification & Formatting

**Files:**
- Modify: (all touched files)

- [ ] **Step 1: Run all unit & integration tests**

Run: `node --test tests/*.test.js`
Expected: All tests PASS.

- [ ] **Step 2: Run Biome linter and formatter**

Run: `npx @biomejs/biome check --write .`
Expected: All checks pass without errors.

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "chore: format and lint codebase for cloud keyword category filtering"
```
