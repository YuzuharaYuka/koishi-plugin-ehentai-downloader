/**
 * 插件常量：站点地址、默认值、分类与语言的显示/别名映射、页面选择器、用户文案。
 * 面向人的文本集中在这里，便于统一维护。
 */
import type { ImageQuality, OutputFormat, Site } from './types'

export const PLUGIN_NAME = 'ehentai-downloader'
export const PACKAGE_NAME = `koishi-plugin-${PLUGIN_NAME}`
export const PLUGIN_VERSION = '1.0.1'
export const PLUGIN_HOMEPAGE = 'https://www.npmjs.com/package/koishi-plugin-ehentai-downloader'

/** 站点基本信息 */
export interface SiteConfig {
  label: string
  origin: string
  /** 缩略图主机 */
  thumbOrigin: string
}

export const SITES: Record<Site, SiteConfig> = {
  'e-hentai': {
    label: '表站',
    origin: 'https://e-hentai.org',
    thumbOrigin: 'https://ehgt.org',
  },
  exhentai: {
    label: '里站',
    origin: 'https://exhentai.org',
    thumbOrigin: '',
  },
}

/** 视为站内页面的主机名，用于识别登录跳转 */
export const SITE_HOSTS = [
  'e-hentai.org',
  'exhentai.org',
  'g.e-hentai.org',
  'g.exhentai.org',
  'ehgt.org',
  'hath.network',
]

/** 论坛跳转主机，出现即代表里站登录失效 */
export const FORUM_HOST = 'forums.e-hentai.org'

/** 站点请求默认 UA，使用桌面浏览器以免被站点降级处理 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 默认值 */
export const DEFAULT_SITE = 'auto'
export const DEFAULT_OUTPUT: OutputFormat = 'pdf'
export const DEFAULT_IMAGE_QUALITY: ImageQuality = 'resized'
export const DEFAULT_SEARCH_RESULT_LIMIT = 9
export const MENU_STYLES = ['card', 'grid', 'text'] as const
export type MenuStyle = typeof MENU_STYLES[number]
export const DEFAULT_MENU_STYLE: MenuStyle = 'card'
export const DEFAULT_PROMPT_TIMEOUT = 120
export const DEFAULT_CONCURRENCY = 6
export const DEFAULT_PAGE_INTERVAL_MS = 200
export const DEFAULT_TIMEOUT_SECONDS = 60
export const DEFAULT_RETRIES = 2
export const DEFAULT_RETRY_DELAY_SECONDS = 3
export const DEFAULT_IMAGE_SEND_DELAY = 1
export const DEFAULT_DOWNLOAD_PATH = './data/temp/ehentai-downloader'
export const DEFAULT_MAX_PAGES = 300
export const DEFAULT_CACHE_TTL_HOURS = 24
export const DEFAULT_CACHE_MAX_MB = 256

/** 站点页面与图廊的公开限制 */
export const SEARCH_PAGE_SIZE = 25
export const GALLERY_THUMBS_PER_PAGE = 20
export const TAG_DISPLAY_LIMIT = 10
export const RESULT_TITLE_LIMIT = 120

/** 图片菜单宽度 */
export const MENU_WIDTH = 900
/** 菜单 JPEG 质量：q92 与 q95 观感几乎无差别，体积小一截 */
export const MENU_JPEG_QUALITY = 92
/** 缩略图长边，缩略图本身只有 200 宽，再大只会糊 */
export const THUMBNAIL_WIDTH = 320
/** PDF 单页长边上限：源图 2160×3840 会缩到这条线，0 表示不缩放 */
export const DEFAULT_PDF_MAX_EDGE = 3000
/** 未配置时的兜底长边 */
export const PDF_MAX_EDGE = DEFAULT_PDF_MAX_EDGE
/** PDF 内嵌图片的重新编码质量 */
export const PDF_JPEG_QUALITY = 90
export const MAX_GID = 99999999

