/**
 * 真实站点端到端下载校验：PDF / ZIP / 逐页图片。
 *   ../../node_modules/.bin/esbuild bench/download-e2e.ts --bundle --platform=node \
 *     --external:@napi-rs/canvas --external:koishi --external:@koishijs/plugin-http \
 *     --external:cheerio --external:pdfkit --external:archiver \
 *     --external:archiver-zip-encrypted --outfile=bench/download-e2e.cjs && node bench/download-e2e.cjs
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

const ROOT = path.join(process.cwd(), 'bench', 'out', 'e2e')

const config = normalizeConfig({
  site: 'auto',
  ehentaiMemberId: '4828133',
  ehentaiPassHash: '6887996e40daeae0d9747a5f86875ab',
  exhentaiMemberId: '9263923',
  exhentaiPassHash: 'a8e60f17af666fac7deb905d648f7402',
  exhentaiIgneous: 'm5sj0hxccm8ens1vz',
  downloadPath: ROOT,
  downloadConcurrency: 3,
  requestInterval: 1000,
  downloadTimeout: 60,
  downloadRetries: 2,
  retryDelay: 2,
  maxOutputMb: 0,
  enableCache: true,
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
  const downloads = new DownloadManager(config, http, galleries, images)
  const tasks = new TaskStore()

  const result = await galleries.search('language:chinese', undefined, undefined)
  const candidate = result.items.find((item) => (item.pages ?? 0) > 0 && (item.pages ?? 0) <= 24)
  if (!candidate) throw new Error('没找到小体积画廊')
  const gallery = await galleries.resolve(candidate.url)
  console.log(`画廊 ${gallery.gid} ${gallery.pages} 页 ${gallery.title.slice(0, 40)}`)

  for (const format of ['pdf', 'zip', 'img'] as const) {
    const task = tasks.start(`bench-${format}`, gallery, { format, quality: 'original', concurrency: config.downloadConcurrency }, downloads.dirFor(gallery))
    const startedAt = Date.now()
    const outcome = await downloads.download(task, {
      onProgress: (done, total, failed) => {
        if (done === total) console.log(`  ${format}: ${done}/${total} 页，失败 ${failed}`)
      },
      onPackageProgress: () => undefined,
    })
    const size = outcome.filePath ? (await fs.stat(outcome.filePath)).size : 0
    console.log(`${format} ${Date.now() - startedAt}ms ${(size / 1024 / 1024).toFixed(2)}MB 页数 ${outcome.pages} 失败 ${outcome.failedIndexes.length}`)
    if (outcome.filePath) console.log('  ->', path.relative(ROOT, outcome.filePath))
    tasks.finish(`bench-${format}`)
  }
  cache.dispose()
}

void main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
