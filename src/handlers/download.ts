/**
 * 下载指令：解析画廊、创建任务、发送结果。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { h, type Session } from 'koishi'
import type { Config } from '../config'
import { BUFFER_WARN_SIZE, FORWARD_BATCH_DELAY_MS, FORWARD_BATCH_SIZE, MESSAGES, QUALITY_ALIASES } from '../constants'
import type { EhPlugin } from '../plugin'
import { GalleryExpungedError, GalleryNotFoundError, GalleryUnsupportedError } from '../services/gallery'
import { SiteAuthError } from '../services/http'
import { canvasAvailable, type Image } from '../services/canvas'
import { decodeImage, releaseImage } from '../services/image-codec'
import type { DownloadedPage, DownloadOptions, DownloadOutcome, GalleryDetail, ImageQuality } from '../types'
import {
  formatBytes,
  formatNetworkError,
  getErrorMessage,
  isAbortError,
  logger,
  removePath,
} from '../utils'
import {
  delay,
  formatFailedPages,
  formatOutcomeSummary,
  formatPasswordLine,
  gallerySiteLabel,
  parsePageRange,
  promptAnswer,
  quote,
  renderGalleryInfo,
  resolveOutputFormat,
  sendResult,
  sessionKey,
  supportsForward,
} from './common'

export interface DownloadFlags {
  pdf?: boolean
  zip?: boolean
  image?: boolean
  key?: string
  noPassword?: boolean
  pages?: string
  quality?: string
}

function imageMime(extension: string): string {
  switch (extension.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function normalizeQuality(input: string | undefined): ImageQuality | undefined {
  if (!input) return undefined
  return QUALITY_ALIASES[input.trim().toLowerCase()] as ImageQuality | undefined
}

function isBusinessMessage(error: unknown): string | undefined {
  const message = getErrorMessage(error)
  const known = Object.values(MESSAGES) as string[]
  return known.includes(message) ? message : undefined
}

async function resolveGallery(session: Session, plugin: EhPlugin, input: string): Promise<GalleryDetail | undefined> {
  try {
    return await plugin.galleries.resolve(input)
  } catch (error) {
    if (error instanceof GalleryNotFoundError) {
      await session.send(MESSAGES.galleryNotFound)
      return undefined
    }
    if (error instanceof GalleryExpungedError) {
      await session.send(MESSAGES.galleryExpunged)
      return undefined
    }
    if (error instanceof GalleryUnsupportedError) {
      await session.send(MESSAGES.mpvOnly)
      return undefined
    }
    if (error instanceof SiteAuthError) {
      await session.send(MESSAGES.galleryLoginRequired)
      return undefined
    }
    logger.warn(`[下载] 解析画廊失败: ${getErrorMessage(error)}`)
    await session.send(`解析画廊失败：${formatNetworkError(error)}。请检查输入后重试。`)
    return undefined
  }
}

/**
 * 支持直接回 `eh.download 3`：把菜单序号换成上次列表里的画廊链接。
 * 不是纯数字、或列表已过期时原样返回，交给正常解析流程。
 */
function resolveListingInput(session: Session, plugin: EhPlugin, input: string): string {
  const trimmed = input.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return input
  const item = plugin.listings.pick(sessionKey(session), Number.parseInt(trimmed, 10))
  return item ? item.url : input
}

export async function handleDownload(session: Session, plugin: EhPlugin, input: string, flags: DownloadFlags = {}): Promise<void> {
  if (!plugin.ensureReady()) {
    await session.send(MESSAGES.notInitialized)
    return
  }
  const config = plugin.config
  const format = resolveOutputFormat(config, flags)
  if (format === 'pdf' && !canvasAvailable()) {
    await session.send('生成 PDF 需要 @napi-rs/canvas，但当前加载失败。在 Koishi 项目目录执行 yarn install 后重启；也可以先用 -z 输出 ZIP。')
    return
  }
  const target = resolveListingInput(session, plugin, input)
  await session.send(quote(session) + MESSAGES.resolvingGallery)

  const gallery = await resolveGallery(session, plugin, target)
  if (!gallery) return

  const quality = normalizeQuality(flags.quality) ?? config.imageQuality
  const passwordInFlags = flags.key?.trim() || undefined
  const password = flags.noPassword ? undefined : passwordInFlags ?? (config.defaultPassword || undefined)

  const range = parsePageRange(flags.pages, gallery.pages ?? 0)
  if (range.error) {
    await session.send(range.error)
    return
  }

  const options = {
    format,
    quality,
    concurrency: config.downloadConcurrency,
    password,
    indexes: range.indexes,
  }

  if (!range.indexes && config.maxPages > 0 && gallery.pages && gallery.pages > config.maxPages) {
    await session.send(MESSAGES.tooManyPages)
    return
  }

  await executeDownload(session, plugin, gallery, options)
}

