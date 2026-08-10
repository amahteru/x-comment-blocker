# X(Twitter) Comment Blocker

用于自动屏蔽 X (Twitter) 评论区垃圾信息与引流机器人的浏览器插件，支持 Chrome、Edge 和 Firefox。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-FF7139?logo=firefoxbrowser&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gagacedifiphcndckimeihhcbcclkach.svg)](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)

## 功能

- **云端词库**：自动同步并定期更新公共垃圾屏蔽词库。
- **自定义词库**：支持手动添加、编辑屏蔽词，并提供本地文件的导入/导出功能。
- **高级过滤**：
  - 按用户名包含屏蔽词过滤。
  - 支持仅作用于推文评论区。
  - 按特殊字符或 emoji 过滤评论。
  - 支持屏蔽包含 Grok 分享卡片的评论。
- **白名单机制**：支持将特定用户添加至白名单，白名单用户的评论将永远不会被屏蔽。
- **全量数据备份**：支持一键备份或恢复扩展内的所有数据，包括设置开关、自定义词库、自动拉黑词、白名单及屏蔽历史记录。
- **快捷操作**：选中网页文本后，右键可将其快速加入自定义屏蔽词库。
- **拉黑功能**：
  - **手动拉黑**：在拦截历史记录中，可以将账号一键拉黑。
  - **批量拉黑**：在拦截历史记录中，可以将所有历史用户一键加入拉黑队列。
  - **自动拉黑**：可针对特定的屏蔽词（自定义或云端）开启自动拉黑，命中该词的评论作者将被自动拉黑。
- **数据与历史**：记录屏蔽数量，并可查看最近拦截的 10000 条评论。

## 安装

### 1. 从 Chrome 应用商店安装（适用于 Chrome，Edge 等基于 Chromium 的浏览器）

您可以在 Chrome 应用商店获取最新版本：
[X(Twitter) Comment Blocker - Chrome 应用商店](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)

### 2. 在 Firefox 中临时安装

需要 Firefox 142 或更高版本。

1. 下载或克隆本项目代码。
2. 打开 `about:debugging#/runtime/this-firefox`。
3. 点击 **临时载入附加组件**，选择项目目录中的 `manifest.json`。

临时安装会在 Firefox 退出后失效。长期安装需要使用经 Mozilla 签名的版本。

### 3. 在 Chromium 浏览器中手动安装

适用于基于 Chromium 的浏览器（如 Chrome, Edge）

1. 下载或克隆本项目代码。
2. 打开扩展程序页面：`chrome://extensions/` 或 `edge://extensions/`。
3. 开启页面右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择下载的 `x-comment-blocker` 文件夹。

### 4. 油猴脚本版本 (Tampermonkey / Greasemonkey)

轻量级的用户脚本版本，适用于移动端浏览器（如Safari、Via）或免扩展环境：

[X(Twitter) Comment Blocker Lite - GitHub](https://github.com/amahteru/x-comment-blocker-lite)

## 使用

- **全局控制**：点击扩展图标，通过右上角开关启用或关闭插件。
- **全量数据备份**：在面板底部点击对应图标，即可一键导出或导入扩展的所有配置及历史数据的 JSON 备份文件。
- **词库管理**：在弹窗界面中管理自定义词库，可添加、删除，或进行导入导出。
- **云端同步**：勾选“云端词库”开启自动更新，点击“同步”按钮可立即拉取最新列表。
- **白名单管理**：在“屏蔽历史”界面右上角点击白名单图标，可添加或移除免受屏蔽的用户。
- **自动拉黑配置**：在自定义词库或云端词库区域点击“编辑自动拉黑词”图标，可指定哪些词触发时直接拉黑该用户。
- **快速添加**：浏览网页时遇到需要屏蔽的词，直接选中并右键点击添加。
- **拦截记录与手动拉黑**：在弹窗统计区点击“查看”，可浏览最近的屏蔽记录。在记录中也可以手动将账号一键拉黑。

## 隐私

所有过滤规则与数据均在浏览器本地处理。不收集任何账号信息、浏览记录或自定义词库内容。
网络请求仅用于获取公开的云端词库，以及在您主动使用“拉黑”功能时调用 X 官方接口。

## 协议

本项目基于 [MIT License](./LICENSE) 协议开源。
