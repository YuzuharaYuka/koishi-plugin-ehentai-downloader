/**
 * 搜索、排行榜与热门列表的交互流程。
 */
import { h, type Element, type Session } from 'koishi'
import {
  CATEGORY_ALIASES,
  CATEGORY_BITS,
  LANGUAGE_ALIASES,
  LANGUAGE_QUERY,
  MESSAGES,
  type MenuStyle,
  TOPLIST_ALIASES,
  TOPLIST_LABELS,
  TOPLIST_TL,
} from '../constants'
import type { EhPlugin } from '../plugin'
import type { SearchResult } from '../services/gallery'
import { decodeImage, releaseImage } from '../services/image-codec'
import type { MenuListItem } from '../services/menu'
import type { GalleryItem } from '../types'
import { formatNetworkError, getErrorMessage, logger } from '../utils'
import {
  mapLimit,
  promptAnswer,
  renderListHeader,
  renderListItem,
  renderPrompt,
  sendResult,
  sessionKey,
  supportsForward,
} from './common'

const NEXT_INPUT = /^(f+|下一页|下页|下|翻页|next|more)$/i
const PREV_INPUT = /^(b+|上一页|上页|上|prev|back)$/i
const EXIT_INPUT = /^(n+|q|退出|取消|结束|exit|quit)$/i

const TOPLIST_PAGE_SIZE = 50
const THUMBNAIL_CONCURRENCY = 6

export interface SearchRequest {
  query: string
  language?: string
  category?: string
}

interface ListingSource {
  first: SearchResult
  hasMore(current: SearchResult): boolean
  next(current: SearchResult): Promise<SearchResult | undefined>
  emptyHint?: string
}

interface ListingOptions {
  label?: string
  limit?: number
  showTags?: boolean
  useForward?: boolean
  menuStyle?: MenuStyle
  total?: number
}

function normalizeLanguage(input: string | undefined): string {
  if (!input) return 'all'
  const key = input.trim().toLowerCase()
  return LANGUAGE_ALIASES[key] ?? 'all'
}

/** 把 -c 指定的分类转换为 EH 的 f_cats 排除位 */
export function buildCategoryMask(input: string | undefined): { mask?: number, error?: string } {
  if (!input) return {}
  const names = input.split(/[,，\s]+/).filter(Boolean)
  let selected = 0
  for (const name of names) {
    const key = name.trim().toLowerCase()
    const normalized = CATEGORY_ALIASES[key] ?? (CATEGORY_BITS[key as keyof typeof CATEGORY_BITS] ? key : undefined)
    if (!normalized) {
      return { error: `无法识别的分类：${name}。可用分类为 misc、doujinshi、manga、artist-cg、game-cg、image-set、cosplay、asian-porn、non-h、western。` }
    }
    selected |= CATEGORY_BITS[normalized as keyof typeof CATEGORY_BITS]
  }
  const all = Object.values(CATEGORY_BITS).reduce((sum, bit) => sum | bit, 0)
  const mask = all & ~selected
  return mask ? { mask } : {}
}

async function loadFirstPage(session: Session, plugin: EhPlugin, request: SearchRequest): Promise<SearchResult | undefined> {
  const category = buildCategoryMask(request.category)
  if (category.error) {
    await session.send(category.error)
    return undefined
  }
  const language = normalizeLanguage(request.language)
  const query = [request.query.trim(), LANGUAGE_QUERY[language as keyof typeof LANGUAGE_QUERY] ?? '']
    .filter(Boolean)
    .join(' ')
  if (!query && !category.mask) {
    await session.send(MESSAGES.emptySearchQuery)
    return undefined
  }

  try {
    const result = await plugin.galleries.search(query, undefined, undefined, category.mask)
    if (!result.items.length) {
      await session.send(MESSAGES.noResults)
      return undefined
    }
    return result
  } catch (error) {
    logger.warn(`[搜索] 搜索失败: ${getErrorMessage(error)}`)
    await session.send(`搜索失败：${formatNetworkError(error)}。请稍后重试。`)
    return undefined
  }
}

