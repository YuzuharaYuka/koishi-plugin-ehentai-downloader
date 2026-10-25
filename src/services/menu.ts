/**
 * 图片菜单：把搜索结果与画廊详情渲染成一张 JPEG。
 * 版式参考 E-Hentai 网页端：米色底、深红描边表格、分类色块、标签胶囊；
 * 列表提供扩展型（逐行缩略图 + 标签）与缩略图型（三列封面）两种，详情按命名空间分组标签。
 */
import { type Canvas, type Image, type SKRSContext2D, createCanvas } from '@napi-rs/canvas'
import { MENU_JPEG_QUALITY, MENU_WIDTH, TAG_DISPLAY_LIMIT } from '../constants'
import type { GalleryDetail, GalleryItem } from '../types'
import { formatBytes, formatCount, singleLine } from '../utils'

const FONT = 'Arial, "Microsoft YaHei", "Malgun Gothic", "MS Gothic", sans-serif'

/** 站点配色，取自 e-hentai.org 的 g.css */
const STYLE = {
  pageBg: '#e3e0d1',
  frame: '#5c0d12',
  headerBg: '#e0ded3',
  rowEven: '#f2f0e4',
  rowOdd: '#edebdf',
  text: '#5c0d11',
  title: '#8f4701',
  dim: '#8f6063',
  sep: '#d9d7cc',
  tagBg: '#f2efdf',
  tagBorder: '#806769',
  badgeText: '#f1f1f1',
  indexBg: '#5c0d12',
  tagHeight: 22,
  tagRadius: 5,
} as const

/** 分类色块（ct1..ct9 的径向渐变近似成线性） */
const CATEGORY_GRADIENT: Record<string, [string, string]> = {
  Misc: ['#707070', '#9e9e9e'],
  Doujinshi: ['#fc4e4e', '#f26f5f'],
  Manga: ['#e78c1a', '#fcb417'],
  'Artist CG': ['#c7bf07', '#dde500'],
  'Game CG': ['#1a9317', '#05bf0b'],
  'Image Set': ['#2756aa', '#5f5fff'],
  Cosplay: ['#8800c3', '#9755f5'],
  'Asian Porn': ['#b452a5', '#fe93ff'],
  'Non-H': ['#0f9ebd', '#08d7e2'],
  Western: ['#8a6b12', '#c9a227'],
}
const CATEGORY_FALLBACK: [string, string] = ['#5c0d12', '#8f4701']

/** 标签命名空间的中文前缀，避免单字母缩写看不懂 */
const NAMESPACE_LABEL: Record<string, string> = {
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
  temp: '临时',
}

/** 标签分组的展示顺序，和站点 #gd4 的 tc 行一致 */
const TAG_GROUP_ORDER = [
  'parody', 'character', 'artist', 'group', 'cosplayer',
  'female', 'male', 'mixed', 'other', 'language', 'reclass', 'temp',
]

interface TagChip { text: string, width: number, textWidth: number, x: number, row: number }
interface TagGroup { ns: string, label: string, rows: number, items: TagChip[] }

const MARGIN = 16
const HEADER_HEIGHT = 78
const FOOTER_HEIGHT = 52
const ROW_HEIGHT = 162
const THUMB_WIDTH = 108
const THUMB_HEIGHT = ROW_HEIGHT - 18
const INDEX_BOX = 32
/** 扩展型：缩略图右侧的元信息列，再右侧才是标题与标签 */
const INFO_WIDTH = 104
const GRID_COLUMNS = 3
const GRID_CARD_WIDTH = 278
const GRID_CARD_HEIGHT = 396
const GRID_GAP = 16
const GRID_THUMB_HEIGHT = 300

export interface MenuListItem {
  item: GalleryItem
  /** 已解码的缩略图，缺失时画占位 */
  cover?: Image
}

export interface ListMenuOptions {
  /** 搜索结果 / 排行榜 / 热门 */
  label?: string
  page: number
  pageCount: number
  total?: number
  hasPrev: boolean
  hasNext: boolean
  showTags: boolean
}

export interface RenderedMenu {
  buffer: Buffer
  width: number
  height: number
}

