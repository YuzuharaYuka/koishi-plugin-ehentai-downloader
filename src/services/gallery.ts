/**
 * 画廊相关请求：搜索、详情解析、token 反查、图廊分页。
 */
import type { Config } from '../config'
import type { GalleryDetail, GalleryItem, GalleryPageEntry, GalleryPageList, Site } from '../types'
import {
  GALLERY_THUMBS_PER_PAGE,
  GALLERY_URL_REGEX,
  GID_REGEX,
  IMAGE_URL_REGEX,
  SEARCH_PAGE_SIZE,
} from '../constants'
import {
  parseGalleryPage,
  parseGalleryPageEntries,
  parseGalleryPager,
  parseResultTotal,
  parseSearchPage,
} from '../parsers'
import { getErrorMessage, logger } from '../utils'
import type { CacheStore } from './cache'
import { EhHttpClient, SiteAuthError } from './http'

export interface SearchResult {
  items: GalleryItem[]
  nextUrl?: string
  total?: number
  site: Site
  pageUrl: string
}

export class GalleryNotFoundError extends Error {
  constructor(message = '画廊不存在或已被删除') {
    super(message)
    this.name = 'GalleryNotFoundError'
  }
}

export class GalleryExpungedError extends Error {
  constructor(message = '该画廊已被删除（Expunged）') {
    super(message)
    this.name = 'GalleryExpungedError'
  }
}

export class GalleryUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GalleryUnsupportedError'
  }
}

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
/** 翻页枚举的并发度：限流器控制节奏，这里只决定同时在途的请求数 */
const PAGER_CONCURRENCY = 4

const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000

export class GalleryService {
  constructor(
    private readonly http: EhHttpClient,
    private readonly config: Config,
    private readonly cache: CacheStore,
  ) {}

  /** 按优先级排列候选站点；显式选择站点时只用一个 */
  private siteCandidates(preferred?: Site): Site[] {
    if (this.config.site !== 'auto') return [this.config.site]
    const primary = this.http.primarySite
    const list: Site[] = preferred ? [preferred] : [primary]
    if (preferred && preferred !== primary) list.push(primary)
    for (const site of ['exhentai', 'e-hentai'] as Site[]) {
      if (!list.includes(site)) list.push(site)
    }
    return list
  }

  private galleryUrl(site: Site, gid: number, token: string): string {
    return `${this.http.origin(site)}/g/${gid}/${token}/`
  }

  /** 逐站点尝试，只在登录/权限类错误时切换站点 */
  private async withSiteFallback<T>(preferred: Site | undefined, run: (site: Site) => Promise<T>): Promise<T> {
    const candidates = this.siteCandidates(preferred)
    let lastError: unknown
    for (const [index, site] of candidates.entries()) {
      try {
        return await run(site)
      } catch (error) {
        lastError = error
        if (!(error instanceof SiteAuthError) || index === candidates.length - 1) throw error
        logger.debug(`[画廊] ${site} 访问失败，尝试备用站点: ${getErrorMessage(error)}`)
      }
    }
    throw lastError
  }

  /** 解析输入：画廊链接、图片页链接、纯 gid */
  async resolve(input: string, signal?: AbortSignal): Promise<GalleryDetail> {
    const trimmed = input.trim()
    if (!trimmed) throw new GalleryNotFoundError('输入为空')

    if (/\/mpv\//i.test(trimmed)) {
      throw new GalleryUnsupportedError('该链接是多页查看器（MPV）地址，当前账号没有权限，无法下载。')
    }

    const imageMatch = IMAGE_URL_REGEX.exec(trimmed)
    if (imageMatch) {
      const gid = parseInt(imageMatch[2], 10)
      const site = this.http.siteOfUrl(trimmed)
      const token = await this.resolveTokenFromImagePage(trimmed, gid, signal)
      return this.loadGallery(site, gid, token, signal)
    }

    const urlMatch = GALLERY_URL_REGEX.exec(trimmed)
    if (urlMatch) {
      const gid = parseInt(urlMatch[1], 10)
      const token = urlMatch[2]
      const site = this.http.siteOfUrl(trimmed)
      return this.loadGallery(site, gid, token, signal)
    }

    if (GID_REGEX.test(trimmed)) {
      const gid = parseInt(trimmed, 10)
      const resolved = await this.withSiteFallback(undefined, async (site) => {
        const listing = await this.search(`gid:${gid}`, signal, site)
        const hit = listing.items.find((item) => item.gid === gid)
        if (!hit) throw new GalleryNotFoundError()
        return { site, token: hit.token }
      })
      return this.loadGallery(resolved.site, gid, resolved.token, signal)
    }

    throw new GalleryNotFoundError('无法识别的输入')
  }

  /** 从图片页 HTML 中反查画廊 token（图片页自身不暴露 token） */
  private async resolveTokenFromImagePage(imageUrl: string, gid: number, signal?: AbortSignal): Promise<string> {
    const { html } = await this.http.fetchText(imageUrl, { signal })
    const pattern = new RegExp(`/g/${gid}/([0-9a-z]+)/`, 'i')
    const match = pattern.exec(html)
    if (!match) throw new GalleryNotFoundError('无法从图片页反查画廊 token')
    return match[1]
  }