/** 允许合并转发的平台 */
export const FORWARD_SUPPORTED_PLATFORMS = ['qq', 'onebot']
/** 合并转发每批图片数 */
export const FORWARD_BATCH_SIZE = 20
export const FORWARD_BATCH_DELAY_MS = 600

/** 页面选择器，集中放置以便站点改版时统一调整 */
export const SELECTORS = {
  galleryTitle: '#gn',
  galleryTitleJpn: '#gj',
  galleryCover: '#gd1',
  galleryCategory: '#gdc .cs',
  galleryUploader: '#gdn',
  galleryInfoRows: '#gdd tr',
  galleryInfoKey: '.gdt1',
  galleryInfoValue: '.gdt2',
  galleryFavCount: '#favcount',
  galleryThumbLinks: '#gdt a',
  galleryPager: 'table.ptt a',
  tagTable: '#taglist',
  tagNamespaceCell: 'td.tc',
  tagLink: 'a',
  searchRows: 'table.itg tr',
  searchCategory: 'td.gl1c div.cn',
  searchThumb: 'td.gl2c img',
  searchName: 'td.gl3c a',
  searchNameText: 'div.glink',
  searchTags: 'td.gl3c div.gt',
  searchMeta: 'td.gl4c',
  searchText: 'div.searchtext',
  searchNext: '#unext',
  searchPrev: '#uprev',
  searchFirst: '#ufirst',
  searchLast: '#ulast',
  toplistRows: 'table.itg tr',
  imageResized: '#img',
  imageInfo: '#i4',
  imageLinks: '#i6 a',
  imageLoadFail: '#loadfail',
  imagePageCounter: '#i2',
} as const

/** 画廊分类位（搜索页 f_cats 使用「被排除分类」的位掩码） */
export const CATEGORY_BITS: Record<string, number> = {
  misc: 1,
  doujinshi: 2,
  manga: 4,
  'artist-cg': 8,
  'game-cg': 16,
  'image-set': 32,
  cosplay: 64,
  'asian-porn': 128,
  'non-h': 256,
  western: 512,
}

/** 分类英文名（站点原样） */
export const CATEGORY_NAMES: Record<string, string> = {
  misc: 'Misc',
  doujinshi: 'Doujinshi',
  manga: 'Manga',
  'artist-cg': 'Artist CG',
  'game-cg': 'Game CG',
  'image-set': 'Image Set',
  cosplay: 'Cosplay',
  'asian-porn': 'Asian Porn',
  'non-h': 'Non-H',
  western: 'Western',
}

/** 分类取值（-c/--category）别名 */
export const CATEGORY_ALIASES: Record<string, string> = {
  misc: 'misc',
  其他: 'misc',
  杂项: 'misc',
  doujinshi: 'doujinshi',
  doujin: 'doujinshi',
  dou: 'doujinshi',
  同人: 'doujinshi',
  同人志: 'doujinshi',
  manga: 'manga',
  漫画: 'manga',
  'artist-cg': 'artist-cg',
  'artistcg': 'artist-cg',
  artist: 'artist-cg',
  画师cg: 'artist-cg',
  'game-cg': 'game-cg',
  'gamecg': 'game-cg',
  游戏cg: 'game-cg',
  'image-set': 'image-set',
  'imageset': 'image-set',
  images: 'image-set',
  画集: 'image-set',
  图集: 'image-set',
  cosplay: 'cosplay',
  cos: 'cosplay',
  'asian-porn': 'asian-porn',
  asian: 'asian-porn',
  亚洲: 'asian-porn',
  'non-h': 'non-h',
  nonh: 'non-h',
  非h: 'non-h',
  western: 'western',
  欧美: 'western',
}

/** 展示用的分类中文名 */
export const CATEGORY_DISPLAY: Record<string, string> = {
  Misc: '杂项',
  Doujinshi: '同人志',
  Manga: '漫画',
  'Artist CG': '画师 CG',
  'Game CG': '游戏 CG',
  'Image Set': '画集',
  Cosplay: 'Cosplay',
  'Asian Porn': '亚洲',
  'Non-H': '非 H',
  Western: '欧美',
}