export async function handleSearch(session: Session, plugin: EhPlugin, request: SearchRequest, display: ListingOptions = {}): Promise<void> {
  const first = await loadFirstPage(session, plugin, request)
  if (!first) return
  const source: ListingSource = {
    first,
    hasMore: (current) => Boolean(current.nextUrl),
    next: async (current) => {
      if (!current.nextUrl) return undefined
      try {
        return await plugin.galleries.searchUrl(current.nextUrl, current.site)
      } catch (error) {
        logger.warn(`[搜索] 翻页失败: ${getErrorMessage(error)}`)
        return undefined
      }
    },
  }
  await runListing(session, plugin, source, { ...display, total: first.total })
}

function resolveToplistType(input: string | undefined): string | undefined {
  if (!input) return 'all-time'
  return TOPLIST_ALIASES[input.trim().toLowerCase()]
}

export async function handleToplist(session: Session, plugin: EhPlugin, typeInput: string | undefined, page: number): Promise<void> {
  const type = resolveToplistType(typeInput)
  if (!type) {
    const names = Object.keys(TOPLIST_LABELS).join('、')
    await session.send(`无法识别的排行榜类型。可用类型为：${names}。`)
    return
  }
  const tl = TOPLIST_TL[type as keyof typeof TOPLIST_TL]
  let first: SearchResult
  try {
    first = await plugin.galleries.toplist(tl, Math.max(1, page))
  } catch (error) {
    logger.warn(`[榜单] 获取排行榜失败: ${getErrorMessage(error)}`)
    await session.send(`获取排行榜失败：${formatNetworkError(error)}。请稍后重试。`)
    return
  }
  if (!first.items.length) {
    await session.send(MESSAGES.noResults)
    return
  }
  let nextPage = Math.max(1, page) + 1
  const source: ListingSource = {
    first,
    hasMore: (current) => current.items.length >= TOPLIST_PAGE_SIZE,
    next: async () => {
      try {
        const result = await plugin.galleries.toplist(tl, nextPage)
        if (!result.items.length) return undefined
        nextPage++
        return result
      } catch (error) {
        logger.warn(`[榜单] 翻页失败: ${getErrorMessage(error)}`)
        return undefined
      }
    },
  }
  await runListing(session, plugin, source, { label: TOPLIST_LABELS[type as keyof typeof TOPLIST_LABELS] })
}

export async function handlePopular(session: Session, plugin: EhPlugin): Promise<void> {
  let first: SearchResult
  try {
    first = await plugin.galleries.popular()
  } catch (error) {
    logger.warn(`[热门] 获取热门列表失败: ${getErrorMessage(error)}`)
    await session.send(`获取热门列表失败：${formatNetworkError(error)}。请稍后重试。`)
    return
  }
  if (!first.items.length) {
    await session.send(MESSAGES.noResults)
    return
  }
  const source: ListingSource = {
    first,
    hasMore: () => false,
    next: async () => undefined,
  }
  await runListing(session, plugin, source, { label: '热门' })
}