  private async loadGallery(site: Site | undefined, gid: number, token: string, signal?: AbortSignal): Promise<GalleryDetail> {
    return this.withSiteFallback(site, async (targetSite) => {
      const cacheKey = `gallery:${targetSite}:${gid}`
      const cached = this.cache.memoryGet<GalleryDetail>(cacheKey)
      if (cached) return cached

      const url = this.galleryUrl(targetSite, gid, token)
      const { html } = await this.http.fetchText(url, { signal })
      const parsed = parseGalleryPage(html, targetSite, gid, token)
      if (!parsed.ok) {
        if (parsed.reason === 'expunged') throw new GalleryExpungedError()
        if (parsed.reason === 'not-found') throw new GalleryNotFoundError()
        throw new GalleryNotFoundError('页面结构无法识别，可能是站点改版或 Cookie 失效')
      }
      this.cache.memorySet(cacheKey, parsed.gallery, DETAIL_CACHE_TTL_MS)
      // 翻页枚举要复用这份 HTML，避免把同一页再请求一遍
      this.cache.memorySet(`galleryHtml:${targetSite}:${gid}`, html, 60_000)
      const gallery = parsed.gallery
      logger.debug(`[画廊] ${gallery.gid} ${gallery.category ?? '?'} ${gallery.pages ?? '?'} 页 ${gallery.tags.length} 标签`)
      return gallery
    })
  }

  /** 关键词搜索（第一页）；hiddenCats 为 EH 的 f_cats 排除位掩码 */
  async search(query: string, signal?: AbortSignal, site?: Site, hiddenCats?: number): Promise<SearchResult> {
    const trimmed = query.trim()
    const candidates = this.siteCandidates(site)
    let lastError: unknown
    for (const [index, candidate] of candidates.entries()) {
      try {
        const params = [`f_search=${encodeURIComponent(trimmed)}`]
        if (hiddenCats) params.push(`f_cats=${hiddenCats}`)
        const url = `${this.http.origin(candidate)}/?${params.join('&')}`
        return await this.searchUrl(url, candidate, signal)
      } catch (error) {
        lastError = error
        if (!(error instanceof SiteAuthError) || index === candidates.length - 1) throw error
        logger.debug(`[搜索] ${candidate} 访问失败，尝试备用站点: ${getErrorMessage(error)}`)
      }
    }
    throw lastError
  }

  /** 请求一个列表页（搜索、翻页、排行都复用） */
  async searchUrl(url: string, site: Site, signal?: AbortSignal): Promise<SearchResult> {
    const cacheKey = `search:${url}`
    const cached = this.cache.memoryGet<SearchResult>(cacheKey)
    if (cached) return cached

    const { html, finalUrl } = await this.http.fetchText(url, { signal })
    const actualSite = this.http.siteOfUrl(finalUrl) ?? site
    const listing = parseSearchPage(html, actualSite, finalUrl)
    const result: SearchResult = {
      items: listing.results,
      nextUrl: listing.nextUrl,
      total: parseResultTotal(listing.countText),
      site: actualSite,
      pageUrl: finalUrl,
    }
    this.cache.memorySet(cacheKey, result, SEARCH_CACHE_TTL_MS)
    logger.debug(`[列表] ${actualSite} 解析 ${result.items.length} 条，下一页 ${result.nextUrl ? '有' : '无'}`)
    return result
  }

  /** 排行榜（仅表站提供，参数 tl 见 TOPLIST_TL） */
  async toplist(tl: number, page = 1, signal?: AbortSignal): Promise<SearchResult> {
    const url = `${this.http.origin('e-hentai')}/toplist.php?tl=${tl}&p=${page}`
    return this.searchUrl(url, 'e-hentai', signal)
  }

  /** 热门（仅表站提供） */
  async popular(signal?: AbortSignal): Promise<SearchResult> {
    const url = `${this.http.origin('e-hentai')}/popular`
    return this.searchUrl(url, 'e-hentai', signal)
  }

  /** 取出 gallery 的图廊页面条目，最多 needed 页 */
  async getPages(gallery: GalleryDetail, needed: number, signal?: AbortSignal): Promise<GalleryPageList> {
    const target = Math.max(1, needed)
    const entries = new Map<number, GalleryPageEntry>()
    const collect = (html: string) => {
      for (const entry of parseGalleryPageEntries(html, gallery.site)) {
        if (!entries.has(entry.index)) entries.set(entry.index, entry)
      }
      return this.maxPagerPage(parseGalleryPager(html, gallery.site))
    }

    // 画廊首页刚解析过，直接复用缓存里的 HTML
    const cached = this.cache.memoryGet<string>(`galleryHtml:${gallery.site}:${gallery.gid}`)
    const firstHtml = cached ?? (await this.http.fetchText(gallery.url, { signal })).html
    const maxPagerPage = Math.max(1, collect(firstHtml))

    // 剩余分页彼此独立：按小并发并行请求，节奏仍由限流器控制
    const wanted = Math.min(maxPagerPage, Math.max(1, Math.ceil(target / GALLERY_THUMBS_PER_PAGE)))
    const rest = Array.from({ length: Math.max(0, wanted - 1) }, (_, index) => index + 1)
    if (rest.length && entries.size < target) {
      const started = Date.now()
      await this.mapLimit(rest, PAGER_CONCURRENCY, async (pageIndex: number) => {
        if (entries.size >= target) return
        const { html } = await this.http.fetchText(`${gallery.url}?p=${pageIndex}`, { signal })
        collect(html)
      })
      logger.debug(`[分页] 共 ${wanted} 页，用时 ${Date.now() - started}ms`)
    }

    const list = [...entries.values()].sort((a, b) => a.index - b.index)
    return {
      entries: list.slice(0, target),
      totalPages: Math.max(gallery.pages ?? 0, list.length),
    }
  }

  private async mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++]
        await fn(item)
      }
    })
    await Promise.all(workers)
  }

  private maxPagerPage(urls: string[]): number {
    let max = 1
    for (const url of urls) {
      const match = /[?&]p=(\d+)/.exec(url)
      if (match) max = Math.max(max, parseInt(match[1], 10) + 1)
    }
    return max
  }

  /** 搜索页分页大小提示（用于交互文案） */
  get pageSize(): number {
    return SEARCH_PAGE_SIZE
  }
}
