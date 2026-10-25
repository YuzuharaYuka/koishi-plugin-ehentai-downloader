/**
 * 并发探测：同一画廊、同样的 6 页原图，比较不同并发下的耗时与吞吐。
 *   ../../node_modules/.bin/esbuild bench/concurrency-probe.ts --bundle --platform=node \
 *     --external:@napi-rs/canvas --external:koishi --external:@koishijs/plugin-http \
 *     --external:cheerio --external:pdfkit --external:archiver \
 *     --external:archiver-zip-encrypted --outfile=bench/concurrency-probe.cjs && node bench/concurrency-probe.cjs
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

const ROOT = path.join(process.cwd(), 'bench', 'out', 'concurrency')
const GALLERY = '4281222'
const PAGES = '1-6'
const LEVELS = [4, 8, 4]

const config = normalizeConfig({
  site: 'auto',
  ehentaiMemberId: '4828133',
  ehentaiPassHash: '6887996e40daeae0d9747a5f86875ab',
  exhentaiMemberId: '9263923',
  exhentaiPassHash: 'a8e60f17af666fac7deb905d648f7402',
  exhentaiIgneous: 'm5sj0hxccm8ens1vz',
  downloadPath: ROOT,
  imageQuality: 'original',
  requestInterval: 1000,
  downloadTimeout: 60,
  downloadRetries: 2,
  retryDelay: 2,
  maxOutputMb: 0,
  enableCache: false,
} as Config)

async function main(): Promise<void> {
  const ctx = new Context()
  ctx.plugin(HTTP)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await fs.rm(ROOT, { recursive: true, force: true })
  await fs.mkdir(ROOT, { recursive: true })

  const http = new EhHttpClient(ctx, config)
  const cache = new CacheStore(config, ROOT)
  await cache.initialize()
  const galleries = new GalleryService(http, config, cache)
  const images = new ImageService(http, config, cache)
  const tasks = new TaskStore()
  const gallery = await galleries.resolve(GALLERY)
  console.log(`画廊 ${gallery.gid} ${gallery.pages} 页，测试 ${PAGES}`)

  for (const concurrency of LEVELS) {
    const downloads = new DownloadManager({ ...config, downloadConcurrency: concurrency }, http, galleries, images)
    const task = tasks.start(`probe-${concurrency}`, gallery, {
      format: 'img',
      quality: 'original',
      concurrency,
      indexes: [1, 2, 3, 4, 5, 6],
    }, downloads.dirFor(gallery))
    const startedAt = Date.now()
    try {
      const outcome = await downloads.download(task, { onProgress: () => undefined, onPackageProgress: () => undefined })
      const elapsed = Date.now() - startedAt
      const bytes = outcome.imageFiles.reduce((sum, page) => sum + page.size, 0)
      const mib = bytes / 1024 / 1024
      console.log(`并发 ${concurrency}: ${elapsed}ms，${mib.toFixed(1)}MiB，${(mib / (elapsed / 1000)).toFixed(2)} MiB/s，失败 ${outcome.failedIndexes.length}`)
    } catch (error) {
      console.log(`并发 ${concurrency}: 失败 ${String(error)}`)
    }
    tasks.finish(`probe-${concurrency}`)
    await fs.rm(path.join(ROOT, `${gallery.gid}-*`), { recursive: true, force: true }).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  cache.dispose()
}

void main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
