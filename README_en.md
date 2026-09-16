[中文](README.md) | **English**

# X(Twitter) Comment Blocker

A browser extension for automatically blocking spam and traffic-driving bots in X (Twitter) comment sections, supporting Chrome, Edge, and Firefox.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/addon/x-twitter-comment-blocker/)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gagacedifiphcndckimeihhcbcclkach.svg)](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)

## Features

- **Cloud Wordlist**: Automatically synchronizes and periodically updates the public spam blocking wordlist.
- **Custom Wordlist**: Supports manually adding and editing blocked keywords, as well as importing and exporting local files.
- **Advanced Filtering**:
  - Filter by username containing blocked keywords.
  - Option to apply filtering exclusively to tweet comment sections.
  - Filter comments by special characters or emojis.
  - Support blocking comments containing Grok share cards.
- **Whitelist Mechanism**: Supports adding specific users to a whitelist; comments from whitelisted users will never be blocked.
- **Full Data Backup**: One-click backup or restoration of all extension data, including settings toggles, custom wordlists, auto-block terms, whitelists, and block history.
- **Quick Action**: Select text on a web page and right-click to quickly add it to your custom blocklist.
- **Block Feature**:
  - **Manual Block**: Block accounts with one click directly from the interception history.
  - **Batch Block**: Add all historical users in the interception log to the block queue with one click.
  - **Auto Block**: Enable auto-block for specific keywords (custom or cloud); authors of comments matching these terms will be blocked automatically.
- **Stats & History**: Records the count of blocked comments and allows viewing the last 5,000 intercepted comments.

## Installation

### 1. Install from Chrome Web Store (For Chrome, Edge, and other Chromium-based browsers)

You can get the latest version from the Chrome Web Store:
[X(Twitter) Comment Blocker - Chrome Web Store](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)

### 2. Install from Firefox Add-ons (For Firefox Desktop and Android)

You can get the latest version from Firefox Add-ons:
[X(Twitter) Comment Blocker - Firefox Add-ons](https://addons.mozilla.org/addon/x-twitter-comment-blocker/)

### 3. Manual Installation in Chromium Browsers

For Chromium-based browsers (such as Chrome, Edge):

1. Download or clone this repository code.
2. Open the extension management page: `chrome://extensions/` or `edge://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the downloaded `x-comment-blocker` folder.

### 4. Userscript Version (Tampermonkey / Greasemonkey)

A lightweight userscript version suitable for mobile browsers (such as Safari, Via) or extension-free environments:
[X(Twitter) Comment Blocker Lite - GitHub](https://github.com/amahteru/x-comment-blocker-lite)

## Usage

- **Global Control**: Click the extension icon and use the toggle switch in the top-right corner to enable or disable the extension.
- **Full Data Backup**: Click the corresponding icon at the bottom of the panel to export or import a JSON backup file containing all configuration and history data.
- **Wordlist Management**: Manage custom wordlists in the popup interface, where you can add, delete, import, or export.
- **Cloud Sync**: Check "Cloud Wordlist" to enable auto-updates, or click the "Sync" button to immediately fetch the latest list.
- **Whitelist Management**: Click the whitelist icon in the upper-right corner of the "Block History" interface to add or remove whitelisted users.
- **Auto-Block Configuration**: Click the "Edit Auto-Block Words" icon in the custom or cloud wordlist area to specify which keywords immediately trigger account blocking.
- **Quick Add**: When encountering a word you want to block while browsing, select it and right-click to add it.
- **Interception Log & Manual Block**: Click "View" in the statistics area to browse recent block records. You can also manually block accounts with one click in the records.

## Privacy

All filtering rules and data are processed locally in the browser. No account information, browsing history, or custom wordlist contents are collected.
Network requests are only used to fetch the public cloud wordlist and to call official X APIs when you actively use the "Block" feature.

## License

This project is open-sourced under the [MIT License](./LICENSE).
