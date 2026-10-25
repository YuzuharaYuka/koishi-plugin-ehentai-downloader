/**
 * 插件运行时容器：集中创建服务，统一初始化与释放。
 */
import type { Context } from 'koishi'
import type { Config } from './config'
import { CacheStore } from './services/cache'
import { DownloadManager } from './services/download'
import { GalleryService } from './services/gallery'
import { EhHttpClient } from './services/http'
import { ImageService } from './services/image'
import { ListingStore } from './services/listing'
import { MenuRenderer } from './services/menu'
import { TaskStore } from './services/task'
import { logger } from './utils'

export class EhPlugin {
  readonly http: EhHttpClient
  readonly cache: CacheStore
  readonly galleries: GalleryService
  readonly images: ImageService
  readonly downloads: DownloadManager
  readonly menu: MenuRenderer
  readonly tasks = new TaskStore()
  readonly listings = new ListingStore()
  initialized = false

  constructor(
    readonly ctx: Context,
    readonly config: Config,
    readonly downloadPath: string,
  ) {
    this.http = new EhHttpClient(ctx, config)
    this.cache = new CacheStore(config, downloadPath)
    this.galleries = new GalleryService(this.http, config, this.cache)
    this.images = new ImageService(this.http, config, this.cache)
    this.downloads = new DownloadManager(config, this.http, this.galleries, this.images)
    this.menu = new MenuRenderer()
  }

  async initialize(): Promise<void> {
    await this.cache.initialize()
    this.initialized = true
    logger.info('[插件] 初始化完成')
  }

  /** 初始化未完成时给用户一个明确提示，返回 false 表示不应继续 */
  ensureReady(): boolean {
    if (this.initialized) return true
    return false
  }

  dispose(): void {
    this.tasks.clear()
    this.listings.clear()
    this.cache.dispose()
    logger.debug('[插件] 资源已释放')
  }
}
