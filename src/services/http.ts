/**
 * 站点 HTTP 客户端：
 * - 按站点选择 Cookie，自动识别登录失效与 509；
 * - 页面请求串行 + 最小间隔（避免触发站点限流）；
 * - 图片/原图走流式下载，带闲置超时与体积上限。
 */
import type { Context } from 'koishi'
import * as fs from 'fs'
import * as path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { Config } from '../config'
import type { Site } from '../types'
import { FORUM_HOST, MAX_IMAGE_BYTES, MEDIA_STALL_TIMEOUT_MS, PAGE_REQUEST_TIMEOUT_MS, SITES, USER_AGENT } from '../constants'
import {
  ensureDir,
  extensionFromContentType,
  formatNetworkError,
  getErrorMessage,
  getHttpStatus,
  isAbortError,
  isForumUrl,
  logger,
  readHeader,
  removePath,
  sleepAbortable,
} from '../utils'
import { TaskCancelledError } from './task'

/** 图片总超时放宽到 30 分钟，真正的兜底是闲置超时 */
const MEDIA_TOTAL_TIMEOUT_MS = 30 * 60 * 1000

export class SiteAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteAuthError'
  }
}

export class SiteBannedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteBannedError'
  }
}

export class MediaTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaTypeError'
  }
}

export interface RequestOptions {
  signal?: AbortSignal
  referer?: string
  timeoutMs?: number
  /** 页面解析类请求需要排队限速；图片直链不需要 */
  skipRateLimit?: boolean
}

export interface MediaDownloadOptions {
  signal?: AbortSignal
  referer?: string
  onProgress?: (received: number, total?: number) => void
}

/** 串行最小间隔限流器：所有页面请求共享一条队列 */
class IntervalLimiter {
  private chain: Promise<void> = Promise.resolve()
  private last = 0

  constructor(private readonly intervalMs: number) {}

  wait(signal?: AbortSignal): Promise<void> {
    const run = async () => {
      const wait = this.last + this.intervalMs - Date.now()
      if (wait > 0) await sleepAbortable(wait, signal)
      this.last = Date.now()
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }
}

export class EhHttpClient {
  private readonly limiter: IntervalLimiter

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {
    this.limiter = new IntervalLimiter(config.requestInterval)
  }

  get primarySite(): Site {
    if (this.config.site !== 'auto') return this.config.site
    return this.hasCredentials('exhentai') ? 'exhentai' : 'e-hentai'
  }

  origin(site: Site): string {
    return SITES[site].origin
  }

  /** 该站点的请求是否会带上登录 Cookie（原图与里站都要求登录） */
  canLogin(site: Site): boolean {
    return Boolean(this.cookieFor(site))
  }

  hasCredentials(site: Site): boolean {
    if (site === 'exhentai') {
      return Boolean(this.config.exhentaiMemberId && this.config.exhentaiPassHash)
    }
    if (this.config.ehentaiMemberId && this.config.ehentaiPassHash) return true
    return Boolean(this.config.exhentaiMemberId && this.config.exhentaiPassHash)
  }

  /** 识别 URL 所属站点；H@H 图片主机与 ehgt.org 返回 undefined */
  siteOfUrl(url: string): Site | undefined {
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      return undefined
    }
    if (host === 'exhentai.org' || host.endsWith('.exhentai.org')) return 'exhentai'
    if (host === 'e-hentai.org' || host.endsWith('.e-hentai.org')) return 'e-hentai'
    return undefined
  }

  private cookieFor(site: Site): string | undefined {
    if (site === 'exhentai') {
      const { exhentaiMemberId: id, exhentaiPassHash: hash, exhentaiIgneous: igneous } = this.config
      if (!id || !hash) return undefined
      const parts = [`ipb_member_id=${id}`, `ipb_pass_hash=${hash}`]
      if (igneous) parts.push(`igneous=${igneous}`)
      return parts.join('; ')
    }
    const id = this.config.ehentaiMemberId || this.config.exhentaiMemberId
    const hash = this.config.ehentaiPassHash || this.config.exhentaiPassHash
    if (!id || !hash) return undefined
    return `ipb_member_id=${id}; ipb_pass_hash=${hash}`
  }

