/**
 * 交互层通用工具：统一的回复格式、列表渲染与选项解析。
 */
import { h, type Element, type Session } from 'koishi'
import type { Config } from '../config'
import {
  CATEGORY_DISPLAY,
  FORWARD_SUPPORTED_PLATFORMS,
  MESSAGES,
  NAMESPACE_DISPLAY,
  RESULT_TITLE_LIMIT,
  TAG_DISPLAY_LIMIT,
} from '../constants'
import type { GalleryDetail, GalleryItem, OutputFormat } from '../types'
import { formatBytes, formatCount, formatDuration, singleLine, truncate } from '../utils'

export interface DisplayOptions {
  showTags: boolean
  tagLimit?: number
}

/** 会话级任务标识：同一群/私聊中的同一用户 */
export function sessionKey(session: Session): string {
  return `${session.platform}:${session.guildId ?? session.channelId ?? ''}:${session.userId ?? ''}`
}

/**
 * 等待同一用户的下一条消息。群里别人说话不会打断交互，消息本身照常向下传递。
 * 超时返回 undefined。
 */
export async function promptAnswer(session: Session, timeoutMs: number): Promise<string | undefined> {
  const ownerId = session.userId
  while (true) {
    const value: string | null | undefined = await session.prompt((incoming: Session) => {
      if (ownerId && incoming.userId !== ownerId) return null
      const text = (incoming.elements ?? []).join('').trim()
      return text || null
    }, { timeout: timeoutMs })
    if (value === undefined) return undefined
    if (value === null) continue
    return String(value).trim()
  }
}

export function quote(session: Session): string {
  return session.messageId ? `<quote id="${session.messageId}"/>` : ''
}

function categoryLabel(category?: string): string {
  if (!category) return '未知分类'
  return CATEGORY_DISPLAY[category as keyof typeof CATEGORY_DISPLAY] ?? category
}

function tagLine(tags: GalleryItem['tags'], limit: number): string | undefined {
  if (!tags.length) return undefined
  const shown = tags.slice(0, limit).map((tag) => {
    const ns = NAMESPACE_DISPLAY[tag.namespace as keyof typeof NAMESPACE_DISPLAY] ?? tag.namespace
    return `${ns}:${tag.name}`
  })
  const extra = tags.length > limit ? ` 等 ${tags.length} 个` : ''
  return `标签 ${shown.join('、')}${extra}`
}

/** 搜索结果中的单条画廊（编号与标题一行，细节缩进） */
export function renderListItem(item: GalleryItem, index: number, options: DisplayOptions, siteLabel?: string): Element {
  const title = truncate(singleLine(item.title), RESULT_TITLE_LIMIT)
  const meta: string[] = []
  if (item.uploader) meta.push(`上传 ${singleLine(item.uploader)}`)
  if (item.pages) meta.push(`${item.pages} 页`)
  if (item.rating) meta.push(`${item.rating.toFixed(1)} 分`)
  const tags = options.showTags ? tagLine(item.tags, options.tagLimit ?? TAG_DISPLAY_LIMIT) : undefined
  const lines: string[] = []
  lines.push(`${index}. [${categoryLabel(item.category)}]${siteLabel ? ` (${siteLabel})` : ''} ${title}`)
  if (meta.length) lines.push(`   ${meta.join(' · ')}`)
  if (tags) lines.push(`   ${tags}`)
  lines.push(`   ${item.url}`)
  return h('p', {}, lines.join('\n'))
}

export function renderListHeader(page: number, start: number, end: number, count: number, extra?: string): string {
  const head = `当前第 ${page} 页（显示第 ${start}-${end} 项，共 ${count} 项）`
  return extra ? `${head} ${extra}` : head
}

export function renderPrompt(hasPrev: boolean, hasNext: boolean): string {
  const options: string[] = ['回复序号下载']
  if (hasPrev) options.push('[B]上一页')
  if (hasNext) options.push('[F]下一页')
  options.push('[N]退出')
  return options.join('，') + '。'
}

