/**
 * 通用工具：日志、时间与体积格式化、错误文案、路径与文件名处理。
 */
import { Logger, HTTP } from 'koishi'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { IMAGE_EXTENSION_BY_TYPE, PLUGIN_NAME } from './constants'

export const logger = new Logger(PLUGIN_NAME)

export { sleep } from 'koishi'

/** 统一提取错误信息，避免把对象直接拼进日志或消息 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** 兼容 Headers 与普通对象两种响应头形态 */
export function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const record = headers as Record<string, unknown>
  const direct = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()]
  if (Array.isArray(direct)) return direct.join(', ')
  return typeof direct === 'string' ? direct : undefined
}

/** 从错误对象上取 HTTP 状态码 */
export function getHttpStatus(error: unknown): number | undefined {
  const response = (error as { response?: { status?: number } })?.response
  if (response && typeof response.status === 'number') return response.status
  return undefined
}

/** 从错误对象上取响应头 */
export function getErrorHeaders(error: unknown): unknown {
  const response = (error as { response?: { headers?: unknown } })?.response
  return response?.headers
}

/** 判断错误是否由超时引起 */
export function isTimeoutError(error: unknown): boolean {
  if (HTTP.Error.is(error)) return error.code === 'ETIMEDOUT'
  return /ETIMEDOUT|request timeout|timed out/i.test(getErrorMessage(error))
}

/** 把网络层错误翻译成可读文案，并给出下一步 */
export function formatNetworkError(error: unknown): string {
  const message = getErrorMessage(error)
  const status = getHttpStatus(error)
  if (status === 509) return '站点返回 509（请求过多），请稍后重试或降低并发。'
  if (status === 403) return '站点返回 403（拒绝访问），请检查 Cookie 是否有效。'
  if (status === 404) return '站点返回 404（页面不存在），请检查链接或 gid 是否正确。'
  if (isTimeoutError(error)) return '请求超时，请稍后重试。'
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i.test(message)) {
    return '网络连接失败，请检查网络或代理设置。'
  }
  return `请求失败：${truncate(message, 160)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 把配置值转成整数，非法时返回回退值 */
export function toInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

/** 按 KiB / MiB / GiB 展示体积 */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '未知'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  const digits = unit === 0 ? 0 : size >= 100 ? 0 : 1
  return `${size.toFixed(digits)} ${units[unit]}`
}

/** 站点时间文本统一压缩空白 */
export function formatDate(text: string | undefined): string {
  if (!text) return '未知'
  return text.replace(/\s+/g, ' ').trim()
}

/** 毫秒转可读时长 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

/** 千分位数字 */
export function formatCount(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '未知'
  return value.toLocaleString('en-US')
}

/** 截断过长文本，保留尾部省略号 */
export function truncate(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

/** 换行与多余空白压成单行 */
export function singleLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** 生成安全的文件名：去掉路径分隔符与 Windows 保留字符，限制长度 */
export function sanitizeFilename(name: string, fallback = 'gallery'): string {
  const cleaned = singleLine(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
  const result = cleaned || fallback
  return result.length > 120 ? result.slice(0, 120) : result
}

/** 解析下载目录：相对路径基于 ctx.baseDir */
export function resolveDownloadPath(baseDir: string, configured: string): string {
  const raw = (configured || '').trim()
  if (!raw) return path.resolve(baseDir, 'data/temp/ehentai-downloader')
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw)
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
}

export async function removePath(target: string): Promise<void> {
  await fs.promises.rm(target, { recursive: true, force: true }).catch(() => undefined)
}

export async function fileSize(target: string): Promise<number> {
  try {
    const stat = await fs.promises.stat(target)
    return stat.size
  } catch {
    return 0
  }
}

/** 判断缓冲区是否是常见图片格式 */
export function isImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return true
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return true
  return false
}

/** 从 content-type 推断扩展名 */
export function extensionFromContentType(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined
  return IMAGE_EXTENSION_BY_TYPE[contentType.split(';')[0].trim().toLowerCase()]
}

/** 从 URL 路径推断扩展名 */
export function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname
    const match = /\.([a-z0-9]+)$/i.exec(pathname)
    const ext = match?.[1]?.toLowerCase()
    return ext && ext.length <= 5 ? ext : undefined
  } catch {
    return undefined
  }
}

/** 去掉扩展名 */
export function stripExtension(filename: string): string {
  const ext = path.extname(filename)
  return ext ? filename.slice(0, -ext.length) : filename
}

/** 页码补零，便于按文件名排序 */
export function padPageNumber(index: number, total: number): string {
  const width = Math.max(3, String(total).length)
  return String(index).padStart(width, '0')
}

/** 判断跳转后的地址是否已经离开站点（里站登录失效会跳到论坛） */
export function isForumUrl(finalUrl: string, forumHost: string): boolean {
  try {
    const host = new URL(finalUrl).hostname
    return host === forumHost || host.endsWith(`.${forumHost}`)
  } catch {
    return false
  }
}

/** 按配置放开调试日志：debug 时把插件 logger 调到 DEBUG 级别 */
export function setLoggerLevel(debug: boolean): void {
  logger.level = debug ? Logger.DEBUG : Logger.INFO
}

/** 生成稳定的哈希，用于缓存文件名 */
export function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

/** 判断是否是取消/中止类错误 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  const name = (error as { name?: string })?.name
  if (name === 'AbortError' || name === 'TaskCancelledError') return true
  return /aborted|已取消|cancelled/i.test(getErrorMessage(error))
}

/** 可被中止的等待 */
export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      return
    }
    let timer: NodeJS.Timeout
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, ms))
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface RetryOptions {
  retries: number
  delayMs: number
  signal?: AbortSignal
  /** 返回 true 表示该错误不值得重试 */
  fatal?: (error: unknown) => boolean
  onRetry?: (error: unknown, attempt: number, waitMs: number) => void
}

/** 通用重试：失败后按固定间隔重试，取消时立即放弃 */
export async function retryAsync<T>(run: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      return await run(attempt)
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw error
      if (options.fatal?.(error)) throw error
      if (attempt >= options.retries) throw error
      attempt++
      const waitMs = options.delayMs * attempt
      options.onRetry?.(error, attempt, waitMs)
      await sleepAbortable(waitMs, options.signal)
    }
  }
}