  private headersFor(url: string, referer?: string, accept?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      accept: accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    }
    const site = this.siteOfUrl(url) ?? this.siteOfUrl(referer ?? '')
    if (site) {
      const cookie = this.cookieFor(site)
      if (cookie) headers.cookie = cookie
    }
    if (referer) headers.referer = referer
    return headers
  }

  /** 取消优先：外部 signal 已中止时抛出取消原因，而不是被包装成网络错误 */
  private cancelledOr(error: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted) {
      const reason = signal.reason
      if (reason instanceof Error) return reason
      return new TaskCancelledError()
    }
    if (isAbortError(error)) return error instanceof Error ? error : new TaskCancelledError()
    return this.translateError(error)
  }

  private translateError(error: unknown): Error {
    if (error instanceof SiteAuthError || error instanceof SiteBannedError) return error
    if (isAbortError(error)) return error instanceof Error ? error : new Error('任务已取消')
    const status = getHttpStatus(error)
    if (status === 509) {
      return new SiteBannedError('站点返回 509（请求过多），请稍后重试或降低下载并发。')
    }
    if (status === 403) {
      return new SiteAuthError(`站点返回 403（拒绝访问），请检查 Cookie 是否有效。`)
    }
    return new Error(formatNetworkError(error))
  }

  private assertAccessible(finalUrl: string, html: string): void {
    if (isForumUrl(finalUrl, FORUM_HOST)) {
      throw new SiteAuthError('站点要求登录，请检查账号 Cookie 是否有效。')
    }
    if (!html || !html.trim()) {
      throw new SiteAuthError('站点返回了空页面，请检查账号 Cookie 是否有效。')
    }
  }

  /** 抓取 HTML 页面 */
  async fetchText(url: string, options: RequestOptions = {}): Promise<{ html: string; finalUrl: string }> {
    const timeout = options.timeoutMs ?? PAGE_REQUEST_TIMEOUT_MS
    const startedAt = Date.now()
    if (!options.skipRateLimit) await this.limiter.wait(options.signal)

    let response: { data: string; url?: string }
    try {
      response = await this.ctx.http<string>(url, {
        headers: this.headersFor(url, options.referer),
        responseType: 'text',
        timeout,
        signal: options.signal,
        redirect: 'follow',
      })
    } catch (error) {
      throw this.cancelledOr(error, options.signal)
    }

    const finalUrl = response.url ?? url
    const html = typeof response.data === 'string' ? response.data : ''
    logger.debug(`[请求] ${new URL(url).pathname} ${html.length}B ${Date.now() - startedAt}ms${finalUrl !== url ? ` -> ${finalUrl}` : ''}`)
    this.assertAccessible(finalUrl, html)
    if (/you have been banned|temporarily banned/i.test(html) && html.length < 30000) {
      throw new SiteBannedError('当前 IP 已被站点临时封禁，请稍后重试。')
    }
    return { html, finalUrl }
  }

  /** 抓取二进制内容（缩略图等小文件） */
  async fetchBuffer(url: string, options: RequestOptions = {}): Promise<{ buffer: Buffer; contentType?: string }> {
    const startedAt = Date.now()
    if (!options.skipRateLimit) await this.limiter.wait(options.signal)
    let response: { data: ArrayBuffer; headers: unknown }
    try {
      response = await this.ctx.http<ArrayBuffer>(url, {
        headers: this.headersFor(url, options.referer, 'image/avif,image/webp,image/png,image/*,*/*;q=0.8'),
        responseType: 'arraybuffer',
        timeout: options.timeoutMs ?? PAGE_REQUEST_TIMEOUT_MS,
        signal: options.signal,
        redirect: 'follow',
      })
    } catch (error) {
      throw this.cancelledOr(error, options.signal)
    }
    logger.debug(`[请求] ${new URL(url).pathname} ${response.data.byteLength}B ${Date.now() - startedAt}ms`)
    const contentType = readHeader(response.headers, 'content-type')
    if (contentType && !/^(image|application\/octet-stream)/i.test(contentType)) {
      throw new MediaTypeError(`返回的不是图片 (Content-Type: ${contentType})`)
    }
    const buffer = Buffer.from(response.data)
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new MediaTypeError('图片体积超过上限')
    }
    return { buffer, contentType }
  }

  /** 流式下载图片到文件，带闲置超时与体积上限 */
  async downloadMedia(url: string, destPath: string, options: MediaDownloadOptions = {}): Promise<{ size: number; contentType?: string }> {
    const { signal, referer, onProgress } = options
    if (signal?.aborted) throw new TaskCancelledError()

    const controller = new AbortController()
    const onOuterAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onOuterAbort, { once: true })

    let lastActivity = Date.now()
    const stallTimer = setInterval(() => {
      if (Date.now() - lastActivity > MEDIA_STALL_TIMEOUT_MS) {
        controller.abort(new Error('图片下载长时间没有数据，已中断。'))
      }
    }, 5000)
    stallTimer.unref?.()

    try {
      const response = await this.ctx.http<ReadableStream<Uint8Array>>(url, {
        headers: this.headersFor(url, referer, 'image/avif,image/webp,image/png,image/*,*/*;q=0.8'),
        responseType: 'stream',
        timeout: MEDIA_TOTAL_TIMEOUT_MS,
        signal: controller.signal,
        redirect: 'follow',
      })

      const contentType = readHeader(response.headers, 'content-type')
      if (contentType && /^text\/html/i.test(contentType)) {
        await discardStream(response.data)
        throw new SiteAuthError('图片被重定向到登录页，请检查 Cookie 是否有效。')
      }
      if (contentType && !/^image\//i.test(contentType)) {
        await discardStream(response.data)
        throw new MediaTypeError(`返回的不是图片 (Content-Type: ${contentType})`)
      }
      const contentLength = Number(readHeader(response.headers, 'content-length') ?? '') || undefined
      if (contentLength && contentLength > MAX_IMAGE_BYTES) {
        await discardStream(response.data)
        throw new MediaTypeError('图片体积超过上限')
      }

      await ensureDir(path.dirname(destPath))
      let received = 0
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          lastActivity = Date.now()
          if (received > MAX_IMAGE_BYTES) {
            callback(new MediaTypeError('图片体积超过上限'))
            return
          }
          onProgress?.(received, contentLength)
          callback(null, chunk)
        },
      })

      const source = Readable.fromWeb(response.data as Parameters<typeof Readable.fromWeb>[0])
      await pipeline(source, counter, fs.createWriteStream(destPath))
      if (!received) throw new MediaTypeError('下载到的图片为空')
      return { size: received, contentType }
    } catch (error) {
      await removePath(destPath)
      if (error instanceof MediaTypeError) throw error
      if (signal?.aborted || isAbortError(error)) throw this.cancelledOr(error, signal)
      const translated = this.translateError(error)
      logger.debug(`[下载] 媒体下载失败: ${getErrorMessage(translated)}`)
      throw translated
    } finally {
      clearInterval(stallTimer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  /** 探测站点登录状态 */
  async probeLogin(site: Site): Promise<'ok' | 'invalid' | 'no-credentials'> {
    if (!this.cookieFor(site)) return 'no-credentials'
    try {
      const response = await this.ctx.http<string>(`${SITES[site].origin}/`, {
        headers: this.headersFor(`${SITES[site].origin}/`),
        responseType: 'text',
        timeout: PAGE_REQUEST_TIMEOUT_MS,
      })
      const finalUrl = response.url ?? ''
      if (isForumUrl(finalUrl, FORUM_HOST)) return 'invalid'
      if (!response.data || !String(response.data).trim()) return 'invalid'
      return 'ok'
    } catch (error) {
      if (getHttpStatus(error) === 403) return 'invalid'
      throw this.translateError(error)
    }
  }

  /** 重试封装：页面请求固定间隔重试，登录失效与 509 不重试 */
  async withRetry<T>(run: () => Promise<T>, options: { retries: number; delayMs: number; signal?: AbortSignal }): Promise<T> {
    let attempt = 0
    while (true) {
      try {
        return await run()
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) throw error
        if (error instanceof SiteAuthError) throw error
        if (error instanceof SiteBannedError && /509/.test(error.message)) throw error
        if (attempt >= options.retries) throw error
        attempt++
        logger.debug(`[重试] 第 ${attempt} 次重试: ${getErrorMessage(error)}`)
        await sleepAbortable(options.delayMs * attempt, options.signal)
      }
    }
  }
}

/** 放弃未消费的响应流，避免底层连接在暂停状态下关闭 */
async function discardStream(stream: ReadableStream<Uint8Array> | undefined): Promise<void> {
  try {
    await stream?.cancel()
  } catch {
    // 忽略取消失败
  }
}

/** 供上层检查媒体扩展名用 */
export function mediaExtension(contentType: string | undefined, url: string): string {
  if (contentType) {
    const fromType = extensionFromContentType(contentType)
    if (fromType) return fromType
  }
  try {
    const match = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)
    if (match) return match[1].toLowerCase()
  } catch {
    // 忽略非法 URL
  }
  return 'jpg'
}