/** 画廊详情（下载开始前的回执） */
export function renderGalleryInfo(gallery: GalleryDetail, options: DisplayOptions): Element {
  const lines: string[] = []
  lines.push(singleLine(gallery.title))
  if (gallery.titleJpn && gallery.titleJpn !== gallery.title) lines.push(singleLine(gallery.titleJpn))
  const meta: string[] = [`ID ${gallery.gid}`, categoryLabel(gallery.category)]
  if (gallery.pages) meta.push(`${gallery.pages} 页`)
  lines.push(meta.join(' '))
  const extra: string[] = []
  if (gallery.uploader) extra.push(`上传 ${singleLine(gallery.uploader)}`)
  if (gallery.fileSize) extra.push(formatBytes(gallery.fileSize))
  if (gallery.favoriteCount) extra.push(`收藏 ${formatCount(gallery.favoriteCount)}`)
  if (gallery.language) extra.push(singleLine(gallery.language))
  if (extra.length) lines.push(extra.join(' · '))
  if (gallery.posted) extra.push(singleLine(gallery.posted))
  if (options.showTags) {
    const tags = tagLine(gallery.tags, options.tagLimit ?? TAG_DISPLAY_LIMIT)
    if (tags) lines.push(tags)
  }
  lines.push(gallery.url)
  return h('p', {}, lines.join('\n'))
}

export function formatOutcomeSummary(pages: number, elapsedMs: number): string {
  return `${pages} 页，耗时 ${formatDuration(elapsedMs)}`
}

export function formatFailedPages(indexes: number[]): string {
  return indexes.length > 8
    ? `${indexes.slice(0, 8).join(', ')} 等 ${indexes.length} 页`
    : indexes.join(', ')
}

/** 平台是否支持合并转发 */
export function supportsForward(session: Session): boolean {
  return FORWARD_SUPPORTED_PLATFORMS.includes(session.platform)
}

export async function sendResult(session: Session, content: Element | Element[] | string, forward: boolean): Promise<void> {
  if (forward) {
    const nodes = Array.isArray(content) ? content : [h('p', {}, String(content))]
    await session.send(h('message', { forward: true }, nodes))
    return
  }
  await session.send(content as Element | Element[])
}

/** 解析 -r 页码范围，如 "1-20"、"1,3,5"、"1-5,8" */
export function parsePageRange(input: string | undefined, totalPages: number): { indexes?: number[], error?: string } {
  if (!input) return {}
  const indexes = new Set<number>()
  for (const part of input.split(/[,，\s]+/)) {
    if (!part) continue
    const match = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!match) return { error: `无法解析页码范围：${part}` }
    const start = parseInt(match[1], 10)
    const end = match[2] ? parseInt(match[2], 10) : start
    if (!start || start > end) return { error: `无法解析页码范围：${part}` }
    if (totalPages && end > totalPages) return { error: `页码超出范围：${part}（共 ${totalPages} 页）` }
    for (let index = start; index <= end; index++) {
      if (index > 5000) return { error: '页码范围过大，请缩小范围。' }
      indexes.add(index)
    }
  }
  const sorted = [...indexes].sort((a, b) => a - b)
  return sorted.length ? { indexes: sorted } : {}
}

export function resolveOutputFormat(config: Config, flags: { pdf?: boolean, zip?: boolean, image?: boolean }): OutputFormat {
  if (flags.pdf) return 'pdf'
  if (flags.zip) return 'zip'
  if (flags.image) return 'img'
  return config.defaultFormat
}

/** 分类参数转成 EH 的 f_cats 排除位：-c 指定要保留的分类 */
export const CATEGORY_FILTER_HINT = '可用分类: misc, doujinshi, manga, artist-cg, game-cg, image-set, cosplay, asian-porn, non-h, western'

/** 并发受限的 map */
export async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const size = Math.max(1, Math.min(limit, items.length))
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

export function formatBytesOrEmpty(bytes?: number): string | undefined {
  return bytes ? formatBytes(bytes) : undefined
}

export function formatProgressText(downloaded: number, total: number, failed: number): string {
  const parts = [`${downloaded}/${total}`]
  if (failed) parts.push(`失败 ${failed}`)
  return parts.join(' · ')
}

export function formatPasswordLine(password?: string): string {
  return password ? `密码 ${password}` : ''
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function gallerySiteLabel(gallery: GalleryDetail): string | undefined {
  return gallery.site === 'exhentai' ? '里站' : undefined
}

export { MESSAGES }