export class MenuRenderer {
  /** 搜索结果列表：一行一个画廊，左侧缩略图，中间标题与标签，右侧分类与元信息 */
  async renderList(entries: MenuListItem[], options: ListMenuOptions): Promise<RenderedMenu> {
    const rows = Math.max(1, entries.length)
    const tableTop = HEADER_HEIGHT
    const tableHeight = rows * ROW_HEIGHT
    const height = tableTop + tableHeight + FOOTER_HEIGHT + MARGIN

    const canvas = createCanvas(MENU_WIDTH, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = STYLE.pageBg
    ctx.fillRect(0, 0, MENU_WIDTH, height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    this.paintHeader(ctx, options, entries.length)
    this.paintFrame(ctx, MARGIN, tableTop, MENU_WIDTH - MARGIN * 2, tableHeight)

    for (const [index, entry] of entries.entries()) {
      const y = tableTop + index * ROW_HEIGHT
      this.paintRow(ctx, entry, index + 1, y, options.showTags)
    }

    this.paintFooter(ctx, this.footerLines(options))
    return this.encode(canvas, height)
  }

  /** 缩略图型菜单：三列封面卡片，标题两行，适合快速浏览 */
  async renderGrid(entries: MenuListItem[], options: ListMenuOptions): Promise<RenderedMenu> {
    const count = Math.max(1, entries.length)
    const rows = Math.ceil(count / GRID_COLUMNS)
    const gridWidth = GRID_COLUMNS * GRID_CARD_WIDTH + (GRID_COLUMNS - 1) * GRID_GAP
    const left = Math.round((MENU_WIDTH - gridWidth) / 2)
    const top = HEADER_HEIGHT
    const height = top + rows * GRID_CARD_HEIGHT + (rows - 1) * GRID_GAP + FOOTER_HEIGHT + MARGIN

    const canvas = createCanvas(MENU_WIDTH, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = STYLE.pageBg
    ctx.fillRect(0, 0, MENU_WIDTH, height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    this.paintHeader(ctx, options, entries.length)
    for (const [index, entry] of entries.entries()) {
      const column = index % GRID_COLUMNS
      const row = Math.floor(index / GRID_COLUMNS)
      const x = left + column * (GRID_CARD_WIDTH + GRID_GAP)
      const y = top + row * (GRID_CARD_HEIGHT + GRID_GAP)
      this.paintGridCard(ctx, entry, index + 1, x, y)
    }

    this.paintFooter(ctx, this.footerLines(options))
    return this.encode(canvas, height)
  }

  /** 画廊详情：标题居中，左侧封面，右侧信息表与标签 */
  async renderGallery(gallery: GalleryDetail, cover: Image | undefined, showTags = true): Promise<RenderedMenu> {
    const innerX = MARGIN + 20
    const innerWidth = MENU_WIDTH - innerX * 2
    const scratch = createCanvas(10, 10).getContext('2d')

    const coverWidth = 330
    const contentX = innerX + coverWidth + 26
    const contentWidth = innerX + innerWidth - contentX
    const titleLines = this.wrapLines(scratch, `bold 22px ${FONT}`, singleLine(gallery.title), innerWidth, 3)
    const jpLines = gallery.titleJpn && gallery.titleJpn !== gallery.title
      ? this.wrapLines(scratch, `14px ${FONT}`, singleLine(gallery.titleJpn), innerWidth, 2)
      : []
    const rows: [string, string][] = [
      ['页数', `${gallery.pages ?? '?'}`],
    ]
    if (gallery.language) rows.push(['语言', gallery.language])
    if (gallery.rating) {
      const count = gallery.ratingCount ? `（${formatCount(gallery.ratingCount)} 人）` : ''
      rows.push(['评分', `${gallery.rating.toFixed(2)} / 5${count}`])
    }
    rows.push(['收藏', formatCount(gallery.favoriteCount ?? 0)])
    if (gallery.uploader) rows.push(['上传', singleLine(gallery.uploader)])
    if (gallery.posted) rows.push(['时间', singleLine(gallery.posted)])
    if (gallery.fileSize) rows.push(['体积', formatBytes(gallery.fileSize)])

    const labelWidth = this.labelColumnWidth(scratch, rows)
    const valueWidth = contentWidth - labelWidth
    const tagGroups = showTags ? this.layoutTagGroups(scratch, gallery.tags, valueWidth, 6, 3) : []

    const columnsTop = MARGIN + 26
    const titleTop = columnsTop
    const titleHeight = (titleLines.length - 1) * 30
    const jpHeight = jpLines.length ? (jpLines.length - 1) * 20 + 18 : 0
    const bodyTop = titleTop + titleHeight + jpHeight + 28
    const rowsHeight = rows.length * 27
    const tagRows = tagGroups.reduce((sum, group) => sum + group.rows, 0)
    const tagsBlock = tagRows ? 10 + tagRows * (STYLE.tagHeight + 5) : 0
    const idHeight = 46
    const infoHeight = 24 + idHeight + rowsHeight + tagsBlock
    const naturalHeight = cover && cover.width && cover.height
      ? Math.round(coverWidth * cover.height / cover.width)
      : 440
    const coverHeight = Math.min(560, naturalHeight)
    const bodyBottom = Math.max(bodyTop + coverHeight, bodyTop + infoHeight)
    const height = bodyBottom + FOOTER_HEIGHT + MARGIN

    const canvas = createCanvas(MENU_WIDTH, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = STYLE.pageBg
    ctx.fillRect(0, 0, MENU_WIDTH, height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    this.paintFrame(ctx, MARGIN, MARGIN, MENU_WIDTH - MARGIN * 2, height - MARGIN * 2)

    let y = titleTop
    ctx.textAlign = 'center'
    ctx.fillStyle = STYLE.text
    ctx.font = `bold 22px ${FONT}`
    for (const line of titleLines) {
      ctx.fillText(line, MENU_WIDTH / 2, y)
      y += 30
    }
    if (jpLines.length) {
      ctx.fillStyle = STYLE.dim
      ctx.font = `14px ${FONT}`
      for (const line of jpLines) {
        ctx.fillText(line, MENU_WIDTH / 2, y)
        y += 20
      }
    }
    ctx.textAlign = 'left'

    this.paintCover(ctx, cover, innerX, bodyTop, coverWidth, coverHeight)

    this.paintCategoryBadge(ctx, gallery.category, contentX, bodyTop, 108, 24)
    ctx.fillStyle = STYLE.text
    ctx.font = `bold 16px ${FONT}`
    ctx.fillText(`#${gallery.gid}`, contentX, bodyTop + 24 + 19)
    let infoY = bodyTop + 24 + 19 + 27
    for (const [label, value] of rows) {
      ctx.textAlign = 'left'
      ctx.fillStyle = STYLE.text
      ctx.font = `bold 15px ${FONT}`
      ctx.fillText(label, contentX, infoY)
      ctx.font = `15px ${FONT}`
      ctx.fillStyle = STYLE.text
      ctx.fillText(this.ellipsize(ctx, value, valueWidth), contentX + labelWidth, infoY)
      infoY += 27
    }

    if (tagGroups.length) {
      infoY += 4
      this.paintTagGroups(ctx, tagGroups, contentX, infoY - 16, labelWidth)
    }

    this.paintFooter(ctx, ['回复 [Y] 下载 · [F] 换一个 · [N] 退出'])
    return this.encode(canvas, height)
  }

  // ─── 绘制 ───────────────────────────────────────────────

  /** 信息表标签列宽度：按最宽的标签算，值紧跟在后面 */
  private labelColumnWidth(ctx: SKRSContext2D, rows: [string, string][]): number {
    ctx.font = `bold 15px ${FONT}`
    let width = 0
    for (const [label] of rows) width = Math.max(width, ctx.measureText(label).width)
    return Math.ceil(width) + 14
  }

  /** 标签命名空间列宽度：同样按最宽的一条算 */
  private tagLabelWidth(ctx: SKRSContext2D, tags: { namespace: string }[]): number {
    ctx.font = `bold 11px ${FONT}`
    let width = 0
    for (const tag of new Set(tags.map((tag) => tag.namespace))) {
      const label = `${NAMESPACE_LABEL[tag] ?? tag}:`
      width = Math.max(width, ctx.measureText(label).width)
    }
    return Math.ceil(width) + 10
  }

  private paintHeader(ctx: SKRSContext2D, options: ListMenuOptions, count: number): void {
    ctx.textAlign = 'left'
    ctx.fillStyle = STYLE.text
    ctx.font = `bold 26px ${FONT}`
    ctx.fillText(options.label ? `搜索结果 · ${options.label}` : '搜索结果', MARGIN, 44)

    ctx.textAlign = 'right'
    ctx.font = `15px ${FONT}`
    ctx.fillStyle = STYLE.dim
    ctx.fillText(this.rangeText(count, options), MENU_WIDTH - MARGIN, 44)
    ctx.textAlign = 'left'
  }

  /** 站点风格的外框：深红描边 + 内层浅色分隔线 */
  private paintFrame(ctx: SKRSContext2D, x: number, y: number, width: number, height: number): void {
    ctx.strokeStyle = STYLE.frame
    ctx.lineWidth = 2
    ctx.strokeRect(x - 1, y - 1, width + 2, height + 2)
    ctx.strokeStyle = STYLE.sep
    ctx.lineWidth = 1
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2)
  }

  private paintRow(
    ctx: SKRSContext2D,
    entry: MenuListItem,
    index: number,
    y: number,
    showTags: boolean,
  ): void {
    const tableX = MARGIN
    const tableWidth = MENU_WIDTH - MARGIN * 2

    ctx.fillStyle = index % 2 === 1 ? STYLE.rowEven : STYLE.rowOdd
    ctx.fillRect(tableX + 1, y, tableWidth - 2, ROW_HEIGHT)
    ctx.strokeStyle = STYLE.sep
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(tableX + 1, y + ROW_HEIGHT - 0.5)
    ctx.lineTo(tableX + tableWidth - 1, y + ROW_HEIGHT - 0.5)
    ctx.stroke()

    // 序号方块
    const boxX = tableX + 16
    const boxY = y + (ROW_HEIGHT - INDEX_BOX) / 2
    ctx.fillStyle = STYLE.indexBg
    ctx.fillRect(boxX, boxY, INDEX_BOX, INDEX_BOX)
    ctx.fillStyle = STYLE.badgeText
    ctx.font = `bold 18px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(index), boxX + INDEX_BOX / 2, boxY + INDEX_BOX / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    // 缩略图
    const thumbX = boxX + INDEX_BOX + 14
    const thumbY = y + 9
    this.paintImage(ctx, entry.cover, thumbX, thumbY, THUMB_WIDTH, THUMB_HEIGHT)
    ctx.strokeStyle = STYLE.frame
    ctx.lineWidth = 1
    ctx.strokeRect(thumbX - 0.5, thumbY - 0.5, THUMB_WIDTH + 1, THUMB_HEIGHT + 1)

    // 中间列：分类色块、日期、ID、页数、上传者（和站点扩展视图一致）
    const infoX = thumbX + THUMB_WIDTH + 14
    const infoTop = thumbY
    this.paintCategoryBadge(ctx, entry.item.category, infoX, infoTop, 96, 22)
    ctx.textAlign = 'left'
    ctx.fillStyle = STYLE.text
    ctx.font = `bold 12px ${FONT}`
    ctx.fillText(`#${entry.item.gid}`, infoX, infoTop + 40)
    ctx.font = `12px ${FONT}`
    ctx.fillText(entry.item.pages ? `${entry.item.pages} pages` : 'pages ?', infoX, infoTop + 58)
    ctx.fillStyle = STYLE.dim
    ctx.font = `11px ${FONT}`
    if (entry.item.uploader) ctx.fillText(this.ellipsize(ctx, singleLine(entry.item.uploader), INFO_WIDTH), infoX, infoTop + 76)
    if (entry.item.posted) ctx.fillText(this.ellipsize(ctx, singleLine(entry.item.posted), INFO_WIDTH), infoX, infoTop + 94)

    // 右侧：标题与按命名空间分组的标签
    const textX = infoX + INFO_WIDTH + 18
    const textWidth = MENU_WIDTH - MARGIN - 16 - textX
    const textTop = thumbY
    ctx.font = `bold 17px ${FONT}`
    const titleLines = this.wrapLines(ctx, ctx.font, singleLine(entry.item.title), textWidth, 2)
    let textY = textTop + 13
    ctx.fillStyle = STYLE.title
    for (const line of titleLines) {
      ctx.fillText(line, textX, textY)
      textY += 23
    }
    if (showTags && entry.item.tags.length) {
      const available = ROW_HEIGHT - 16 - titleLines.length * 23 - 8
      const maxTagRows = Math.max(1, Math.floor(available / (STYLE.tagHeight + 5)))
      const tags = entry.item.tags.slice(0, TAG_DISPLAY_LIMIT)
      const tagLabel = this.tagLabelWidth(ctx, tags)
      const groups = this.layoutTagGroups(ctx, tags, textWidth - tagLabel, maxTagRows, 2)
      if (groups.length) this.paintTagGroups(ctx, groups, textX, textY - 9, tagLabel)
    }
  }

  private paintGridCard(
    ctx: SKRSContext2D,
    entry: MenuListItem,
    index: number,
    x: number,
    y: number,
  ): void {
    ctx.fillStyle = STYLE.rowEven
    ctx.fillRect(x, y, GRID_CARD_WIDTH, GRID_CARD_HEIGHT)
    ctx.strokeStyle = STYLE.sep
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, GRID_CARD_WIDTH - 1, GRID_CARD_HEIGHT - 1)

    this.paintImage(ctx, entry.cover, x + 5, y + 5, GRID_CARD_WIDTH - 10, GRID_THUMB_HEIGHT - 10)
    ctx.strokeStyle = STYLE.frame
    ctx.lineWidth = 1
    ctx.strokeRect(x + 4.5, y + 4.5, GRID_CARD_WIDTH - 9, GRID_THUMB_HEIGHT - 9)

    // 序号角标
    const badge = 30
    ctx.fillStyle = STYLE.indexBg
    this.roundRect(ctx, x + 10, y + 10, badge, badge, 3)
    ctx.fill()
    ctx.fillStyle = STYLE.badgeText
    ctx.font = `bold 16px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(index), x + 10 + badge / 2, y + 10 + badge / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    // 分类色块与日期：固定在第一行，缩略图正下方
    const infoY = y + GRID_THUMB_HEIGHT + 6
    const badgeWidth = 86
    const badgeHeight = 20
    this.paintCategoryBadge(ctx, entry.item.category, x + (GRID_CARD_WIDTH - badgeWidth) / 2, infoY, badgeWidth, badgeHeight)

    const textX = x + 10
    const textWidth = GRID_CARD_WIDTH - 20
    const textTop = infoY + 22
    ctx.font = `bold 15px ${FONT}`
    const lines = this.wrapLines(ctx, ctx.font, singleLine(entry.item.title), textWidth, 2)
    ctx.fillStyle = STYLE.title
    let lineY = textTop + 14
    for (const line of lines) {
      ctx.fillText(line, textX, lineY)
      lineY += 21
    }

    ctx.font = `12px ${FONT}`
    ctx.fillStyle = STYLE.dim
    const meta = [`#${entry.item.gid}`]
    if (entry.item.pages) meta.push(`${entry.item.pages} 页`)
    const bottomY = y + GRID_CARD_HEIGHT - 10
    const posted = entry.item.posted ? singleLine(entry.item.posted) : ''
    const postedWidth = posted ? ctx.measureText(this.ellipsize(ctx, posted, 130)).width : 0
    const metaWidth = textWidth - (posted ? postedWidth + 10 : 0)
    ctx.fillText(this.ellipsize(ctx, meta.join('  ·  '), metaWidth), textX, bottomY)
    if (posted) {
      ctx.textAlign = 'right'
      ctx.fillText(this.ellipsize(ctx, posted, 130), x + GRID_CARD_WIDTH - 10, bottomY)
      ctx.textAlign = 'left'
    }
  }

  private paintCategoryBadge(
    ctx: SKRSContext2D,
    category: string | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const [from, to] = (category && CATEGORY_GRADIENT[category]) || CATEGORY_FALLBACK
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height)
    gradient.addColorStop(0, from)
    gradient.addColorStop(1, to)
    ctx.fillStyle = gradient
    this.roundRect(ctx, x, y, width, height, 3)
    ctx.fill()
    ctx.fillStyle = STYLE.badgeText
    ctx.font = `bold 13px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.categoryLabel(category), x + width / 2, y + height / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  private paintCover(
    ctx: SKRSContext2D,
    image: Image | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.paintImage(ctx, image, x, y, width, height)
    ctx.strokeStyle = STYLE.frame
    ctx.lineWidth = 2
    ctx.strokeRect(x - 1, y - 1, width + 2, height + 2)
  }

  private paintImage(
    ctx: SKRSContext2D,
    image: Image | undefined,
    x: number,
    y: number,
    boxWidth: number,
    boxHeight: number,
  ): void {
    if (!image || !image.width || !image.height) {
      ctx.fillStyle = STYLE.headerBg
      ctx.fillRect(x, y, boxWidth, boxHeight)
      ctx.fillStyle = STYLE.dim
      ctx.font = `14px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('无缩略图', x + boxWidth / 2, y + boxHeight / 2)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      return
    }
    // 等比缩放，保持原始比例，空白用底色填
    ctx.fillStyle = STYLE.headerBg
    ctx.fillRect(x, y, boxWidth, boxHeight)
    const scale = Math.min(boxWidth / image.width, boxHeight / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const drawX = x + (boxWidth - drawWidth) / 2
    const drawY = y + (boxHeight - drawHeight) / 2
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  }

  /**
   * 按命名空间分组排版，和站点详情页的 tc 行一致。
   * 每类最多 rowsPerGroup 行、整块最多 maxRows 行，放不下的折算成 `+N` 胶囊。
   */
  private layoutTagGroups(
    ctx: SKRSContext2D,
    tags: { namespace: string, name: string }[],
    valueWidth: number,
    maxRows: number,
    rowsPerGroup = 2,
  ): TagGroup[] {
    ctx.font = `bold 11px ${FONT}`
    const order = new Map(TAG_GROUP_ORDER.map((ns, index) => [ns, index]))
    const sorted = [...tags].sort((a, b) => (order.get(a.namespace) ?? 99) - (order.get(b.namespace) ?? 99))
    const buckets = new Map<string, { namespace: string, name: string }[]>()
    for (const tag of sorted) {
      const bucket = buckets.get(tag.namespace)
      if (bucket) bucket.push(tag)
      else buckets.set(tag.namespace, [tag])
    }

    // 先按组数分配行数：每组至少一行，剩下的行轮流补给前面的组
    const names = [...buckets.keys()].slice(0, maxRows)
    const rowQuota = new Map<string, number>(names.map((ns) => [ns, 1]))
    let extraRows = maxRows - names.length
    while (extraRows > 0) {
      let grown = false
      for (const ns of names) {
        if (extraRows <= 0) break
        const current = rowQuota.get(ns) ?? 1
        if (current >= rowsPerGroup) continue
        rowQuota.set(ns, current + 1)
        extraRows -= 1
        grown = true
      }
      if (!grown) break
    }

    const groups: TagGroup[] = []
    let usedRows = 0
    for (const [ns, bucket] of buckets) {
      if (usedRows >= maxRows) break
      const groupRows = rowQuota.get(ns) ?? 1
      const group: TagGroup = {
        ns,
        label: `${NAMESPACE_LABEL[ns] ?? ns}:`,
        rows: 1,
        items: [],
      }
      usedRows += 1
      for (const tag of bucket) {
        const text = this.ellipsize(ctx, tag.name, valueWidth - 12)
        const textWidth = ctx.measureText(text).width
        const width = textWidth + 12
        const last = group.items[group.items.length - 1]
        const cursorX = last && last.row === group.rows - 1 ? last.x + last.width + 4 : 0
        if (cursorX + width > valueWidth && cursorX > 0) {
          if (group.rows >= groupRows || usedRows >= maxRows) break
          group.rows += 1
          usedRows += 1
          group.items.push({ text, width, textWidth, x: 0, row: group.rows - 1 })
        } else {
          group.items.push({ text, width, textWidth, x: cursorX, row: group.rows - 1 })
        }
      }

      // 放不下的标签折算成 +N，贴着最后一行的末尾
      let hidden = bucket.length - group.items.length
      while (hidden > 0) {
        const suffix = `+${hidden}`
        const suffixWidth = ctx.measureText(suffix).width + 12
        const last = group.items[group.items.length - 1]
        const sameRow = last && last.row === group.rows - 1
        const cursorX = sameRow ? last.x + last.width + 4 : 0
        if (cursorX + suffixWidth <= valueWidth) {
          group.items.push({ text: suffix, width: suffixWidth, textWidth: suffixWidth - 12, x: cursorX, row: group.rows - 1 })
          break
        }
        if (!sameRow) break
        group.items.pop()
        hidden += 1
      }

      if (group.items.length) groups.push(group)
    }
    return groups
  }

  private paintTagGroups(
    ctx: SKRSContext2D,
    groups: TagGroup[],
    x: number,
    y: number,
    labelWidth: number,
  ): void {
    let rowIndex = 0
    for (const group of groups) {
      const rowY = y + rowIndex * (STYLE.tagHeight + 5)
      ctx.textAlign = 'left'
      ctx.fillStyle = STYLE.dim
      ctx.font = `bold 11px ${FONT}`
      ctx.fillText(group.label, x, rowY + STYLE.tagHeight / 2 + 4)
      for (const item of group.items) {
        const chipX = x + labelWidth + item.x
        const chipY = y + (rowIndex + item.row) * (STYLE.tagHeight + 5)
        this.roundRect(ctx, chipX, chipY, item.width, STYLE.tagHeight, STYLE.tagRadius)
        ctx.fillStyle = STYLE.tagBg
        ctx.fill()
        ctx.strokeStyle = STYLE.tagBorder
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = STYLE.text
        ctx.font = `bold 11px ${FONT}`
        ctx.textBaseline = 'middle'
        ctx.fillText(item.text, chipX + (item.width - item.textWidth) / 2, chipY + STYLE.tagHeight / 2 + 1)
        ctx.textBaseline = 'alphabetic'
      }
      rowIndex += group.rows
    }
  }

  private paintFooter(ctx: SKRSContext2D, lines: string[]): void {
    const baseY = ctx.canvas.height - 30
    ctx.textAlign = 'center'
    ctx.fillStyle = STYLE.text
    ctx.font = `bold 15px ${FONT}`
    ctx.fillText(lines[0], MENU_WIDTH / 2, baseY)
    if (lines[1]) {
      ctx.fillStyle = STYLE.dim
      ctx.font = `13px ${FONT}`
      ctx.fillText(lines[1], MENU_WIDTH / 2, baseY + 22)
    }
    ctx.textAlign = 'left'
  }

  // ─── 工具 ───────────────────────────────────────────────

  private async encode(canvas: Canvas, height: number): Promise<RenderedMenu> {
    const buffer = Buffer.from(await canvas.encode('jpeg', MENU_JPEG_QUALITY))
    return { buffer, width: MENU_WIDTH, height }
  }

  private rangeText(_count: number, options: ListMenuOptions): string {
    const parts: string[] = []
    if (options.total) parts.push(`共 ${formatCount(options.total)} 个结果`)
    parts.push(`第 ${options.page}/${Math.max(options.page, options.pageCount)} 页`)
    return parts.join('  ·  ')
  }

  private categoryLabel(category?: string): string {
    return category || 'Misc'
  }

  private footerLines(options: ListMenuOptions): [string, string] {
    const keys: string[] = ['回复序号下载']
    if (options.hasPrev) keys.push('[B] 上一页')
    if (options.hasNext) keys.push('[F] 下一页')
    keys.push('[N] 退出')
    return [keys.join('  ·  '), '']
  }

  private roundRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    const r = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + width - r, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + r)
    ctx.lineTo(x + width, y + height - r)
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
    ctx.lineTo(x + r, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  private ellipsize(ctx: SKRSContext2D, text: string, maxWidth: number, force = false): string {
    if (!force && ctx.measureText(text).width <= maxWidth) return text
    let truncated = text
    while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
      truncated = truncated.slice(0, -1)
    }
    return truncated.length ? `${truncated.trimEnd()}…` : ''
  }

  private wrapLines(
    ctx: SKRSContext2D,
    font: string,
    text: string,
    maxWidth: number,
    maxLines: number,
  ): string[] {
    ctx.font = font
    const value = singleLine(text)
    if (ctx.measureText(value).width <= maxWidth) return [value]

    const tokens = value.match(/(\s+|[\x21-\x7e]+|[^])/g) ?? [value]
    const lines: string[] = []
    let current = ''
    let clipped = false
    for (const token of tokens) {
      const candidate = current + token
      if (ctx.measureText(candidate).width > maxWidth && current) {
        lines.push(current.trimEnd())
        if (lines.length === maxLines) {
          current = ''
          clipped = true
          break
        }
        current = /^\s+$/.test(token) ? '' : token
      } else {
        current = candidate
      }
    }
    if (lines.length < maxLines && current) {
      if (ctx.measureText(current).width > maxWidth) clipped = true
      lines.push(current.trimEnd())
    }
    if (!lines.length) lines.push('')
    if (lines.length === maxLines && (clipped || ctx.measureText(lines[maxLines - 1]).width > maxWidth)) {
      lines[maxLines - 1] = this.ellipsize(ctx, lines[maxLines - 1], maxWidth, clipped)
    }
    return lines
  }
}
