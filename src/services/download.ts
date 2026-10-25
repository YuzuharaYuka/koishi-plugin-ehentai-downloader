/**
 * 下载编排：取页 → 并发抓图 → 打包。
 * 任何单页失败都不会中断整个任务，失败页码会记录，供“只补下失败页”使用。
 */
import * as path from 'path'
import type { Config } from '../config'
import { MESSAGES, PROGRESS_LOG_INTERVAL_MS } from '../constants'
import type { DownloadedPage, DownloadOptions, DownloadOutcome, GalleryDetail, GalleryPageEntry } from '../types'
import {
  ensureDir,
  fileSize,
  formatBytes,
  formatDuration,
  getErrorMessage,
  isAbortError,
  logger,
  padPageNumber,
  removePath,
  retryAsync,
  sanitizeFilename,
  truncate,
} from '../utils'
import { buildPdf, buildZip, type PageFile } from './archive'
import type { GalleryService } from './gallery'
import { EhHttpClient, MediaTypeError, SiteAuthError, mediaExtension } from './http'
import type { ImageService } from './image'
import { TaskCancelledError, type DownloadTask } from './task'

export interface DownloadCallbacks {
  onProgress?: (downloaded: number, total: number, failed: number) => void
  onPackageProgress?: (done: number, total: number) => void
}

export class DownloadManager {
  constructor(
    private readonly config: Config,
    private readonly http: EhHttpClient,
    private readonly galleries: GalleryService,
    private readonly images: ImageService,
  ) {}

  /** 下载目录：按 gid 区分，标题只用于可读性 */
  dirFor(gallery: GalleryDetail): string {
    const slug = truncate(sanitizeFilename(gallery.title, 'gallery'), 60)
    return path.join(this.config.downloadPath, `${gallery.gid}-${slug}`)
  }

  /** 消息里展示的文件名（不含扩展名） */
  outputBaseName(gallery: GalleryDetail): string {
    const title = sanitizeFilename(gallery.title, `gallery-${gallery.gid}`)
    return this.config.prependGid ? `${gallery.gid} ${title}` : title
  }

  /** 预估页数与体积，用于下载前提示 */
  plan(gallery: GalleryDetail, options: DownloadOptions): { pages: number; estimateBytes?: number } {
    const pages = options.indexes?.length ?? gallery.pages ?? 0
    if (!gallery.fileSize || !gallery.pages) return { pages }
    const estimateBytes = Math.round((gallery.fileSize * pages) / Math.max(1, gallery.pages))
    return { pages, estimateBytes }
  }

