/**
 * 缓存：内存缓存（搜索结果、图片页信息）+ 磁盘缩略图缓存。
 * 关闭缓存或缓存失效时不会影响主流程，只是会重复请求站点。
 */
import * as fs from 'fs'
import * as path from 'path'
import type { Config } from '../config'
import { ensureDir, hashText, logger, removePath } from '../utils'

interface MemoryEntry {
  value: unknown
  expiresAt: number
}

const MAX_MEMORY_ENTRIES = 500

export class CacheStore {
  private readonly memory = new Map<string, MemoryEntry>()
  private readonly thumbDir: string
  private writesSinceCleanup = 0

  constructor(
    private readonly config: Config,
    downloadPath: string,
  ) {
    this.thumbDir = path.join(downloadPath, 'cache', 'thumbs')
  }

  get enabled(): boolean {
    return this.config.enableCache
  }

  private get ttlMs(): number {
    return this.config.cacheTtlHours * 60 * 60 * 1000
  }

  private get maxBytes(): number {
    return this.config.cacheMaxSizeMb * 1024 * 1024
  }

  /** 启动时创建目录并清理过期文件 */
  async initialize(): Promise<void> {
    if (!this.config.enableCache) {
      await removePath(this.thumbDir)
      return
    }
    await ensureDir(this.thumbDir)
    const result = await this.cleanup()
    if (result.removed > 0) {
      logger.info(`[缓存] 启动清理: 删除 ${result.removed} 个过期缩略图`)
    }
  }

  /** 删除过期缩略图，并在超限时按时间从旧到新删除 */
  async cleanup(): Promise<{ removed: number; freedBytes: number }> {
    let removed = 0
    let freedBytes = 0
    if (!this.config.enableCache) return { removed, freedBytes }

    let files: string[]
    try {
      files = await fs.promises.readdir(this.thumbDir)
    } catch {
      return { removed, freedBytes }
    }

    const records: Array<{ file: string; mtime: number; size: number }> = []
    for (const file of files) {
      const target = path.join(this.thumbDir, file)
      try {
        const stat = await fs.promises.stat(target)
        if (!stat.isFile()) continue
        records.push({ file: target, mtime: stat.mtimeMs, size: stat.size })
      } catch {
        continue
      }
    }

    const now = Date.now()
    const kept: typeof records = []
    for (const record of records) {
      if (now - record.mtime > this.ttlMs) {
        await fs.promises.rm(record.file, { force: true }).catch(() => undefined)
        removed++
        freedBytes += record.size
      } else {
        kept.push(record)
      }
    }

    let total = kept.reduce((sum, record) => sum + record.size, 0)
    if (this.maxBytes > 0 && total > this.maxBytes) {
      kept.sort((a, b) => a.mtime - b.mtime)
      for (const record of kept) {
        if (total <= this.maxBytes) break
        await fs.promises.rm(record.file, { force: true }).catch(() => undefined)
        removed++
        freedBytes += record.size
        total -= record.size
      }
    }

    return { removed, freedBytes }
  }

  memoryGet<T>(key: string): T | undefined {
    if (!this.config.enableCache) return undefined
    const entry = this.memory.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key)
      return undefined
    }
    return entry.value as T
  }

  memorySet(key: string, value: unknown, ttlMs = this.ttlMs): void {
    if (!this.config.enableCache) return
    this.memory.set(key, { value, expiresAt: Date.now() + ttlMs })
    if (this.memory.size > MAX_MEMORY_ENTRIES) this.pruneMemory()
  }

  memoryDelete(key: string): void {
    this.memory.delete(key)
  }

  clearMemory(): void {
    this.memory.clear()
  }

  private pruneMemory(): void {
    const now = Date.now()
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt <= now) this.memory.delete(key)
    }
    while (this.memory.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest)
    }
  }

  private thumbPath(url: string): string {
    return path.join(this.thumbDir, `${hashText(url)}.jpg`)
  }

  /** 读取磁盘缩略图（已转换为 JPEG） */
  async readThumb(url: string): Promise<Buffer | undefined> {
    if (!this.config.enableCache) return undefined
    try {
      return await fs.promises.readFile(this.thumbPath(url))
    } catch {
      return undefined
    }
  }

  async writeThumb(url: string, buffer: Buffer): Promise<void> {
    if (!this.config.enableCache) return
    try {
      await ensureDir(this.thumbDir)
      await fs.promises.writeFile(this.thumbPath(url), buffer)
      this.writesSinceCleanup++
      if (this.writesSinceCleanup >= 100) {
        this.writesSinceCleanup = 0
        void this.cleanup().catch(() => undefined)
      }
    } catch (error) {
      logger.debug(`[缓存] 写入缩略图失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  dispose(): void {
    this.memory.clear()
  }
}
