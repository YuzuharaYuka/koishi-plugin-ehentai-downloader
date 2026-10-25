/**
 * 图片页解析与图片获取：
 * - 图片页只暴露缩放版直链，原图链接需要从图片页的 #i6 中提取；
 * - 缩略图统一转成 JPEG 后缓存，菜单直接画，文字列表用 data URI 发送。
 */
import type { Config } from '../config'
import { MESSAGES, THUMBNAIL_WIDTH } from '../constants'
import { parseImagePage } from '../parsers'
import type { GalleryDetail, GalleryPageEntry, ImagePageInfo, Site } from '../types'
import { getErrorMessage, logger } from '../utils'
import type { CacheStore } from './cache'
import { EhHttpClient } from './http'
import { resizeToJpeg } from './image-codec'

const IMAGE_INFO_TTL_MS = 15 * 60 * 1000
const THUMB_QUALITY = 80

export interface ResolvedImage {
  url: string
  referer: string
  filename?: string
  width?: number
  height?: number
  resized: boolean
}

export class ImageUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageUnavailableError'
  }
}

export class ImageService {
  constructor(
    private readonly http: EhHttpClient,
    private readonly config: Config,
    private readonly cache: CacheStore,
  ) {}

  /** 解析图片页，得到可下载地址（原图或缩放版） */
  async resolvePage(gallery: GalleryDetail, entry: GalleryPageEntry, signal?: AbortSignal): Promise<ResolvedImage> {
    const info = await this.getPageInfo(entry.pageUrl, gallery.site, signal)
    if (info.mpv) throw new ImageUnavailableError(MESSAGES.mpvOnly)

    // 原图走 fullimg，未登录会被重定向到登录页，此时直接用页面缩放版
    const preferOriginal = this.config.imageQuality === 'original'
    const loggedIn = this.http.canLogin(gallery.site)
    const useOriginal = preferOriginal && loggedIn && Boolean(info.originalUrl)
    const url = useOriginal ? info.originalUrl : info.resizedUrl
    if (!url) throw new ImageUnavailableError('该页没有可用的图片地址')

    const fallback = preferOriginal && !useOriginal ? '（原图需要登录，已改用缩放版）' : ''
    logger.debug(`[取图] 第 ${entry.index} 页 ${useOriginal ? '原图' : '缩放版'} ${info.filename ?? ''}${fallback}`)
    return {
      url,
      referer: entry.pageUrl,
      filename: info.filename ?? entry.filename,
      width: info.width,
      height: info.height,
      resized: !useOriginal,
    }
  }

  /**
   * 丢掉某一页的解析结果。
   * 下载失败多是 H@H 主机不可达，重新请求图片页通常会换一台主机，比反复重试同一个地址有效。
   */
  invalidatePage(pageUrl: string): void {
    this.cache.memoryDelete(`image:${pageUrl}`)
  }

  private async getPageInfo(pageUrl: string, site: Site, signal?: AbortSignal): Promise<ImagePageInfo> {
    const cacheKey = `image:${pageUrl}`
    const cached = this.cache.memoryGet<ImagePageInfo>(cacheKey)
    if (cached) return cached

    const { html } = await this.http.fetchText(pageUrl, { signal })
    const info = parseImagePage(html, site)
    if (!info.mpv && !info.originalUrl && !info.resizedUrl) {
      throw new ImageUnavailableError('图片页结构无法识别，可能是站点改版或 Cookie 失效')
    }
    this.cache.memorySet(cacheKey, info, IMAGE_INFO_TTL_MS)
    return info
  }

  /** 取缩略图并按宽度重编码为 JPEG；失败返回 undefined */
  async thumbnailJpeg(url: string, signal?: AbortSignal): Promise<Buffer | undefined> {
    const cached = await this.cache.readThumb(url)
    if (cached) return cached

    try {
      // 缩略图走静态 CDN，不占用页面请求的间隔
      const { buffer } = await this.http.fetchBuffer(url, { signal, skipRateLimit: true })
      const resized = await resizeToJpeg(buffer, THUMBNAIL_WIDTH, THUMB_QUALITY)
      if (!resized) return undefined
      await this.cache.writeThumb(url, resized.buffer)
      return resized.buffer
    } catch (error) {
      if (signal?.aborted) return undefined
      logger.debug(`[缩略图] 获取失败: ${getErrorMessage(error)}`)
      return undefined
    }
  }
}