/** 标签命名空间的中文名 */
export const NAMESPACE_DISPLAY: Record<string, string> = {
  parody: '原作',
  character: '角色',
  artist: '作者',
  group: '社团',
  cosplayer: 'Coser',
  female: '女性',
  male: '男性',
  mixed: '混合',
  other: '其他',
  language: '语言',
  reclass: '重分类',
  location: '场景',
  series: '系列',
}

/** 语言搜索词（translated 用排除日文的方式近似「翻译版」） */
export const LANGUAGE_QUERY: Record<string, string> = {
  chinese: 'language:chinese',
  japanese: 'language:japanese',
  english: 'language:english',
  korean: 'language:korean',
  translated: '-language:japanese',
  all: '',
}

/** 语言取值（-l/--language）别名 */
export const LANGUAGE_ALIASES: Record<string, string> = {
  chinese: 'chinese',
  zh: 'chinese',
  中文: 'chinese',
  汉化: 'chinese',
  japanese: 'japanese',
  jp: 'japanese',
  日语: 'japanese',
  日文: 'japanese',
  english: 'english',
  en: 'english',
  英文: 'english',
  英语: 'english',
  korean: 'korean',
  kr: 'korean',
  韩语: 'korean',
  translated: 'translated',
  translation: 'translated',
  翻译: 'translated',
  all: 'all',
  全部: 'all',
}

/** 排行榜取值（tl 参数） */
export const TOPLIST_TL: Record<string, number> = {
  'all-time': 11,
  'past-year': 12,
  'past-month': 13,
  yesterday: 15,
}

export const TOPLIST_ALIASES: Record<string, string> = {
  'all-time': 'all-time',
  alltime: 'all-time',
  all: 'all-time',
  全部: 'all-time',
  总榜: 'all-time',
  'past-year': 'past-year',
  year: 'past-year',
  年榜: 'past-year',
  'past-month': 'past-month',
  month: 'past-month',
  月榜: 'past-month',
  yesterday: 'yesterday',
  day: 'yesterday',
  today: 'yesterday',
  daily: 'yesterday',
  日榜: 'yesterday',
  昨日: 'yesterday',
}

export const TOPLIST_LABELS: Record<string, string> = {
  'all-time': '历史总榜',
  'past-year': '年度榜',
  'past-month': '本月榜',
  yesterday: '昨日榜',
}

/** 输出格式取值 */
export const FORMAT_ALIASES: Record<string, OutputFormat> = {
  pdf: 'pdf',
  zip: 'zip',
  img: 'img',
  image: 'img',
  images: 'img',
  pic: 'img',
  图片: 'img',
  压缩包: 'zip',
}

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  pdf: 'PDF',
  zip: 'ZIP',
  img: '图片',
}

/** 图片质量取值 */
export const QUALITY_ALIASES: Record<string, ImageQuality> = {
  original: 'original',
  org: 'original',
  raw: 'original',
  原图: 'original',
  resized: 'resized',
  resize: 'resized',
  screen: 'resized',
  small: 'resized',
  压缩: 'resized',
  缩放: 'resized',
}

export const QUALITY_LABELS: Record<ImageQuality, string> = {
  original: '原图',
  resized: '缩放版',
}

/** 识别输入中的画廊链接 */
export const GALLERY_URL_REGEX =
  /^https?:\/\/(?:[a-z0-9-]+\.)?(?:e-hentai|exhentai)\.org\/(?:g|mpv)\/(\d+)\/([0-9a-f]+)/i

/** 识别画廊链接（用于消息中的链接识别，可出现在文本任意位置） */
export const GALLERY_URL_SEARCH_REGEX =
  /https?:\/\/(?:[a-z0-9-]+\.)?(?:e-hentai|exhentai)\.org\/(?:g|mpv)\/(\d+)\/([0-9a-f]+)/i

