/**
 * 最近一次列表的短期缓存：让 `eh.download 3` 在菜单发出后仍能选中第 3 条，
 * 不必依赖 session.prompt 的等待窗口。
 */
import type { GalleryItem } from '../types'

export interface ListingSnapshot {
  items: GalleryItem[]
  page: number
  updatedAt: number
}

const DEFAULT_TTL_MS = 10 * 60 * 1000

export class ListingStore {
  private readonly entries = new Map<string, ListingSnapshot>()

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  save(key: string, items: GalleryItem[], page: number): void {
    this.entries.set(key, { items, page, updatedAt: Date.now() })
    this.prune()
  }

  get(key: string): ListingSnapshot | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.updatedAt > this.ttlMs) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  /** 按 1 起的序号取条目，越界返回 undefined */
  pick(key: string, index: number): GalleryItem | undefined {
    const entry = this.get(key)
    if (!entry) return undefined
    return entry.items[index - 1]
  }

  clear(): void {
    this.entries.clear()
  }

  private prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (now - entry.updatedAt > this.ttlMs) this.entries.delete(key)
    }
  }
}