/** 创建/复用任务并执行下载，供下载与重试指令共用 */
export async function executeDownload(
  session: Session,
  plugin: EhPlugin,
  gallery: GalleryDetail,
  options: DownloadOptions,
): Promise<void> {
  const key = sessionKey(session)
  const dir = plugin.downloads.dirFor(gallery)
  const task = plugin.tasks.start(key, gallery, options, dir)

  try {
    const outcome = await plugin.downloads.download(task, {
      // 逐页进度由 DownloadManager 写日志（含已下载体积），这里不再重复播报
      onPackageProgress: (done, total) => {
        if (done === total) logger.debug(`[下载] 画廊 ${gallery.gid}: 打包完成 ${done}/${total}`)
      },
    })
    if (outcome.failedIndexes.length) {
      plugin.tasks.setFailed(key, { gallery, options, dir, indexes: outcome.failedIndexes })
    }
    await deliverOutcome(session, plugin.config, outcome)
  } catch (error) {
    const cancelled = error instanceof Error && (error.name === 'TaskCancelledError' || isAbortError(error))
    if (cancelled) {
      await session.send(MESSAGES.downloadCancelled)
    } else {
      const business = isBusinessMessage(error)
      logger.warn(`[下载] 画廊 ${gallery.gid} 失败: ${getErrorMessage(error)}`)
      if (business) {
        await session.send(business)
      } else {
        await session.send(`下载失败：${formatNetworkError(error)}。请稍后重试。`)
      }
    }
    if (task.failedIndexes.length) {
      plugin.tasks.setFailed(key, { gallery, options, dir, indexes: [...task.failedIndexes].sort((a, b) => a - b) })
    }
  } finally {
    plugin.tasks.finish(key, task)
  }
}

async function deliverOutcome(session: Session, config: Config, outcome: DownloadOutcome): Promise<void> {
  const { gallery } = outcome
  const summary = formatOutcomeSummary(outcome.successCount, outcome.elapsedMs)
  const site = gallerySiteLabel(gallery)

  if (outcome.options.format === 'img') {
    const caption = `${summary}（${site ? `${site}·` : ''}${gallery.title}）`
    await session.send(caption)
    await sendImages(session, config, outcome.imageFiles)
    if (outcome.partialDir) await removePath(outcome.partialDir)
  } else if (outcome.filePath) {
    const filePath = outcome.filePath
    const filename = path.basename(filePath)
    const sizeBytes = await fs.stat(filePath).then((stat) => stat.size).catch(() => 0)
    const size = sizeBytes ? formatBytes(sizeBytes) : undefined
    await session.send(`${summary}${size ? ` · ${size}` : ''}${formatPasswordLine(outcome.options.password)}`)

    const asBuffer = config.fileSendMethod === 'buffer'
    if (asBuffer && sizeBytes > BUFFER_WARN_SIZE) {
      logger.warn(`[发送] ${filename} ${formatBytes(sizeBytes)} 超过 ${formatBytes(BUFFER_WARN_SIZE)}，部分协议端可能因单帧上限断连`)
    }

    try {
      await session.send(asBuffer
        ? h.file(await fs.readFile(filePath), filename.endsWith('.pdf') ? 'application/pdf' : 'application/zip', { title: filename })
        : h.file(pathToFileURL(filePath).href, { title: filename }))
    } catch (error) {
      logger.warn(`[发送] ${filename} 失败: ${getErrorMessage(error)}`)
      await session.send(`${MESSAGES.fileSendFailed} ${filePath}。文件过大时可能是协议端的单帧上限导致，可以调小 imageCompression 的尺寸后重试。`)
      return
    }
    await removePath(filePath)
  }

  if (outcome.failedIndexes.length) {
    await session.send(`有 ${outcome.failedIndexes.length} 页下载失败，页码为: ${formatFailedPages(outcome.failedIndexes)}。发送 eh.retry 可只补下这几页。`)
  }
}

