/**
 * 下载任务登记表：支持取消、部分失败记录（供“只补下失败页”使用）。
 */
import type { DownloadOptions, GalleryDetail } from '../types'
import { FAILED_RECORD_TTL_MS } from '../constants'

export class TaskCancelledError extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'TaskCancelledError'
  }
}

export class DownloadTask {
  readonly startedAt = Date.now()
  readonly controller = new AbortController()
  cancelled = false
  downloaded = 0
  failedIndexes: number[] = []

  constructor(
    readonly key: string,
    readonly gallery: GalleryDetail,
    readonly options: DownloadOptions,
    readonly dir: string,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get total(): number {
    return this.gallery.pages ?? 0
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.controller.abort(new TaskCancelledError())
  }

  throwIfCancelled(): void {
    if (this.cancelled || this.controller.signal.aborted) throw new TaskCancelledError()
  }
}

export interface FailedRecord {
  gallery: GalleryDetail
  options: DownloadOptions
  dir: string
  indexes: number[]
  at: number
}

export class TaskStore {
  private readonly tasks = new Map<string, DownloadTask>()
  private readonly failed = new Map<string, FailedRecord>()

  /** 同一会话只保留一个任务，新任务会取消旧任务 */
  start(key: string, gallery: GalleryDetail, options: DownloadOptions, dir: string): DownloadTask {
    this.cancel(key)
    const task = new DownloadTask(key, gallery, options, dir)
    this.tasks.set(key, task)
    return task
  }

  get(key: string): DownloadTask | undefined {
    return this.tasks.get(key)
  }

  cancel(key: string): DownloadTask | undefined {
    const task = this.tasks.get(key)
    task?.cancel()
    return task
  }

  finish(key: string, task: DownloadTask): void {
    if (this.tasks.get(key) === task) this.tasks.delete(key)
  }

  setFailed(key: string, record: Omit<FailedRecord, 'at'>): void {
    if (!record.indexes.length) {
      this.failed.delete(key)
      return
    }
    this.failed.set(key, { ...record, at: Date.now() })
  }

  takeFailed(key: string): FailedRecord | undefined {
    const record = this.failed.get(key)
    if (!record) return undefined
    this.failed.delete(key)
    if (Date.now() - record.at > FAILED_RECORD_TTL_MS) return undefined
    return record
  }

  clear(): void {
    for (const task of this.tasks.values()) task.cancel()
    this.tasks.clear()
    this.failed.clear()
  }
}
