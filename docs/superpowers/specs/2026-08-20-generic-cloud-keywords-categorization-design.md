# Generic Cloud Keywords Categorization Design Spec

## Overview
This design replaces the hardcoded two-category cloud keyword parsing mechanism with a generic, extensible category marker system (`# [分类名]` or `# 分类名`). It completely fixes the hashtag parsing bug (where `#hashtag` keywords were silently dropped) and allows arbitrary categories in `keywords.txt` without needing code changes in the frontend or content script engines.

## 1. Syntax & File Format Specification (`keywords.txt`)

- **Category Header Format**: `# [CategoryName]` or `# CategoryName` (lines matching `/^#(?:\s*\[(?<bracketName>[^\]]+)\]|\s+(?<spaceName>\S+.*))$/`).
- **Initial Fallback Category**: Any lines preceding the first category header are assigned to `'常规屏蔽词'`.
- **Hashtag Distinction**: Regular Twitter hashtags (e.g. `#兼职`, `#crypto`, `#airdrop`) do not have square brackets or whitespace after `#`, and are treated as standard keywords, NOT category headers.

Example `keywords.txt`:
```text
# [常规屏蔽词]
万达广场
无偿
/(?:找|寻|求|有没有).{0,2}单男/

# [用户名]
aleksyl
xyiixl

# [政治引战]
...
```

## 2. Parsing Engine (`utils.js`)

### `isCategoryHeader(line: string): boolean`
Returns `true` if `line` is formatted as `# [name]` or `# name`.

### `parseKeywords(text: string): string[]`
Iterates lines in `text`:
- Trims invisible characters and whitespace.
- Skips empty lines.
- Skips lines where `isCategoryHeader(line)` is `true`.
- Converts plain text to lowercase, preserves regex (`isKeywordRegex`).
- Preserves hashtags like `#兼职`, `#crypto`.

### `parseCategorizedKeywords(text: string): Record<string, string[]>`
- Tracks `currentCategory = '常规屏蔽词'`.
- When an `isCategoryHeader(line)` is encountered:
  - Extracts the category name (stripping brackets and extra whitespace).
  - Switches `currentCategory` to this name.
  - Ensures `result[currentCategory]` array exists.
- Pushes normalized keywords / regex patterns into `result[currentCategory]`.
- Returns an object mapping each category name to its array of keywords.

## 3. Storage Model & Defaults (`utils.js`)

- `STORAGE_DEFAULTS`:
  - `cloudCategoryToggles: {}` (Object mapping category name -> boolean).
  - Backward compatibility: If `cloudCategoryKeywords` or `cloudCategoryUsernames` exists in storage from older versions, migrate them to `cloudCategoryToggles['常规屏蔽词']` and `cloudCategoryToggles['用户名']`.
  - Default status: If `cloudCategoryToggles[categoryName]` is `undefined`, it evaluates to `true` (`toggles[catName] ?? true`).

## 4. UI & Popup Logic (`popup.js`, `popup.html`, `popup.css`)

### Dynamic Dropdown Rendering (`updateCloudFilterDropdown`)
- Retrieves `categorized = parseCategorizedKeywords(items.cloudKeywords)`.
- Gets all unique category names `Object.keys(categorized)`. If none, defaults to `['常规屏蔽词']`.
- Populates `#cloudFilterDropdown` with `.dropdown-option` elements for each category.
- `.active` class applied if `cloudCategoryToggles[catName] ?? true` is `true`.
- Clicking an option:
  - Toggles `cloudCategoryToggles[catName]`.
  - Updates `chrome.storage.local`.
  - Re-renders cloud keywords list and cloud info count.

### List Rendering & Auto-Block Batch Selection
- `renderCloudKeywords()`:
  - Collects all keywords from categories where `cloudCategoryToggles[catName] ?? true` is `true`.
  - If all categories are toggled off: shows empty hint `"未启用任何云端分类"`.
  - Filters by `currentCloudSearchQuery` if search is active.
  - Renders tag list.
- `updateCloudInfo()`:
  - Calculates total count of keywords across enabled categories.
- `selectAllCloudBtn`:
  - Batch toggles auto-block state for visible items from enabled categories.

## 5. Content Script Engine Integration (`content.js`)

- `mergeKeywords()`:
  - Reads `cloudCategoryToggles` and `cloudKeywords`.
  - Parses `parseCategorizedKeywords(items.cloudKeywords)`.
  - Aggregates keywords from all enabled categories (`cloudCategoryToggles[catName] ?? true`).
  - Subtracts `disabledCloudKeywords`.
  - Combines with `userKeywords`.
  - Builds Trie regex and custom regexes.
- `chrome.storage.onChanged`:
  - Listens to `changes.cloudCategoryToggles`.
  - Automatically invokes `mergeKeywords()` and schedules a re-filter on the active tab.

## 6. Verification & Test Plan

1. **Unit Tests (`tests/utils.test.js`)**:
   - Test category header detection (`# [常规屏蔽词]`, `# 用户名`, `# [Custom Cat]`, `#tag`, `#crypto`).
   - Test `parseKeywords` preserves `#hashtags` while ignoring category headers.
   - Test `parseCategorizedKeywords` dynamically returns all declared categories.
   - Test backward compatibility and defaults.
2. **Integration Tests (`tests/integration.test.js`)**:
   - Test `content.js` `mergeKeywords()` with dynamic category toggles.
   - Test category toggle changes triggering storage events and engine updates.
3. **Popup Simulation Tests (`tests/popup.test.js`)**:
   - Test dynamic dropdown rendering with arbitrary categories.
   - Test toggle clicks, auto-block selection, search filtering, and count display.
4. **Code Quality**:
   - Run Biome check and format.
