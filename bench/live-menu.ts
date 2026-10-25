/**
 * 用真实站点数据渲染一张菜单，验证版式与抓取链路。
 *   node node_modules/.bin/esbuild bench/live-menu.ts --bundle --platform=node \
 *     --external:@napi-rs/canvas --external:koishi --external:@koishijs/plugin-http \
 *     --external:cheerio --external:pdfkit --external:archiver \
 *     --external:archiver-zip-encrypted --outfile=bench/live-menu.cjs && node bench/live-menu.cjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import HTTP from '@koishijs/plugin-http'
import { Context } from 'koishi'
import { normalizeConfig, type Config } from '../src/config'
import { CacheStore } from '../src/services/cache'
import { GalleryService } from '../src/services/gallery'
import { EhHttpClient } from '../src/services/http'
import { ImageService } from '../src/services/image'
import { decodeImage } from '../src/services/image-codec'
import { MenuRenderer, type MenuListItem } from '../src/services/menu'

const OUT_DIR = path.join(process.cwd(), 'bench', 'out')
const DOWNLOAD_PATH = path.join(process.cwd(), 'data', 'temp', 'ehentai-downloader')

const config = normalizeConfig({
  site: 'auto',
  enableLinkRecognition: false,
  menuStyle: 'card',
  ehentaiMemberId: '4828133',
  ehentaiPassHash: '6887996e40daeae0d9747a5f86875ab',
  exhentaiMemberId: '9263923',
  exhentaiPassHash: 'a8e60f17af666fac7deb905d648f7402',
  exhentaiIgneous: 'm5sj0hxccm8ens1vz',
  searchResultLimit: 9,
  searchLanguage: 'all',
  showTags: true,
  useForwardForList: false,
  promptTimeout: 60,
  defaultFormat: 'pdf',
  imageQuality: 'original',
  downloadConcurrency: 2,
  requestInterval: 1000,
  downloadTimeout: 60,
  downloadRetries: 2,
  retryDelay: 3,
  maxPages: 0,
  maxOutputMb: 0,
  defaultPassword: '',
  imageSendDelay: 1,
  imageSendMode: 'auto',
  downloadPath: DOWNLOAD_PATH,
  prependGid: true,
  enableCache: true,
  cacheMaxSizeMb: 256,
  cacheTtlHours: 24,
  debug: false,
} as Config)

async function main(): Promise<void> {
  const ctx = new Context()
  ctx.plugin(HTTP)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await fs.mkdir(OUT_DIR, { recursive: true })

  const http = new EhHttpClient(ctx, config)
  const cache = new CacheStore(config, DOWNLOAD_PATH)
  await cache.initialize()
  const galleries = new GalleryService(http, config, cache)
  const images = new ImageService(http, config, cache)
  const menu = new MenuRenderer()

  const searchStart = Date.now()
  const result = await galleries.search('language:chinese', undefined, undefined)
  console.log(`搜索 ${result.items.length} 条，共 ${result.total}，${Date.now() - searchStart}ms，站点 ${result.site}`)

  const items = result.items.slice(0, 9)
  const thumbStart = Date.now()
  const covers = await Promise.all(items.map(async (item) => {
    if (!item.thumbUrl) return undefined
    const jpeg = await images.thumbnailJpeg(item.thumbUrl)
    return jpeg ? decodeImage(jpeg) : undefined
  }))
  console.log(`缩略图 ${covers.filter(Boolean).length}/${covers.length}，${Date.now() - thumbStart}ms`)

  const entries: MenuListItem[] = items.map((item, i) => ({ item, cover: covers[i] }))
  const renderStart = Date.now()
  const list = await menu.renderList(entries, {
    page: 1,
    pageCount: 20,
    total: result.total,
    hasPrev: false,
    hasNext: Boolean(result.nextUrl),
    showTags: true,
  })
  await fs.writeFile(path.join(OUT_DIR, 'live-list.jpg'), list.buffer)
  console.log(`列表 ${Date.now() - renderStart}ms ${list.width}x${list.height} ${(list.buffer.length / 1024).toFixed(0)}KB`)

  const gridStart = Date.now()
  const grid = await menu.renderGrid(entries, {
    page: 1,
    pageCount: 20,
    total: result.total,
    hasPrev: false,
    hasNext: Boolean(result.nextUrl),
    showTags: true,
  })
  await fs.writeFile(path.join(OUT_DIR, 'live-grid.jpg'), grid.buffer)
  console.log(`网格 ${Date.now() - gridStart}ms ${grid.width}x${grid.height} ${(grid.buffer.length / 1024).toFixed(0)}KB`)

  const first = items[0]
  if (!first) throw new Error('没有搜索结果')
  const detailStart = Date.now()
  const detail = await galleries.resolve(process.env.DETAIL_URL || `https://${result.site === 'exhentai' ? 'exhentai.org' : 'e-hentai.org'}/g/${first.gid}/${first.token}/`)
  const cover = detail.thumbUrl
    ? await images.thumbnailJpeg(detail.thumbUrl).then((jpeg) => (jpeg ? decodeImage(jpeg) : undefined))
    : undefined
  const rendered = await menu.renderGallery(detail, cover, true)
  await fs.writeFile(path.join(OUT_DIR, 'live-detail.jpg'), rendered.buffer)
  console.log(`详情 ${Date.now() - detailStart}ms ${rendered.width}x${rendered.height} ${(rendered.buffer.length / 1024).toFixed(0)}KB`)
  console.log(`封面地址 ${detail.thumbUrl ?? '(空)'} 收藏 ${detail.favoriteCount ?? '-'} 评分 ${detail.rating ?? '-'} 语言 ${detail.language ?? '-'}`)
  const galleryHtml = await http.fetchText(detail.url)
  await fs.writeFile(path.join(OUT_DIR, 'gallery.html'), galleryHtml.html)
  const coverIdx = galleryHtml.html.indexOf('id="gd1"')
  console.log('gd1:', galleryHtml.html.slice(Math.max(0, coverIdx - 60), coverIdx + 320).replace(/\s+/g, ' '))
  console.log(`输出目录 ${OUT_DIR}`)
  cache.dispose()
}

void main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