async function sendImages(session: Session, config: Config, files: DownloadedPage[]): Promise<void> {
  const sorted = [...files].sort((a, b) => a.index - b.index)
  const forward = config.imageSendMode === 'forward'
    || (config.imageSendMode === 'auto' && supportsForward(session) && sorted.length > 1)

  if (forward) {
    for (let offset = 0; offset < sorted.length; offset += FORWARD_BATCH_SIZE) {
      const batch = sorted.slice(offset, offset + FORWARD_BATCH_SIZE)
      const nodes = await Promise.all(batch.map(async (file) => {
        const buffer = await fs.readFile(file.path)
        return h.image(buffer, imageMime(file.extension))
      }))
      try {
        await session.send(h('message', { forward: true }, nodes))
      } catch (error) {
        logger.warn(`[下载] 合并转发失败: ${getErrorMessage(error)}`)
        await session.send(MESSAGES.imageSendFailed)
        return
      }
      if (offset + FORWARD_BATCH_SIZE < sorted.length) await delay(FORWARD_BATCH_DELAY_MS)
    }
    return
  }

  for (const file of sorted) {
    const buffer = await fs.readFile(file.path)
    await session.send(h.image(buffer, imageMime(file.extension)))
    if (config.imageSendDelay > 0) await delay(config.imageSendDelay * 1000)
  }
}

/** 展示单个画廊的信息（eh.info） */
export async function handleGalleryInfo(session: Session, plugin: EhPlugin, input: string): Promise<void> {
  if (!plugin.ensureReady()) {
    await session.send(MESSAGES.notInitialized)
    return
  }
  await session.send(quote(session) + MESSAGES.resolvingGallery)
  const gallery = await resolveGallery(session, plugin, input)
  if (!gallery) return
  await sendGalleryCard(session, plugin, gallery)
}

/** 发送画廊详情：card 样式出图，其他样式退化成文本 */
async function sendGalleryCard(session: Session, plugin: EhPlugin, gallery: GalleryDetail): Promise<void> {
  if (plugin.config.menuStyle === 'card') {
    let cover: Image | undefined
    if (gallery.thumbUrl) {
      const jpeg = await plugin.images.thumbnailJpeg(gallery.thumbUrl)
      if (jpeg) cover = await decodeImage(jpeg)
    }
    const rendered = await plugin.menu
      .renderGallery(gallery, cover, plugin.config.showTags)
      .catch((error) => {
        logger.warn(`[信息] 卡片渲染失败: ${getErrorMessage(error)}`)
        return undefined
      })
      .finally(() => releaseImage(cover))
    if (rendered) {
      await session.send(h.image(rendered.buffer, 'image/jpeg'))
      return
    }
  }

  await sendResult(session, [renderGalleryInfo(gallery, { showTags: plugin.config.showTags })], false)
}

/** 随机抽一个画廊，回 Y 直接下载 */
export async function handleRandom(session: Session, plugin: EhPlugin): Promise<void> {
  if (!plugin.ensureReady()) {
    await session.send(MESSAGES.notInitialized)
    return
  }
  await session.send(quote(session) + '正在随机选取画廊…')
  let gallery: GalleryDetail
  try {
    gallery = await plugin.galleries.random()
  } catch (error) {
    logger.warn(`[随机] 失败: ${getErrorMessage(error)}`)
    await session.send(`随机画廊获取失败：${formatNetworkError(error)}。`)
    return
  }
  await sendGalleryCard(session, plugin, gallery)
  const answer = await promptAnswer(session, plugin.config.promptTimeout * 1000)
  if (!answer) {
    await session.send(MESSAGES.promptTimeout)
    return
  }
  if (/^(y|yes|下载|下|好|是)$/i.test(answer)) {
    await session.execute(`eh.download ${gallery.gid}`)
    return
  }
  await session.send('已取消。')
}
