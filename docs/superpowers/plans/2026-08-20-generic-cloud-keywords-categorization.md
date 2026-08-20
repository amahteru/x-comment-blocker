# Generic Cloud Keywords Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a generic, dynamic cloud keyword categorization system supporting `# [CategoryName]` syntax in `keywords.txt`, dynamically rendering popup filter menus, dynamically filtering in content script, and fixing the hashtag parsing bug.

**Architecture:** 
- `utils.js` provides `isCategoryHeader`, `parseKeywords` (preserving hashtags), and dynamic `parseCategorizedKeywords` returning `{ [categoryName: string]: string[] }`.
- `popup.js` dynamically queries categories from `cloudKeywords` and renders dropdown filter options bound to `cloudCategoryToggles: { [categoryName: string]: boolean }`.
- `content.js` dynamically aggregates active categories from `cloudCategoryToggles` during `mergeKeywords()` and listens to storage changes.

**Tech Stack:** Vanilla JavaScript (ES Modules), Chrome Extension MV3, Node.js Test Runner (`node --test`), Biome linter.

## Global Constraints
- Target browsers: Chrome/Chromium 122+ (Manifest V3).
- Zero external build step or runtime dependencies.
- Retain exact styling, comment structure, and performance characteristics.
- Follow Biome rules for formatting and linting.

---

### Task 1: Core Parsing Engine & Storage Defaults (`utils.js` & `keywords.txt`)

**Files:**
- Modify: `utils.js`
- Modify: `keywords.txt`
- Create: `tests/utils.test.js`

**Interfaces:**
- Produces: `isCategoryHeader(line: string): boolean`
- Produces: `parseKeywords(text: string): string[]` (preserves `#hashtag`)
- Produces: `parseCategorizedKeywords(text: string): Record<string, string[]>`
- Produces: `STORAGE_DEFAULTS.cloudCategoryToggles = {}`

- [ ] **Step 1: Write unit tests in `tests/utils.test.js`**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCategoryHeader,
  parseKeywords,
  parseCategorizedKeywords,
  getStorageDefaults,
} from '../utils.js';

test('isCategoryHeader identifies category headers and rejects hashtags', () => {
  assert.equal(isCategoryHeader('# [常规屏蔽词]'), true);
  assert.equal(isCategoryHeader('# [用户名]'), true);
  assert.equal(isCategoryHeader('# [Custom Cat]'), true);
  assert.equal(isCategoryHeader('# 常规屏蔽词'), true);
  assert.equal(isCategoryHeader('# 用户名'), true);
  
  // Hashtags MUST NOT be treated as category headers
  assert.equal(isCategoryHeader('#兼职'), false);
  assert.equal(isCategoryHeader('#crypto'), false);
  assert.equal(isCategoryHeader('#airdrop'), false);
  assert.equal(isCategoryHeader('#100x'), false);
  assert.equal(isCategoryHeader(''), false);
});

test('parseKeywords preserves user hashtags while ignoring category headers', () => {
  const input = '# [常规屏蔽词]\n敏感词1\n#兼职\n#crypto\n# [用户名]\nbad_user';
  const parsed = parseKeywords(input);
  assert.deepEqual(parsed, ['敏感词1', '#兼职', '#crypto', 'bad_user']);
});

test('parseCategorizedKeywords dynamically parses multiple categories', () => {
  const input = `
前置词
# [常规屏蔽词]
词A
词B
# [用户名]
user_a
user_b
# [广告仿冒]
ad_keyword
`;
  const cat = parseCategorizedKeywords(input);
  assert.deepEqual(cat['常规屏蔽词'], ['前置词', '词a', '词b']);
  assert.deepEqual(cat['用户名'], ['user_a', 'user_b']);
  assert.deepEqual(cat['广告仿冒'], ['ad_keyword']);
});

