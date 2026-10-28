/**
 * 插件配置：按「基础 / 账号 / 搜索 / 下载 / 图片 / 发送 / 存储 / 调试」分组，
 * 组内顺序统一为 下拉选择 → 文本 → 数值 → 开关。
 * Schema 里的默认值只是兜底，apply() 开头还会统一走一次 normalizeConfig。
 */
import { Schema } from 'koishi'
import { DEFAULT_CACHE_MAX_MB, DEFAULT_CACHE_TTL_HOURS, DEFAULT_CONCURRENCY, DEFAULT_DOWNLOAD_PATH, DEFAULT_FILE_SEND_METHOD, DEFAULT_IMAGE_QUALITY, DEFAULT_IMAGE_SEND_DELAY, DEFAULT_MAX_PAGES, DEFAULT_MENU_STYLE, DEFAULT_OUTPUT, DEFAULT_PAGE_INTERVAL_MS, DEFAULT_PDF_COMPRESS_THRESHOLD, DEFAULT_PDF_MAX_EDGE, PDF_JPEG_QUALITY, DEFAULT_PROMPT_TIMEOUT, DEFAULT_RETRIES, DEFAULT_RETRY_DELAY_SECONDS, DEFAULT_SEARCH_RESULT_LIMIT, DEFAULT_SITE, DEFAULT_TIMEOUT_SECONDS, MENU_STYLES, type MenuStyle } from './constants'
import { clamp, toInt } from './utils'

export interface Config {
  /** 站点选择 */
  site: 'auto' | 'e-hentai' | 'exhentai'
  /** 识别消息中的画廊链接并自动下载 */
  enableLinkRecognition: boolean
  /** 搜索结果用图片菜单还是文字列表 */
  menuStyle: MenuStyle

  /** 表站凭据 */
  ehentaiMemberId: string
  ehentaiPassHash: string
  /** 里站凭据 */
  exhentaiMemberId: string
  exhentaiPassHash: string
  exhentaiIgneous: string

  /** 列表每页展示条数 */
  searchResultLimit: number
  /** 默认语言筛选 */
  searchLanguage: 'all' | 'chinese' | 'japanese' | 'english' | 'korean' | 'translated'
  /** 列表是否展示标签 */
  showTags: boolean
  /** 列表使用合并转发 */
  useForwardForList: boolean
  /** 交互等待时长（秒） */
  promptTimeout: number

  /** 默认输出格式 */
  defaultFormat: 'pdf' | 'zip' | 'img'
  /** 默认图片质量 */
  imageQuality: 'original' | 'resized'
  /** PDF 内页压缩 */
  imageCompression: {
    /** 是否压缩 */
    enabled: boolean
    /** JPEG 质量 */
    quality: number
    /** 小于该体积（KB）的 JPEG 不再压缩 */
    threshold: number
    /** 内页长边上限，0 表示不缩放 */
    maxEdge: number
  }
  /** 下载并发 */
  downloadConcurrency: number
  /** 页面请求最小间隔（毫秒） */
  requestInterval: number
  /** 单请求超时（秒） */
  downloadTimeout: number
  /** 单页重试次数 */
  downloadRetries: number
  /** 重试间隔（秒） */
  retryDelay: number
  /** 单次下载的最大页数，0 表示不限制 */
  maxPages: number
  /** 压缩包 / PDF 的默认密码 */
  defaultPassword: string
  /** 逐张发送图片时的间隔（秒） */
  imageSendDelay: number
  /** 逐张发送图片的模式 */
  imageSendMode: 'auto' | 'forward' | 'single'
  /** PDF / ZIP 的发送方式 */
  fileSendMethod: 'file' | 'buffer'

  /** 下载与缓存目录 */
  downloadPath: string
  /** 文件名是否带上 gid */
  prependGid: boolean

  /** 是否启用缓存 */
  enableCache: boolean
  /** 缓存体积上限（MiB） */
  cacheMaxSizeMb: number
  /** 缩略图缓存时长（小时） */
  cacheTtlHours: number

