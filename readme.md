# koishi-plugin-ehentai-downloader

[![npm](https://img.shields.io/npm/v/koishi-plugin-ehentai-downloader?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-ehentai-downloader)

在 Koishi 中搜索、预览并下载 E-Hentai / ExHentai 画廊，输出 PDF、ZIP 或逐张图片。搜索结果渲染成图片菜单，回复序号即可下载。

## 安装

```shell
npm install koishi-plugin-ehentai-downloader
```

表站凭据可选，访问里站需要填写 Cookie。

## 指令

| 指令 | 别名 | 说明 |
| --- | --- | --- |
| `eh.search` | `eh搜索` | 搜索画廊，`-c` 分类、`-l` 语言、`-n` 条数、`--grid` 缩略图菜单、`--text` 文字列表 |
| `eh.download` | `eh下载` | 下载画廊，`-p` PDF、`-z` ZIP、`-i` 图片、`-k` 密码、`-r` 页码、`-q` 质量 |
| `eh.info` | `eh详情` | 查看画廊详情 |
| `eh.toplist` | `eh排行` | 榜单，`all-time` / `past-year` / `past-month` / `yesterday`，`-p` 页码 |
| `eh.popular` | `eh热门` | 当前热门 |
| `eh.cancel` | `eh取消` | 取消进行中的下载 |
| `eh.retry` | `eh重试` | 补下最近一次失败的页 |

```text
eh.search master tigress -n 9
eh.download 4280941 -p -k 1234
eh.download https://e-hentai.org/g/4280941/11f8979b01/ -z -r 1-20
```

菜单里回序号下载，`F` / `B` 翻页，`N` 退出；也可以写 `下一页`、`上一页`、`退出`。

## 配置

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `site` | `auto` | `auto` / `exhentai` / `e-hentai`，自动优先里站 |
| `menuStyle` | `card` | `card` 扩展型 / `grid` 三列缩略图 / `text` 文字列表 |
| `searchLanguage` | `all` | 默认语言筛选，`-l` 可覆盖 |
| `searchResultLimit` | `9` | 每次展示条数 |
| `imageQuality` | `resized` | `resized` 页面缩放版 / `original` 原图，`-q` 可覆盖 |
| `downloadConcurrency` | `6` | 同时下载的页数 |
| `maxPages` | `300` | 单次页数上限，`0` 不限制 |
| `defaultFormat` | `pdf` | `pdf` / `zip` / `img`，`-p` / `-z` / `-i` 可覆盖 |
| `defaultPassword` | 空 | PDF / ZIP 密码，`-k` 可覆盖 |
| `downloadPath` | `./data/temp/ehentai-downloader` | 输出目录，相对路径基于 `baseDir` |
| `ehentaiMemberId` 等五项 | 空 | 站点 Cookie，见下 |
| `enableLinkRecognition` | `false` | 识别消息里的画廊链接并自动下载 |
| `debug` | `false` | 输出请求与解析日志 |

账号填 `ehentaiMemberId`、`ehentaiPassHash`；访问里站再加 `exhentaiMemberId`、`exhentaiPassHash`、`exhentaiIgneous`。登录后按 F12 → Application → Cookies → e-hentai.org 即可看到这些值。

请求间隔、超时、重试、缓存体积与保留时长等参数一般不用改，默认值已按站点限流设定。

## 说明

- 站点只提供两种图：原图（多为 2000–4000px 的 PNG）和页面缩放版（1280–2048px）。默认取缩放版，`-q original` 取原图。
- 图片按 `downloadConcurrency` 并发下载，页面请求按 `requestInterval`（默认 300ms）串行发出。默认值实测约 2.5 页/秒；调低间隔或调高并发更快，也更容易被 509。
- PDF 内页统一转成 JPEG（q90、长边 `pdfMaxEdge`），ZIP 保留原文件。
- 下载规模只按页数限制（`maxPages`），不设体积上限。
- 进度写日志，聊天里只发结果；打开 `debug` 可看到 `[请求]`、`[列表]`、`[取图]`、`[下载]` 日志。
- 单页下载失败会丢弃该页缓存重新解析，通常能换到另一台 H@H 主机；仍失败时用 `eh.retry` 补。
- 里站 Cookie 失效时会跳到论坛页，插件会提示更新配置。

## 许可

MIT