test('STORAGE_DEFAULTS contains cloudCategoryToggles', () => {
  const defaults = getStorageDefaults('cloudCategoryToggles');
  assert.deepEqual(defaults.cloudCategoryToggles, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/utils.test.js`
Expected: FAIL with `isCategoryHeader is not defined` or assertion failures.

- [ ] **Step 3: Update `utils.js` and `keywords.txt`**

1. In `keywords.txt`:
   - Add `# [常规屏蔽词]` at the beginning (line 1).
   - Change `# 用户名` to `# [用户名]`.

2. In `utils.js`:
   - Export `isCategoryHeader(line)`:
     ```javascript
     const categoryHeaderRegex = /^#(?:\s*\[(?<bracketName>[^\]]+)\]|\s+(?<spaceName>\S+.*))$/v;

     export function isCategoryHeader(line) {
       if (typeof line !== 'string') return false;
       const cleaned = line.replaceAll(invisibleCharsRegex, '').trim();
       return categoryHeaderRegex.test(cleaned);
     }
     ```
   - Update `STORAGE_DEFAULTS`:
     ```javascript
     cloudCategoryToggles: {},
     ```
   - Update `parseKeywords`:
     ```javascript
     export function parseKeywords(text) {
       if (!text) return [];
       const result = [];
       for (const line of text.split('\n')) {
         const k = line.replaceAll(invisibleCharsRegex, '').trim();
         if (!k || isCategoryHeader(k)) continue;
         if (isKeywordRegex(k)) {
           result.push(k);
         } else {
           result.push(k.toLowerCase());
         }
       }
       return result;
     }
     ```
   - Update `parseCategorizedKeywords`:
     ```javascript
     export function parseCategorizedKeywords(text) {
       const result = {};
       if (!text) return result;
       let currentCategory = '常规屏蔽词';
       result[currentCategory] = [];

       for (const line of text.split('\n')) {
         const cleaned = line.replaceAll(invisibleCharsRegex, '').trim();
         if (!cleaned) continue;

         const headerMatch = categoryHeaderRegex.exec(cleaned);
         if (headerMatch) {
           const catName = (
             headerMatch.groups.bracketName || headerMatch.groups.spaceName || ''
           ).trim();
           if (catName) {
             currentCategory = catName;
             result[currentCategory] ??= [];
           }
           continue;
         }

         const item = isKeywordRegex(cleaned) ? cleaned : cleaned.toLowerCase();
         result[currentCategory].push(item);
       }

       if (result['常规屏蔽词'] && result['常规屏蔽词'].length === 0 && Object.keys(result).length > 1) {
         delete result['常规屏蔽词'];
       }

       return result;
     }
     ```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/utils.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils.js keywords.txt tests/utils.test.js
git commit -m "feat: implement generic category header parser and fix hashtag bug"
```

---

### Task 2: Dynamic Category Dropdown UI & Popup Logic (`popup.js`, `popup.html`, `popup.css`)

**Files:**
- Modify: `popup.js`
- Test: `tests/popup.test.js`

**Interfaces:**
- Consumes: `parseCategorizedKeywords`, `parseKeywords`, `getStorageDefaults` from `utils.js`
- Produces: Dynamic dropdown menu in `#cloudFilterDropdown`, handling `cloudCategoryToggles`.

- [ ] **Step 1: Write test in `tests/popup.test.js`**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCategorizedKeywords } from '../utils.js';

test('Dynamic category extraction and active list computation', () => {
  const rawText = '# [常规屏蔽词]\n敏感词1\n# [用户名]\nbad_user\n# [广告引流]\nad_user';
  const categorized = parseCategorizedKeywords(rawText);
  const categories = Object.keys(categorized);
  assert.deepEqual(categories, ['常规屏蔽词', '用户名', '广告引流']);

  // Toggle state
  const toggles = { '常规屏蔽词': true, '用户名': false, '广告引流': true };
  const activeList = [];
  for (const cat of categories) {
    if (toggles[cat] ?? true) {
      activeList.push(...(categorized[cat] ?? []));
    }
  }
  assert.deepEqual(activeList, ['敏感词1', 'ad_user']);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test tests/popup.test.js`
Expected: PASS

- [ ] **Step 3: Update `popup.js`**

1. Replace `let cloudCategoryKeywords = true; let cloudCategoryUsernames = true;` with `let cloudCategoryToggles = {};`.
2. Update `updateCloudInfo()`:
   ```javascript
   async function updateCloudInfo() {
     const items = await chrome.storage.local.get(
       getStorageDefaults(
         'cloudKeywords',
         'lastSyncTime',
         'syncStatus',
         'syncError',
         'cloudCategoryToggles',
       ),
     );
     const toggles = items.cloudCategoryToggles ?? {};
     const categorized = parseCategorizedKeywords(items.cloudKeywords ?? '');
     let count = 0;
     for (const [catName, list] of Object.entries(categorized)) {
       if (toggles[catName] ?? true) {
         count += list.length;
       }
     }
     const countText = count > 0 ? `${count} 个词` : '';
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
   ```
3. Update `updateCloudFilterDropdown(categorized)`:
   - Accept or retrieve `categorized` object.
   - For each `catName` in `Object.keys(categorized)`:
     - Create `.dropdown-option` with text `catName`.
     - Active if `cloudCategoryToggles[catName] ?? true`.
     - Onclick toggles `cloudCategoryToggles[catName] = !(cloudCategoryToggles[catName] ?? true)`, saves `{ cloudCategoryToggles }`, calls `renderCloudKeywords()` and `updateCloudInfo()`.
4. Update `renderCloudKeywords()`:
   - Load `cloudKeywords`, `disabledCloudKeywords`, `cloudCategoryToggles`.
   - Call `updateCloudFilterDropdown(categorized)`.
   - Combine active items across enabled categories.
   - If no category enabled: show `'未启用任何云端分类'`.
   - Apply search filter and render tags.
5. Update `selectAllCloudBtn`:
   - Combine items from enabled categories and apply search filter before batch setting autoblock.
6. Update `sanitizeImportedState()`:
   - Validate `cloudCategoryToggles` as an object of boolean values.
   - Backward-compatibility migration: if importing old state containing `cloudCategoryKeywords` or `cloudCategoryUsernames`, populate `cloudCategoryToggles`.
7. Update `autoSave()`:
   - Save `cloudCategoryToggles`.

- [ ] **Step 4: Verify popup with unit tests**

Run: `node --test tests/popup.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add popup.js tests/popup.test.js
git commit -m "feat: implement dynamic category dropdown filter in popup"
```

---

### Task 3: Content Script Engine Dynamic Category Filtering (`content.js`)

**Files:**
- Modify: `content.js`
- Create: `tests/integration.test.js`

**Interfaces:**
- Consumes: `cloudCategoryToggles`, `parseCategorizedKeywords` from `utils.js`

- [ ] **Step 1: Write integration test in `tests/integration.test.js`**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCategorizedKeywords } from '../utils.js';

test('mergeKeywords handles generic category toggles', () => {
  const rawText = '# [常规屏蔽词]\n敏感词1\n# [用户名]\nbad_user\n# [广告]\nad_spam';
  const categorized = parseCategorizedKeywords(rawText);

  function getActiveKeywords(toggles) {
    const active = [];
    for (const [catName, list] of Object.entries(categorized)) {
      if (toggles[catName] ?? true) {
        active.push(...list);
      }
    }
    return active;
  }

  // All enabled by default
  assert.deepEqual(getActiveKeywords({}), ['敏感词1', 'bad_user', 'ad_spam']);

  // Disable usernames and ads
  assert.deepEqual(getActiveKeywords({ '用户名': false, '广告': false }), ['敏感词1']);

  // Disable all
  assert.deepEqual(getActiveKeywords({ '常规屏蔽词': false, '用户名': false, '广告': false }), []);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test tests/integration.test.js`
Expected: PASS

- [ ] **Step 3: Update `content.js`**

1. In `mergeKeywords()`:
   - Retrieve `cloudCategoryToggles` from storage.
   - Parse `parseCategorizedKeywords(items.cloudKeywords ?? '')`.
   - Iterate entries `[catName, list]` and add `list` if `toggles[catName] ?? true`.
   - Exclude `disabledCloudKeywords`.
2. In `chrome.storage.onChanged`:
   - Watch for `changes.cloudCategoryToggles`.
   - Trigger `mergeKeywords()` and `scheduleFilter()`.

- [ ] **Step 4: Run integration test**

Run: `node --test tests/integration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add content.js tests/integration.test.js
git commit -m "feat: integrate generic category filtering in content script engine"
```

---

### Task 4: Full Code Verification & Formatting

**Files:**
- Modify: (all touched files)

- [ ] **Step 1: Run all unit and integration tests**

Run: `node --test tests/*.test.js`
Expected: All tests PASS.

- [ ] **Step 2: Run Biome check and write formatting**

Run: `npx @biomejs/biome check --write .`
Expected: Clean check, zero formatting/linting errors.

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "chore: verify tests and format codebase for generic categorization"
```
