/**
 * 翻页枚举耗时：getPages 需要多少次请求、多久。
 */
import path from 'node:path'
import HTTP from '@koishijs/plugin-http'
import { Context } from 'koishi'
import { normalizeConfig, type Config } from '../src/config'
import { CacheStore } from '../src/services/cache'
import { GalleryService } from '../src/services/gallery'
import { EhHttpClient } from '../src/services/http'
import { setLoggerLevel } from '../src/utils'

async function main() {
  const config = normalizeConfig({
    site: 'auto',
    exhentaiMemberId: '9263923',
    exhentaiPassHash: 'a8e60f17af666fac7deb905d648f7402',
    exhentaiIgneous: 'm5sj0hxccm8ens1vz',
    downloadPath: path.join(process.cwd(), 'bench', 'out', 'pager'),
    requestInterval: 300,
    debug: true,
  } as Config)
  setLoggerLevel(true)
  const ctx = new Context()
  ctx.plugin(HTTP)
  await new Promise((r) => setTimeout(r, 300))
  const http = new EhHttpClient(ctx, config)
  const cache = new CacheStore(config, config.downloadPath)
  await cache.initialize()
  const galleries = new GalleryService(http, config, cache)

  const startedAll = Date.now()
  const gallery = await galleries.resolve(process.env.GID ?? '4280941')
  const resolvedAt = Date.now()
  const list = await galleries.getPages(gallery, gallery.pages ?? 0)
  const doneAt = Date.now()
  console.log(`画廊 ${gallery.gid} ${gallery.pages} 页`)
  console.log(`解析 ${resolvedAt - startedAll}ms，翻页 ${doneAt - resolvedAt}ms，共 ${list.entries.length} 条`)
  cache.dispose()
}

void main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