/** 列表交互主循环 */
async function runListing(session: Session, plugin: EhPlugin, source: ListingSource, options: ListingOptions = {}): Promise<void> {
  const config = plugin.config
  const pages: SearchResult[] = [source.first]
  const menuStyle = options.menuStyle ?? config.menuStyle
  const useMenu = menuStyle !== 'text'
  let index = 0
  let misses = 0
  let needRender = true

  while (true) {
    const current = pages[index]
    if (!current) {
      await session.send(MESSAGES.searchPageInvalid)
      return
    }
    const displayLimit = options.limit ?? config.searchResultLimit
    const limit = Math.min(displayLimit, current.items.length)
    const items = current.items.slice(0, limit)
    const hasPrev = index > 0
    const hasNext = index < pages.length - 1 || source.hasMore(current)
    const forward = (options.useForward ?? config.useForwardForList) && supportsForward(session)

    if (needRender) {
      if (useMenu) {
        const rendered = await buildListingMenu(plugin, items, index + 1, index + 1 + (hasNext ? 1 : 0), hasPrev, hasNext, options, menuStyle)
        if (rendered) {
          await session.send(h.image(rendered, 'image/jpeg'))
        } else {
          await sendResult(session, buildListingNodes(plugin, items, index + 1, hasPrev, hasNext, options), forward)
        }
      } else {
        await sendResult(session, buildListingNodes(plugin, items, index + 1, hasPrev, hasNext, options), forward)
      }
      needRender = false
    }
    plugin.listings.save(sessionKey(session), items, index + 1)

    const input = await promptInput(session, config.promptTimeout)
    if (input === undefined) {
      await session.send(MESSAGES.promptTimeout)
      return
    }
    const text = input.trim()
    if (!text) continue
    misses = 0
    if (EXIT_INPUT.test(text)) return

    if (NEXT_INPUT.test(text)) {
      if (!hasNext) {
        await session.send(MESSAGES.noMoreResults)
        continue
      }
      if (index + 1 < pages.length) {
        index++
      } else {
        const next = await source.next(current)
        if (!next) {
          await session.send(MESSAGES.noMoreResults)
          continue
        }
        pages.push(next)
        index++
      }
      needRender = true
      continue
    }

    if (PREV_INPUT.test(text)) {
      if (!hasPrev) {
        await session.send('已经是第一页了。')
        continue
      }
      index--
      needRender = true
      continue
    }

    const choice = Number.parseInt(text, 10)
    if (!Number.isInteger(choice) || choice < 1 || choice > limit) {
      if (++misses >= 2) {
        await session.send(`连续输错两次，已退出。回复 1-${limit} 选择，或重新搜索。`)
        return
      }
      await session.send(`回复 1-${limit} 下载，F 下一页，B 上一页，N 退出。`)
      continue
    }
    const target = items[choice - 1]
    await session.execute(`eh.download ${target.url}`)
    return
  }
}

async function promptInput(session: Session, timeoutSeconds: number): Promise<string | undefined> {
  try {
    return await promptAnswer(session, timeoutSeconds * 1000)
  } catch (error) {
    logger.debug(`[搜索] 交互结束: ${getErrorMessage(error)}`)
    return undefined
  }
}

/** 文字列表（不支持图片或菜单渲染失败时的回退） */
function buildListingNodes(
  plugin: EhPlugin,
  items: GalleryItem[],
  page: number,
  hasPrev: boolean,
  hasNext: boolean,
  options: ListingOptions,
): Element[] {
  const config = plugin.config
  const showTags = options.showTags ?? config.showTags
  const nodes: Element[] = []
  const header = renderListHeader(page, 1, items.length, options.total ?? items.length, options.label ? `（${options.label}）` : undefined)
  nodes.push(h('p', {}, header))

  items.forEach((item, i) => nodes.push(renderListItem(item, i + 1, { showTags })))
  nodes.push(h('p', {}, renderPrompt(hasPrev, hasNext)))
  return nodes
}

/** 图片菜单；任一步失败返回 undefined，由调用方回退文字列表 */
async function buildListingMenu(
  plugin: EhPlugin,
  items: GalleryItem[],
  page: number,
  pageCount: number,
  hasPrev: boolean,
  hasNext: boolean,
  options: ListingOptions,
  menuStyle: MenuStyle = 'card',
): Promise<Buffer | undefined> {
  try {
    const covers = await mapLimit(items, THUMBNAIL_CONCURRENCY, async (item) => {
      if (!item.thumbUrl) return undefined
      const jpeg = await plugin.images.thumbnailJpeg(item.thumbUrl)
      if (!jpeg) return undefined
      return decodeImage(jpeg)
    })
    const entries: MenuListItem[] = items.map((item, index) => ({ item, cover: covers[index] }))
    const render = menuStyle === 'grid' ? plugin.menu.renderGrid.bind(plugin.menu) : plugin.menu.renderList.bind(plugin.menu)
    try {
      const rendered = await render(entries, {
        label: options.label,
        page,
        pageCount,
        total: options.total,
        hasPrev,
        hasNext,
        showTags: options.showTags ?? plugin.config.showTags,
      })
      return rendered.buffer
    } finally {
      for (const cover of covers) releaseImage(cover)
    }
  } catch (error) {
    logger.warn(`[搜索] 菜单渲染失败，回退文字列表: ${getErrorMessage(error)}`)
    return undefined
  }
}