/** 识别图片页链接 */
export const IMAGE_URL_REGEX =
  /^https?:\/\/(?:e-hentai|exhentai)\.org\/s\/([0-9a-f]+)\/(\d+)-(\d+)/i

/** 纯数字 gid */
export const GID_REGEX = /^\d+$/

/** 从列表页 href 中提取 gid 与 token */
export const GALLERY_HREF_REGEX = /\/g\/(\d+)\/([0-9a-z]+)\//i

/** 从缩略图背景里提取页面 token */
export const THUMB_PAGE_HREF_REGEX = /\/s\/([0-9a-z]+)\/(\d+)-(\d+)/i

/** 图片扩展名与 content-type 的映射 */
export const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
}

/** PDF 可直接嵌入的图片格式 */
export const PDF_EMBEDDABLE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png'])

/** 允许作为图片落盘的扩展名 */
export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'])

/** 面向用户的固定文案 */
export const MESSAGES = {
  initializing: '插件正在初始化，请稍候…',
  notInitialized: '插件尚未初始化完成，请稍后再试。',

  emptySearchQuery: '请输入搜索关键词，或使用 `-c` 指定分类后搜索。',
  searching: '正在搜索…',
  searchFailed: '搜索失败，请稍后重试。',
  noResults: '没有找到匹配的画廊。',
  noMoreResults: '没有更多结果了。',
  searchPageInvalid: '该页结果无法解析，请重新搜索。',

  invalidGalleryInput: '无法识别的输入。请提供画廊 ID，或 `https://e-hentai.org/g/...` 形式的链接。',
  resolvingGallery: '正在解析画廊…',
  galleryResolveFailed: '无法获取该画廊，请检查链接是否有效。',
  galleryNotFound: '画廊不存在或已被删除（Key missing, or incorrect key provided.）。',
  galleryExpunged: '该画廊已被删除（Expunged），无法下载。',
  galleryLoginRequired: '需要里站登录凭据才能访问该画廊，请在插件配置中填写里站 Cookie。',
  mpvOnly: '该画廊只能在多页查看器中浏览，当前账号没有权限，无法下载。',
  tooManyPages: '画廊页数超过配置的上限，请使用 `-r` 指定页码范围后再试。',

  downloadStarted: '已开始下载',
  downloadPreparing: '正在准备下载…',
  downloadCancelled: '下载已取消。',
  downloadFinished: '下载完成',
  downloadFailed: '下载失败',
  downloadNoPages: '没有成功下载任何页面。',
  downloadPartial: '有页面下载失败，页码为',

  noActiveTask: '当前没有进行中的下载。',
  cancelRequested: '正在取消下载…',
  noFailedTask: '没有可重试的失败记录，失败记录保留 30 分钟。',
  retryStarted: '正在重试失败的页面…',

  promptTimeout: '操作超时，已自动取消。',
  promptInvalid: '无效的输入，已退出交互。',
  promptNoChoice: '无效的选择。',

  linkRecognitionDisabled: '链接自动识别未开启。',

  requestFailed: '请求站点失败',
  requestTimeout: '请求超时',
  requestBanned: '站点拒绝了本次请求（509），请降低并发或等待一段时间后再试。',
  requestAuthFailed: '站点登录状态无效，请检查插件配置中的 Cookie。',

  fileSendFailed: '文件发送失败，可能超过平台体积限制。文件已保留在',
  imageSendFailed: '部分图片发送失败，已跳过。',
} as const

/** 站点页面的请求限定：普通页面至少间隔一段时间，避免触发风控 */
export const PAGE_REQUEST_TIMEOUT_MS = 30_000
/** 图片下载的闲置超时 */
export const MEDIA_STALL_TIMEOUT_MS = 60_000
/** 单张图片的最大体积（字节），避免异常响应撑爆磁盘 */
export const MAX_IMAGE_BYTES = 512 * 1024 * 1024
/** 进度日志间隔 */
export const PROGRESS_LOG_INTERVAL_MS = 5_000
/** 失败记录保留时长 */
export const FAILED_RECORD_TTL_MS = 30 * 60 * 1000