  /** 输出调试日志 */
  debug: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    site: Schema.union([
      Schema.const('auto').description('自动'),
      Schema.const('exhentai').description('里站 ExHentai'),
      Schema.const('e-hentai').description('表站 E-Hentai'),
    ])
      .description('站点选择，自动优先里站')
      .default(DEFAULT_SITE),
    menuStyle: Schema.union([
      Schema.const('card').description('扩展列表型'),
      Schema.const('grid').description('缩略图型'),
      Schema.const('text').description('文字列表'),
    ])
      .description('搜索结果展示方式')
      .default(DEFAULT_MENU_STYLE),
    enableLinkRecognition: Schema.boolean()
      .description('识别消息里的画廊链接并自动下载')
      .default(false),
  }).description('基础'),

  Schema.object({
    ehentaiMemberId: Schema.string()
      .description('表站 ipb_member_id')
      .default(''),
    ehentaiPassHash: Schema.string()
      .role('secret')
      .description('表站 ipb_pass_hash')
      .default(''),
    exhentaiMemberId: Schema.string()
      .description('里站 ipb_member_id')
      .default(''),
    exhentaiPassHash: Schema.string()
      .role('secret')
      .description('里站 ipb_pass_hash')
      .default(''),
    exhentaiIgneous: Schema.string()
      .role('secret')
      .description('里站 igneous')
      .default(''),
  }).description('账号'),

  Schema.object({
    searchLanguage: Schema.union([
      Schema.const('all').description('全部语言'),
      Schema.const('chinese').description('中文'),
      Schema.const('japanese').description('日语'),
      Schema.const('english').description('英语'),
      Schema.const('korean').description('韩语'),
      Schema.const('translated').description('翻译版（排除日语）'),
    ])
      .description('默认语言，-l 可覆盖')
      .default('all'),
    searchResultLimit: Schema.number()
      .min(1)
      .max(25)
      .step(1)
      .description('每次展示结果条数')
      .default(DEFAULT_SEARCH_RESULT_LIMIT),
    showTags: Schema.boolean()
      .description('菜单与列表中显示标签')
      .default(true),
    useForwardForList: Schema.boolean()
      .description('文字列表用合并转发发送，仅 QQ / OneBot')
      .default(false),
  }).description('搜索'),

  Schema.object({
    imageQuality: Schema.union([
      Schema.const('resized').description('页面缩放版'),
      Schema.const('original').description('原图（体积较大）'),
    ])
      .description('取图规格，-q 可覆盖')
      .default(DEFAULT_IMAGE_QUALITY),
    downloadConcurrency: Schema.number()
      .min(1)
      .max(10)
      .step(1)
      .description('页面下载并发数')
      .default(DEFAULT_CONCURRENCY),
    maxPages: Schema.number()
      .min(0)
      .max(5000)
      .step(10)
      .description('单次页数上限，0 不限制')
      .default(DEFAULT_MAX_PAGES),
    requestInterval: Schema.number()
      .min(100)
      .max(5000)
      .step(100)
      .description('页面请求最小间隔（毫秒）')
      .default(DEFAULT_PAGE_INTERVAL_MS),
    downloadTimeout: Schema.number()
      .min(10)
      .max(600)
      .step(10)
      .description('单次请求超时（秒）')
      .default(DEFAULT_TIMEOUT_SECONDS),
    downloadRetries: Schema.number()
      .min(0)
      .max(5)
      .step(1)
      .description('失败重试次数')
      .default(DEFAULT_RETRIES),
    retryDelay: Schema.number()
      .min(0)
      .max(60)
      .step(1)
      .description('重试间隔（秒）')
      .default(DEFAULT_RETRY_DELAY_SECONDS),
  }).description('下载'),

  Schema.object({
    imageCompression: Schema.object({
      enabled: Schema.boolean()
        .description('压缩 PDF 内页')
        .default(true),
      quality: Schema.number()
        .min(60)
        .max(100)
        .step(1)
        .description('JPEG 质量')
        .default(PDF_JPEG_QUALITY),
      threshold: Schema.number()
        .min(0)
        .max(5000)
        .step(50)
        .description('小于该体积（KB）的 JPEG 不再压缩')
        .default(DEFAULT_PDF_COMPRESS_THRESHOLD),
      maxEdge: Schema.number()
        .min(0)
        .max(8000)
        .step(100)
        .description('内页长边（像素），0 为不缩放')
        .default(DEFAULT_PDF_MAX_EDGE),
    }).description('PDF 内页压缩'),
  }).description('图片'),

  Schema.object({
    defaultFormat: Schema.union([
      Schema.const('pdf').description('PDF 文件'),
      Schema.const('zip').description('ZIP 压缩包'),
      Schema.const('img').description('逐张图片'),
    ])
      .description('默认输出格式，-p / -z / -i 可覆盖')
      .default(DEFAULT_OUTPUT),
    imageSendMode: Schema.union([
      Schema.const('auto').description('自动'),
      Schema.const('forward').description('总是合并转发'),
      Schema.const('single').description('逐张发送'),
    ])
      .description('逐张图片的发送方式')
      .default('auto'),
    defaultPassword: Schema.string()
      .role('secret')
      .description('PDF / ZIP 默认密码，-k 可覆盖')
      .default(''),
    imageSendDelay: Schema.number()
      .min(0)
      .max(10)
      .step(1)
      .description('逐张发送间隔（秒）')
      .default(DEFAULT_IMAGE_SEND_DELAY),
    prependGid: Schema.boolean()
      .description('文件名带 gid')
      .default(true),
    promptTimeout: Schema.number()
      .min(5)
      .max(300)
      .step(5)
      .description('等待回复的秒数')
      .default(DEFAULT_PROMPT_TIMEOUT),
    fileSendMethod: Schema.union([
      Schema.const('file').description('本地路径'),
      Schema.const('buffer').description('文件内容'),
    ])
      .description('PDF / ZIP 的发送方式，协议端读不到本地路径时用 buffer')
      .default(DEFAULT_FILE_SEND_METHOD),
  }).description('发送'),

  Schema.object({
    downloadPath: Schema.string()
      .description('输出目录，相对路径基于 baseDir')
      .default(DEFAULT_DOWNLOAD_PATH),
    cacheMaxSizeMb: Schema.number()
      .min(0)
      .max(4096)
      .step(16)
      .description('缓存体积上限（MiB）')
      .default(DEFAULT_CACHE_MAX_MB),
    cacheTtlHours: Schema.number()
      .min(1)
      .max(720)
      .step(1)
      .description('缓存保留时长（小时）')
      .default(DEFAULT_CACHE_TTL_HOURS),
    enableCache: Schema.boolean()
      .description('缓存缩略图、页面信息与搜索结果')
      .default(true),
  }).description('存储'),

  Schema.object({
    debug: Schema.boolean()
      .description('输出请求与解析细节')
      .default(false),
  }).description('调试'),
])

