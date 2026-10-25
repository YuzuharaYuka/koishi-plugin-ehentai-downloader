/**
 * 任务管理：取消与失败重试。
 */
import type { Session } from 'koishi'
import { MESSAGES, SITES } from '../constants'
import type { EhPlugin } from '../plugin'
import { logger, formatNetworkError, getErrorMessage } from '../utils'
import { quote, sessionKey } from './common'
import { executeDownload } from './download'
import { GalleryNotFoundError, GalleryExpungedError, GalleryUnsupportedError } from '../services/gallery'
import { SiteAuthError } from '../services/http'

export async function handleCancel(session: Session, plugin: EhPlugin): Promise<void> {
  const key = sessionKey(session)
  const task = plugin.tasks.cancel(key)
  if (!task) {
    await session.send(MESSAGES.noActiveTask)
    return
  }
  const seconds = Math.round((Date.now() - task.startedAt) / 1000)
  await session.send(`${MESSAGES.cancelRequested}（画廊 ${task.gallery.gid}，已进行 ${seconds}s）`)
}

export async function handleRetry(session: Session, plugin: EhPlugin): Promise<void> {
  if (!plugin.ensureReady()) {
    await session.send(MESSAGES.notInitialized)
    return
  }
  const key = sessionKey(session)
  const record = plugin.tasks.takeFailed(key)
  if (!record || !record.indexes.length) {
    await session.send(MESSAGES.noFailedTask)
    return
  }
  await session.send(quote(session) + MESSAGES.retryStarted)

  try {
    const origin = SITES[record.gallery.site].origin
    const revalidated = await plugin.galleries.resolve(`${origin}/g/${record.gallery.gid}/${record.gallery.token}/`)
    await executeDownload(session, plugin, revalidated, {
      ...record.options,
      indexes: record.indexes,
    })
  } catch (error) {
    if (error instanceof GalleryNotFoundError || error instanceof GalleryExpungedError) {
      await session.send(MESSAGES.galleryNotFound)
      return
    }
    if (error instanceof GalleryUnsupportedError) {
      await session.send(MESSAGES.mpvOnly)
      return
    }
    if (error instanceof SiteAuthError) {
      await session.send(MESSAGES.galleryLoginRequired)
      return
    }
    logger.warn(`[重试] 重新解析画廊失败: ${getErrorMessage(error)}`)
    await session.send(`解析画廊失败：${formatNetworkError(error)}。请稍后重试。`)
  }
}
