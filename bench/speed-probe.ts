/**
 * 下载速度探针：同一画廊、不同 requestInterval / 并发，比较页/秒与失败。
 *   INTERVAL=300 CONCURRENCY=6 PAGES=1-60 node bench/speed-probe.cjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import HTTP from '@koishijs/plugin-http'
import { Context } from 'koishi'
import { normalizeConfig, type Config } from '../src/config'
import { CacheStore } from '../src/services/cache'
import { DownloadManager } from '../src/services/download'
import { GalleryService } from '../src/services/gallery'
import { EhHttpClient } from '../src/services/http'
import { ImageService } from '../src/services/image'
import { TaskStore } from '../src/services/task'

const ROOT = path.join(process.cwd(), 'bench', 'out', 'speed')
const GID = process.env.GID ?? '4280941'
const INTERVAL = Number(process.env.INTERVAL ?? 300)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6)
const RANGE = process.env.PAGES ?? '1-60'
const QUALITY = (process.env.QUALITY ?? 'resized') as 'resized' | 'original'

function parseRange(text: string): number[] {
  const [start, end] = text.split('-').map(Number)
  const out: number[] = []
  for (let i = start; i <= (end ?? start); i++) out.push(i)
  return out
}

function mb(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)}MB` }

async function main(): Promise<void> {
  const config = normalizeConfig({
    site: 'auto',
    ehentaiMemberId: '4828133',
    ehentaiPassHash: '6887996e40daeae0d9747a5f86875ab',
    exhentaiMemberId: '9263923',
    exhentaiPassHash: 'a8e60f17af666fac7deb905d648f7402',
    exhentaiIgneous: 'm5sj0hxccm8ens1vz',
    downloadPath: ROOT,
    downloadConcurrency: CONCURRENCY,
    requestInterval: INTERVAL,
    downloadTimeout: 60,
    downloadRetries: 1,
    retryDelay: 2,
    imageQuality: QUALITY,
    maxPages: 300,
    enableCache: true,
    debug: false,
  } as Config)

  const ctx = new Context()
  ctx.plugin(HTTP)
  await new Promise((resolve) => setTimeout(resolve, 300))

  const http = new EhHttpClient(ctx, config)
  const cache = new CacheStore(config, ROOT)
  await cache.initialize()
  const galleries = new GalleryService(http, config, cache)
  const images = new ImageService(http, config, cache)
  const downloads = new DownloadManager(config, http, galleries, images)
  const tasks = new TaskStore()

  const gallery = await galleries.resolve(GID)
  const indexes = parseRange(RANGE)
  const task = tasks.start('speed', gallery, { format: 'img', quality: QUALITY, concurrency: CONCURRENCY, indexes }, downloads.dirFor(gallery))

  let peak = 0
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss
    if (rss > peak) peak = rss
  }, 50)

  const started = Date.now()
  const outcome = await downloads.download(task, {
    onProgress: () => undefined,
    onPackageProgress: () => undefined,
  })
  clearInterval(timer)
  const elapsed = (Date.now() - started) / 1000
  const bytes = outcome.imageFiles.reduce((sum, file) => sum + file.size, 0)
  console.log(`gid ${gallery.gid} 页数 ${indexes.length} 并发 ${CONCURRENCY} 间隔 ${INTERVAL}ms 质量 ${QUALITY}`)
  console.log(`用时 ${elapsed.toFixed(1)}s，${(indexes.length / elapsed).toFixed(2)} 页/秒，${mb(bytes)}，失败 ${outcome.failedIndexes.length}，峰值RSS ${mb(peak)}`)
  tasks.finish('speed')
  cache.dispose()
}

void main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
