# 云端词库分类与筛选功能设计规范 (Design Spec)

## 1. 概述
当前插件的云端词库（`keywords.txt`）包含常规文本词、正则规则以及大量推特用户名（Screen Name / Handle）。为了让用户能够按需分类启用或停用云端词库中的特定类别，本设计在 `keywords.txt` 中提取并分类用户名，在云端词库弹窗中增加与“屏蔽历史”一致的过滤下拉菜单，支持独立控制“常规屏蔽词”与“用户名”两个分类的选取与生效。

---

## 2. 数据与解析设计 (Data & Parser)

### 2.1 `keywords.txt` 文件结构调整
- 将原位于 340~555 行的 216 个用户名（从 `aleksyl` 到 `riseoookk`）统一移动至文件最末尾。
- 在常规词与用户名之间插入分类标头 `# 用户名`。
- 首部常规词默认无需标头，或可选支持 `# 常规词`。

### 2.2 解析器升级 (`utils.js`)
- **`parseCategorizedKeywords(text)`**：
  - 按行解析字符串，自动去除不可见字符及首尾空白，跳过纯空白行。
  - 遇到 `# 用户名` 或包含“用户名”的注释行，将上下文状态切换为 `usernames`。
  - 遇到 `# 常规词` 或未指定标头时，默认为 `keywords` 分类。
  - 正则表达式保留原生格式，纯文本词条转为小写。
  - 返回数据结构：
    ```ts
    {
      keywords: string[],
      usernames: string[]
    }
    ```
- **`parseKeywords(text)`**：
  - 兼容保留，忽略所有以 `#` 开头的注释/标头行，返回所有有效词条的平铺数组。

### 2.3 存储与默认配置 (`chrome.storage.local`)
- 在 `STORAGE_DEFAULTS` 中新增配置项：
  - `cloudCategoryKeywords: true`（默认启用常规屏蔽词）
  - `cloudCategoryUsernames: true`（默认启用用户名分类）
- 在 `popup.js` 的 `sanitizeImportedState` 中添加上述字段的布尔值校验，确保备份恢复时数据完备。

---

## 3. UI 与交互设计 (Popup UI & Interactions)

### 3.1 弹窗头部过滤按钮 (`popup.html` & `popup.css`)
- 在 `#cloudModal` 头部操作区，在 `#editCloudAutoBlockBtn` 左侧新增：
  - 过滤按钮 `#filterCloudBtn`，使用与 `#filterHistoryBtn` 相同的 SVG 图标。
  - 下拉菜单 `#cloudFilterDropdown`，class 为 `dropdown-menu`。
- 样式复用现有 `.dropdown-menu` 及 `.dropdown-option`，高亮状态使用 `.active`。

### 3.2 下拉菜单交互 (`popup.js`)
- 点击 `#filterCloudBtn` 打开/关闭 `#cloudFilterDropdown`，点击菜单外部自动收起。
- 渲染两个选项：
  1. `常规屏蔽词`（当 `cloudCategoryKeywords === true` 时带有 `.active`）
  2. `用户名`（当 `cloudCategoryUsernames === true` 时带有 `.active`）
- 点击选项切换对应状态并自动持久化到 `chrome.storage.local`，同时调用 `renderCloudKeywords()` 刷新列表。

### 3.3 列表渲染与搜索 (`popup.js`)
- `renderCloudKeywords()` 根据当前选取的分类组合合并当前待展示的云端词条：
  - 仅选取常规词：仅展示常规屏蔽词
  - 仅选取用户名：仅展示用户名列表
  - 两者均选取：展示全部云端词条
  - 两者均未选取：列表展示为空提示（如“已停用所有云端分类”）
- 搜索功能在当前已选取的有效词条集合中进行过滤与高亮。
- 弹窗副标题（如 `(共 216 个词)`）根据当前有效词条总数动态更新。

---

## 4. 拦截与同步逻辑 (Content Script & Background)

### 4.1 评论区拦截生效 (`content.js`)
- `mergeKeywords()` 获取 `cloudCategoryKeywords` 与 `cloudCategoryUsernames`。
- 使用 `parseCategorizedKeywords(items.cloudKeywords)`：
  - 若 `cloudCategoryKeywords === true`，将常规词加入候选集合。
  - 若 `cloudCategoryUsernames === true`，将用户名加入候选集合。
  - 过滤掉 `disabledCloudKeywords` 中的单项禁用词条。
- 将过滤后的云端词条与自定义词库 `userKeywords` 合并构建 Trie / 正则表达式。
- 监听 `chrome.storage.onChanged`，当分类开关发生变化时，立即触发 `mergeKeywords()` 并重新过滤页面推文。

### 4.2 自动拉黑与单项禁用兼容
- 单项禁用（`disabledCloudKeywords`）和自动拉黑（`autoBlockKeywords`）均以词条值为 key，跨分类无缝兼容。

---

## 5. 测试与验证方案 (Verification Plan)
1. **词库解析测试**：
   - 验证 `keywords.txt` 中 216 个用户名是否全部位于 `# 用户名` 下方。
   - 验证 `parseCategorizedKeywords` 能否准确将文本拆分为常规词与用户名。
2. **UI 交互测试**：
   - 打开云端词库弹窗，点击过滤按钮，检查菜单是否正常展开与收起。
   - 切换“常规屏蔽词”和“用户名”，检查选项高亮状态及列表词条是否即时刷新。
   - 搜索词条，验证搜索只在当前启用的分类中生效。
3. **拦截效果测试**：
   - 仅启用“常规屏蔽词”：测试常规敏感词能够拦截，测试云端用户名不会被自动拦截。
   - 仅启用“用户名”：测试云端用户名匹配发帖人时能被正常拦截，常规词不生效。
   - 全部启用：两者均正常生效。
4. **持久化与全量备份测试**：
   - 刷新扩展后检查分类选取状态是否保留。
   - 导出与导入全量 JSON 备份，检查分类配置是否正确恢复。
