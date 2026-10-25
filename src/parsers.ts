/**
 * 站点页面解析（纯函数，不做网络请求）。
 * 选择器集中在 constants.ts 的 SELECTORS 中，站点改版时只改一处。
 */
import { load, type CheerioAPI } from 'cheerio'
import { GALLERY_HREF_REGEX, SELECTORS, THUMB_PAGE_HREF_REGEX } from './constants'
import type {
  GalleryDetail,
  GalleryItem,
  GalleryPageEntry,
  GalleryTag,
  ImagePageInfo,
  SearchListing,
  Site,
} from './types'
import { singleLine } from './utils'

export type GalleryParseResult =
  | { ok: true; gallery: GalleryDetail }
  | { ok: false; reason: 'not-found' | 'expunged' | 'unknown' }

/** 以片段模式加载 HTML，避免 cheerio 自动补全 html/body 影响选择器 */
export function loadHtml(html: string): CheerioAPI {
  return load(html, null, false)
}

/** 绝对化站内链接 */
export function absoluteUrl(href: string | undefined, site: Site): string | undefined {
  if (!href) return undefined
  if (/^https?:\/\//i.test(href)) return href
  const origin = site === 'exhentai' ? 'https://exhentai.org' : 'https://e-hentai.org'
  return `${origin}${href.startsWith('/') ? '' : '/'}${href}`
}

/** 解析 "309.9 MiB" 形式的体积 */
export function parseSizeText(text: string | undefined): number | undefined {
  if (!text) return undefined
  const match = /([\d.]+)\s*(B|KiB|MiB|GiB|KB|MB|GB)/i.exec(text)
  if (!match) return undefined
  const value = parseFloat(match[1])
  if (!Number.isFinite(value)) return undefined
  const unit = match[2].toLowerCase()
  const factor =
    unit === 'b'
      ? 1
      : unit === 'kib' || unit === 'kb'
        ? 1024
        : unit === 'mib' || unit === 'mb'
          ? 1024 ** 2
          : 1024 ** 3
  return Math.round(value * factor)
}

/** 解析 "126 pages" 形式的页数；上传者名会与页数拼在一起，取紧邻 pages 的数字 */
export function parsePageCount(text: string | undefined): number | undefined {
  if (!text) return undefined
  const match = /(\d[\d,]*)\s*pages?\b/i.exec(text)
  if (!match) return undefined
  const value = parseInt(match[1].replace(/,/g, ''), 10)
  return Number.isFinite(value) ? value : undefined
}

/** 解析 "918 times" / "Favorited by 918 users" 形式的收藏数 */
export function parseFavCount(text: string | undefined): number | undefined {
  if (!text) return undefined
  const match = /([\d,]+)/.exec(text)
  if (!match) return undefined
  const value = parseInt(match[1].replace(/,/g, ''), 10)
  return Number.isFinite(value) ? value : undefined
}

/** 解析评分 */
export function parseRating(text: string | undefined): number | undefined {
  if (!text) return undefined
  // 详情页写作 "Average: 4.09"，列表页写作 "4.09 / 5"
  const match = /([\d.]+)\s*\/\s*5/.exec(text) ?? /([\d.]+)/.exec(text)
  if (!match) return undefined
  const value = parseFloat(match[1])
  if (!Number.isFinite(value) || value <= 0 || value > 5) return undefined
  return Math.round(value * 100) / 100
}

/** 解析 "parody:kung fu panda" 形式的标签 */
export function parseTag(title: string | undefined): GalleryTag | undefined {
  if (!title) return undefined
  const colon = title.indexOf(':')
  if (colon <= 0) return undefined
  return { namespace: title.slice(0, colon).trim(), name: title.slice(colon + 1).trim() }
}

/** 清理缩略图地址：站内相对地址补全，去掉占位图 */
function normalizeThumb(src: string | undefined, site: Site): string | undefined {
  if (!src || src.startsWith('data:')) return undefined
  if (src.includes('blank.gif') || src.includes('placeholder')) return undefined
  return absoluteUrl(src, site)
}

/** 解析画廊详情页 */
export function parseGalleryPage(html: string, site: Site, gid: number, token: string): GalleryParseResult {
  const $ = loadHtml(html)
  const title = singleLine($(SELECTORS.galleryTitle).text())
  if (!title) {
    const text = singleLine($('body').text())
    if (/Key missing, or incorrect key provided/i.test(text)) return { ok: false, reason: 'not-found' }
    if (/This gallery has been removed|This gallery is not available|expunged/i.test(text)) {
      return { ok: false, reason: 'expunged' }
    }
    return { ok: false, reason: 'unknown' }
  }

  const info = new Map<string, string>()
  $(SELECTORS.galleryInfoRows).each((_, row) => {
    const rowEl = $(row)
    const key = singleLine(rowEl.find(SELECTORS.galleryInfoKey).first().text()).replace(/[:：]\s*$/, '')
    const value = singleLine(rowEl.find(SELECTORS.galleryInfoValue).first().text())
    if (key) info.set(key.toLowerCase(), value)
  })

  const tags: GalleryTag[] = []
  let currentNamespace = ''
  $(`${SELECTORS.tagTable} tr`).each((_, row) => {
    const rowEl = $(row)
    const nsCell = rowEl.find(SELECTORS.tagNamespaceCell).first()
    if (nsCell.length) currentNamespace = singleLine(nsCell.text()).replace(/[:：]\s*$/, '')
    const tagCell = nsCell.length ? nsCell.next() : rowEl.find('td').first()
    tagCell.find('a').each((__, link) => {
      const linkEl = $(link)
      const href = linkEl.attr('href') || ''
      const match = /\/tag\/([^/]+)\/([^/?#]+)/.exec(href)
      const namespace = currentNamespace || match?.[1] || ''
      const name = singleLine(linkEl.text()) || (match ? decodeURIComponent(match[2]).replace(/_/g, ' ') : '')
      if (namespace && name) tags.push({ namespace, name })
    })
  })

  const category = singleLine($(SELECTORS.galleryCategory).first().text()) || 'Misc'
  const uploader = singleLine($(SELECTORS.galleryUploader).first().text())
  const pages = parsePageCount(info.get('length'))
  const fileSize = parseSizeText(info.get('file size'))
  const favoriteCount =
    parseFavCount($(SELECTORS.galleryFavCount).first().text()) ?? parseFavCount(info.get('favorited'))
  const parentHref = $(SELECTORS.galleryInfoRows)
    .filter((_, row) => singleLine($(row).find(SELECTORS.galleryInfoKey).first().text()).startsWith('Parent'))
    .find('a')
    .attr('href')
  const parentMatch = parentHref ? GALLERY_HREF_REGEX.exec(parentHref) : null
  const parentGid = parentMatch ? parseInt(parentMatch[1], 10) : undefined
  const archiverAvailable = $('#gd5 a')
    .toArray()
    .some((link) => /archive download/i.test($(link).text()))
  const rating = parseRating($('#rating_label').first().text())
  const ratingCount = parseFavCount($('#rating_count').first().text())
  // 封面写在 #gd1 > div 的 inline background 里
  const coverStyle = $(`${SELECTORS.galleryCover} div`).first().attr('style') || ''
  const coverMatch = /url\((['"]?)([^'")]+)\1\)/.exec(coverStyle)

  return {
    ok: true,
    gallery: {
      gid,
      token,
      site,
      title,
      titleJpn: singleLine($(SELECTORS.galleryTitleJpn).first().text()) || undefined,
      category,
      uploader: uploader || undefined,
      url: absoluteUrl(`/g/${gid}/${token}/`, site) as string,
      pages: pages ?? 0,
      fileSize,
      favoriteCount,
      parentGid,
      language: info.get('language') || undefined,
      visible: info.get('visible') || undefined,
      posted: info.get('posted') || undefined,
      rating,
      ratingCount,
      archiverAvailable,
      thumbUrl: coverMatch ? normalizeThumb(coverMatch[2], site) : undefined,
      tags,
    },
  }
}

/** 解析画廊页中的图廊缩略图，得到每页的图片页地址 */
export function parseGalleryPageEntries(html: string, site: Site): GalleryPageEntry[] {
  const $ = loadHtml(html)
  const entries: GalleryPageEntry[] = []
  $(SELECTORS.galleryThumbLinks).each((_, link) => {
    const linkEl = $(link)
    const href = linkEl.attr('href')
    const match = href ? THUMB_PAGE_HREF_REGEX.exec(href) : null
    if (!match) return
    const index = parseInt(match[3], 10)
    if (!Number.isFinite(index)) return
    const div = linkEl.find('div').first()
    const divTitle = singleLine(div.attr('title'))
    const filename = divTitle.replace(/^Page\s+\d+:\s*/i, '') || undefined
    const style = div.attr('style') || ''
    const thumbMatch = /url\((['"]?)([^'")]+)\1\)/.exec(style)
    entries.push({
      index,
      pageToken: match[1],
      pageUrl: absoluteUrl(href, site) as string,
      filename,
      thumbUrl: thumbMatch ? normalizeThumb(thumbMatch[2], site) : undefined,
    })
  })
  return entries.sort((a, b) => a.index - b.index)
}

/** 解析画廊页的分页器，返回可请求的图廊页 URL 列表 */
export function parseGalleryPager(html: string, site: Site): string[] {
  const $ = loadHtml(html)
  const urls = new Set<string>()
  $(SELECTORS.galleryPager).each((_, link) => {
    const href = $(link).attr('href')
    if (!href || href === '#') return
    const absolute = absoluteUrl(href, site)
    if (absolute) urls.add(absolute)
  })
  return [...urls]
}

/** 解析搜索 / 排行 / 收藏 / 热门列表页 */
export function parseSearchPage(html: string, site: Site, pageUrl: string): SearchListing {
  const $ = loadHtml(html)
  const results: GalleryItem[] = []

  $(SELECTORS.searchRows).each((_, row) => {
    const rowEl = $(row)
    const anchor = rowEl.find(SELECTORS.searchName).first()
    const href = anchor.attr('href')
    const match = href ? GALLERY_HREF_REGEX.exec(href) : null
    if (!match) return
    const gid = parseInt(match[1], 10)
    if (!Number.isFinite(gid)) return

    const title =
      singleLine(anchor.find(SELECTORS.searchNameText).first().text()) ||
      singleLine(anchor.text()) ||
      `gallery ${gid}`
    const category = singleLine(rowEl.find(SELECTORS.searchCategory).first().text())
    const thumbEl = rowEl.find(SELECTORS.searchThumb).first()
    const thumbSrc = thumbEl.attr('data-src') || thumbEl.attr('src')
    const tags: GalleryTag[] = []
    rowEl.find(SELECTORS.searchTags).each((__, tagEl) => {
      const tag = parseTag($(tagEl).attr('title'))
      if (tag) tags.push(tag)
    })

    // gl4c 里第一段是上传者、第二段是 "NNN pages"，整格取文本会把上传者名末尾的数字吞进来
    const metaCell = rowEl.find(SELECTORS.searchMeta).first()
    const metaDivs = metaCell.find('div')
    let pagesText = ''
    metaDivs.each((__, div) => {
      const text = singleLine($(div).text())
      if (/pages?/i.test(text)) pagesText = text
    })
    const pages = parsePageCount(pagesText || singleLine(metaCell.text()))
    const uploader = singleLine(metaDivs.first().text()) || undefined

    const rowText = singleLine(rowEl.text())
    const postedMatch = /(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/.exec(rowText)
    const ratingMatch = /([\d.]+)\s*\/\s*5/.exec(rowText)

    results.push({
      gid,
      token: match[2],
      title,
      category: category || 'Misc',
      url: absoluteUrl(href, site) as string,
      pages,
      uploader,
      thumbUrl: normalizeThumb(thumbSrc, site),
      posted: postedMatch?.[1],
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : undefined,
      tags,
    })
  })

  const nextHref = $(SELECTORS.searchNext).first().attr('href')
  const nextUrl = nextHref ? absoluteUrl(nextHref, site) : undefined
  const countText = singleLine($(SELECTORS.searchText).first().text()) || undefined

  return {
    results,
    nextUrl: nextUrl && nextUrl !== pageUrl ? nextUrl : undefined,
    countText,
  }
}

/** 解析图片页，取出原图与缩放版地址 */
export function parseImagePage(html: string, site: Site): ImagePageInfo {
  const $ = loadHtml(html)
  const img = $(SELECTORS.imageResized).first()
  const resizedUrl = img.attr('src') ? absoluteUrl(img.attr('src'), site) : undefined
  let originalUrl: string | undefined
  $(SELECTORS.imageLinks).each((_, link) => {
    const href = $(link).attr('href')
    if (href && href.includes('/fullimg/')) originalUrl = absoluteUrl(href, site)
  })

  const infoText = singleLine($(SELECTORS.imageInfo).first().text())
  const infoMatch = /^(.+?)\s*::\s*(\d+)\s*x\s*(\d+)\s*::\s*(.+)$/.exec(infoText)
  const mpv = !resizedUrl && !originalUrl && /multi-page viewer|mpv/i.test(singleLine($('body').text()))

  return {
    resizedUrl,
    originalUrl,
    filename: infoMatch ? infoMatch[1].trim() : undefined,
    width: infoMatch ? parseInt(infoMatch[2], 10) : undefined,
    height: infoMatch ? parseInt(infoMatch[3], 10) : undefined,
    sizeText: infoMatch ? infoMatch[4].trim() : undefined,
    mpv,
  }
}

/** 解析页面上的 "Found 361 results." 总数 */
export function parseResultTotal(countText: string | undefined): number | undefined {
  if (!countText) return undefined
  const match = /([\d,]+)\s+results?/i.exec(countText)
  if (!match) return undefined
  const value = parseInt(match[1].replace(/,/g, ''), 10)
  return Number.isFinite(value) ? value : undefined
}
