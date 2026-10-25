/**
 * 匿名（不填 Cookie）访问表站的可行性验证。
 */
import HTTP from '@koishijs/plugin-http'
import { Context } from 'koishi'
import { normalizeConfig } from '../src/config'
import { CacheStore } from '../src/services/cache'
import { GalleryService } from '../src/services/gallery'
import { EhHttpClient } from '../src/services/http'
import { ImageService } from '../src/services/image'

async function main() {
  const ctx = new Context()
  ctx.plugin(HTTP)
  await new Promise((resolve) => setTimeout(resolve, 300))

  const config = normalizeConfig({
    site: 'e-hentai',
    ehentaiMemberId: process.env.CREDS ? '4828133' : '',
    ehentaiPassHash: process.env.CREDS ? '6887996e40daeae0d9747a5f86875ab' : '',
    exhentaiMemberId: '',
    exhentaiPassHash: '',
    exhentaiIgneous: '',
    menuStyle: 'card',
    searchResultLimit: 5,
    searchLanguage: 'all',
    showTags: true,
    useForwardForList: false,
    promptTimeout: 60,
    defaultFormat: 'pdf',
    imageQuality: process.env.QUALITY === 'original' ? 'original' : 'resized',
    pdfMaxEdge: 3000,
    downloadConcurrency: 2,
    requestInterval: 1000,
    downloadTimeout: 60,
    downloadRetries: 2,
    retryDelay: 3,
    maxPages: 300,
    defaultPassword: '',
    imageSendMode: 'auto',
    imageSendDelay: 1,
    downloadPath: './data/temp/ehentai-downloader',
    prependGid: true,
    enableCache: true,
    cacheMaxSizeMb: 256,
    cacheTtlHours: 24,
    enableLinkRecognition: false,
    debug: false,
  } as any)

  const downloadPath = './data/temp/ehentai-downloader-anon'
  const http = new EhHttpClient(ctx, config)
  const cache = new CacheStore(config, downloadPath)
  await cache.initialize()
  const galleries = new GalleryService(http, config, cache)
  const images = new ImageService(http, config, cache)

  console.log('hasCredentials(e-hentai):', http.hasCredentials('e-hentai'))

  const result = await galleries.search(process.env.GID ? `gid:${process.env.GID}` : 'language:chinese')
  console.log('搜索:', result.items.length, '条，站点', result.site, '总数', result.total)
  const item = result.items[0]
  console.log('首条:', item.gid, item.category, item.pages, '页')

  const detail = await galleries.resolve(item.url)
  console.log('详情:', detail.gid, detail.title.slice(0, 40), '收藏', detail.favoriteCount, '评分', detail.rating)
  const pageList = await galleries.getPages(detail, 4)
  console.log('页数:', pageList.entries.length, '| 总页数', pageList.total)

  const entry = pageList.entries[0]
  const resolved = await images.resolvePage(detail, entry)
  console.log('取图:', resolved.resized ? '缩放版' : '原图', resolved.url.slice(0, 50))

  const target = resolved.url
  if (!target) return console.log('两路都没有链接')
  const file = `${downloadPath}/probe.jpg`
  await http.downloadMedia(target, file)
  const { promises: fs } = await import('node:fs')
  const size = (await fs.stat(file)).size
  console.log('下载成功:', Math.round(size / 1024), 'KB', target.slice(0, 60))
  await fs.rm(file, { force: true })
  process.exit(0)
}

void main().catch((error) => {
  console.error('失败:', error?.constructor?.name, String(error?.message ?? error).slice(0, 200))
  console.error(String(error?.stack ?? '').split(String.fromCharCode(10)).slice(0, 8).join(String.fromCharCode(10)))
  process.exit(1)
})