  async download(task: DownloadTask, callbacks: DownloadCallbacks = {}): Promise<DownloadOutcome> {
    const startedAt = Date.now()
    const { gallery, options, signal } = task
    const pages = await this.collectPages(task)
    if (!pages.length) throw new Error(MESSAGES.downloadNoPages)

    const imageDir = path.join(task.dir, 'pages')
    await ensureDir(imageDir)
    logger.debug(`[下载] 画廊 ${gallery.gid}: ${pages.length} 页，${options.format}/${options.quality}，并发 ${Math.min(options.concurrency ?? this.config.downloadConcurrency, pages.length)}`)

    const total = pages.length
    const failed: number[] = []
    const files: PageFile[] = []
    const queue = [...pages]
    let done = 0
    let lastLog = 0
    let fatalError: unknown

    const report = () => {
      callbacks.onProgress?.(done, total, failed.length)
      const now = Date.now()
      if (now - lastLog >= PROGRESS_LOG_INTERVAL_MS || done === total) {
        lastLog = now
        const size = files.reduce((sum, file) => sum + file.size, 0)
        const estimate = gallery.fileSize && task.options.quality === 'original'
          ? ` / 约 ${formatBytes(gallery.fileSize)}`
          : ''
        logger.info(
          `[下载] 画廊 ${gallery.gid}: ${done}/${total} 页${failed.length ? `（失败 ${failed.length} 页）` : ''}，${formatBytes(size)}${estimate}`,
        )
      }
    }

    const worker = async () => {
      while (queue.length) {
        task.throwIfCancelled()
        const entry = queue.shift()
        if (!entry) return
        try {
          // 解析与下载放在同一层重试：失败时先丢掉图片页缓存，重试会重新解析、可能换一台 H@H 主机
          const { dest, extension } = await retryAsync(
            async () => {
              const resolved = await this.images.resolvePage(gallery, entry, signal)
              const extension = mediaExtension(undefined, resolved.url)
              const dest = path.join(imageDir, `${padPageNumber(entry.index, gallery.pages || total)}.${extension}`)
              await this.http.downloadMedia(resolved.url, dest, { signal, referer: resolved.referer })
              return { dest, extension }
            },
            {
              retries: this.config.downloadRetries,
              delayMs: this.config.retryDelay * 1000,
              signal,
              fatal: (error) => error instanceof MediaTypeError,
              onRetry: (error, attempt) => {
                this.images.invalidatePage(entry.pageUrl)
                logger.debug(`[下载] 第 ${entry.index} 页重试 ${attempt}: ${getErrorMessage(error)}`)
              },
            },
          )
          const size = await fileSize(dest)
          if (!size) throw new Error('下载结果为空')
          files.push({ index: entry.index, path: dest, extension, size })
          done++
          task.downloaded = done
          report()
        } catch (error) {
          if (isAbortError(error) || error instanceof TaskCancelledError || error instanceof SiteAuthError) throw error
          failed.push(entry.index)
          logger.warn(`[下载] 第 ${entry.index} 页下载失败: ${getErrorMessage(error)}`)
          report()
        }
      }
    }

    const concurrency = Math.max(1, Math.min(this.config.downloadConcurrency, pages.length))
    await Promise.all(
      Array.from({ length: concurrency }, () =>
        worker().catch((error) => {
          if (!fatalError) fatalError = error
          task.cancel()
        }),
      ),
    )
    if (fatalError && !isAbortError(fatalError) && !task.cancelled) throw fatalError
    task.throwIfCancelled()
    if (fatalError) throw fatalError

    if (!files.length) throw new Error(MESSAGES.downloadNoPages)
    files.sort((a, b) => a.index - b.index)

    let filePath: string | undefined
    let partialDir: string | undefined
    if (options.format === 'img') {
      partialDir = imageDir
    } else {
      const extension = options.format === 'pdf' ? 'pdf' : 'zip'
      const outPath = path.join(task.dir, `${this.outputBaseName(gallery)}.${extension}`)
      logger.info(`[打包] 画廊 ${gallery.gid}: 生成 ${extension.toUpperCase()}（${files.length} 页）`)
      if (options.format === 'pdf') {
        await buildPdf(files, outPath, {
          password: options.password,
          maxEdge: this.config.pdfMaxEdge,
          onProgress: (count, totalPages) => callbacks.onPackageProgress?.(count, totalPages),
        })
      } else {
        await buildZip(files, outPath, {
          password: options.password,
          onProgress: (count, totalPages) => callbacks.onPackageProgress?.(count, totalPages),
        })
      }
      filePath = outPath
      await removePath(imageDir)
    }

    const imageFiles: DownloadedPage[] = []
    if (partialDir) {
      for (const file of files) {
        imageFiles.push({ index: file.index, path: file.path, extension: file.extension, size: await fileSize(file.path) })
      }
    }

    const elapsedMs = Date.now() - startedAt
    const outputSize = filePath ? await fileSize(filePath) : 0
    logger.info(
      `[下载] 画廊 ${gallery.gid} 完成: ${files.length}/${total} 页, 失败 ${failed.length} 页, 耗时 ${formatDuration(elapsedMs)}`
        + `${outputSize ? `, 输出 ${formatBytes(outputSize)}` : ''}`,
    )

    return {
      gallery,
      options,
      filePath,
      imageFiles,
      failedIndexes: failed.sort((a, b) => a - b),
      total,
      successCount: files.length,
      partialDir,
      elapsedMs,
    }
  }

  /** 取得需要下载的页；支持页码范围（-r） */
  private async collectPages(task: DownloadTask): Promise<GalleryPageEntry[]> {
    const { gallery, options, signal } = task
    const indexes = options.indexes?.length ? [...new Set(options.indexes)].sort((a, b) => a - b) : undefined
    const needed = indexes ? Math.max(...indexes) : gallery.pages || this.config.maxPages
    const list = await this.galleries.getPages(gallery, needed || this.config.maxPages, signal)
    if (!list.entries.length) throw new Error(MESSAGES.downloadNoPages)
    const selected = indexes ? list.entries.filter((entry) => indexes.includes(entry.index)) : list.entries
    if (!indexes && this.config.maxPages > 0 && selected.length > this.config.maxPages) {
      throw new Error(MESSAGES.tooManyPages)
    }
    if (indexes) {
      const missing = indexes.filter((index) => !selected.some((entry) => entry.index === index))
      if (missing.length) {
        logger.warn(`[下载] 画廊 ${gallery.gid} 缺少页码: ${missing.join(', ')}`)
      }
    }
    return selected
  }

}