/** 去掉用户粘贴时可能带上的 `key=` 前缀与引号 */
function normalizeCookieValue(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let value = raw.trim().replace(/^["']|["']$/g, '')
  const equalIndex = value.indexOf('=')
  if (equalIndex > 0 && !value.slice(0, equalIndex).includes(';')) {
    value = value.slice(equalIndex + 1).trim()
  }
  return value
}

/** 在 Schema 默认值之后再做一次夹逼，避免旧配置或手改配置越界 */
export function normalizeConfig(config: Config): Config {
  const result: Config = { ...config }
  result.site = (['auto', 'e-hentai', 'exhentai'] as const).includes(config.site) ? config.site : DEFAULT_SITE
  result.enableLinkRecognition = !!config.enableLinkRecognition
  if (!(MENU_STYLES as readonly string[]).includes(config.menuStyle)) result.menuStyle = DEFAULT_MENU_STYLE

  result.ehentaiMemberId = normalizeCookieValue(config.ehentaiMemberId)
  result.ehentaiPassHash = normalizeCookieValue(config.ehentaiPassHash)
  result.exhentaiMemberId = normalizeCookieValue(config.exhentaiMemberId)
  result.exhentaiPassHash = normalizeCookieValue(config.exhentaiPassHash)
  result.exhentaiIgneous = normalizeCookieValue(config.exhentaiIgneous)

  result.searchResultLimit = clamp(toInt(config.searchResultLimit, DEFAULT_SEARCH_RESULT_LIMIT), 1, 25)
  result.promptTimeout = clamp(toInt(config.promptTimeout, DEFAULT_PROMPT_TIMEOUT), 5, 300)
  result.showTags = !!config.showTags
  result.useForwardForList = !!config.useForwardForList
  if (!['all', 'chinese', 'japanese', 'english', 'korean', 'translated'].includes(config.searchLanguage)) {
    result.searchLanguage = 'all'
  }

  if (!['pdf', 'zip', 'img'].includes(config.defaultFormat)) result.defaultFormat = DEFAULT_OUTPUT
  if (!['original', 'resized'].includes(config.imageQuality)) result.imageQuality = DEFAULT_IMAGE_QUALITY
  const compression = config.imageCompression ?? {}
  const legacyMaxEdge = (config as unknown as { pdfMaxEdge?: number }).pdfMaxEdge
  result.imageCompression = {
    enabled: compression.enabled !== false,
    quality: clamp(toInt(compression.quality, PDF_JPEG_QUALITY), 60, 100),
    threshold: clamp(toInt(compression.threshold, DEFAULT_PDF_COMPRESS_THRESHOLD), 0, 5000),
    maxEdge: clamp(toInt(compression.maxEdge ?? legacyMaxEdge, DEFAULT_PDF_MAX_EDGE), 0, 8000),
  }
  if (!['auto', 'forward', 'single'].includes(config.imageSendMode)) result.imageSendMode = 'auto'
  if (!['file', 'buffer'].includes(config.fileSendMethod)) result.fileSendMethod = DEFAULT_FILE_SEND_METHOD

  result.downloadConcurrency = clamp(toInt(config.downloadConcurrency, DEFAULT_CONCURRENCY), 1, 8)
  result.requestInterval = clamp(toInt(config.requestInterval, DEFAULT_PAGE_INTERVAL_MS), 200, 5000)
  result.downloadTimeout = clamp(toInt(config.downloadTimeout, DEFAULT_TIMEOUT_SECONDS), 10, 600)
  result.downloadRetries = clamp(toInt(config.downloadRetries, DEFAULT_RETRIES), 0, 5)
  result.retryDelay = clamp(toInt(config.retryDelay, DEFAULT_RETRY_DELAY_SECONDS), 0, 60)
  result.maxPages = clamp(toInt(config.maxPages, DEFAULT_MAX_PAGES), 0, 5000)
  result.imageSendDelay = clamp(toInt(config.imageSendDelay, DEFAULT_IMAGE_SEND_DELAY), 0, 10)
  result.defaultPassword = config.defaultPassword?.trim() ?? ''

  result.downloadPath = config.downloadPath?.trim() || DEFAULT_DOWNLOAD_PATH
  result.prependGid = config.prependGid !== false

  result.enableCache = config.enableCache !== false
  result.cacheMaxSizeMb = clamp(toInt(config.cacheMaxSizeMb, DEFAULT_CACHE_MAX_MB), 0, 4096)
  result.cacheTtlHours = clamp(toInt(config.cacheTtlHours, DEFAULT_CACHE_TTL_HOURS), 1, 720)

  result.debug = !!config.debug
  return result
}
