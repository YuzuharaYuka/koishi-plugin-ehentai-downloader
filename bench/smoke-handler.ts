/**
 * 用假 session 跑一遍搜索交互，验证 handler 层的图片菜单与回退。
 *   ../../node_modules/.bin/esbuild bench/smoke-handler.ts --bundle --platform=node \
 *     --external:@napi-rs/canvas --external:koishi --external:@koishijs/plugin-http \
 *     --external:cheerio --external:pdfkit --external:archiver \
 *     --external:archiver-zip-encrypted --outfile=bench/smoke-handler.cjs && node bench/smoke-handler.cjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import HTTP from '@koishijs/plugin-http'
import { Context, h } from 'koishi'
import { normalizeConfig, type Config } from '../src/config'
import { EhPlugin } from '../src/plugin'
import { handleSearch } from '../src/handlers/search'

const ROOT = path.join(process.cwd(), 'bench', 'out', 'smoke')

const config = normalizeConfig({
  site: 'auto',
  ehentaiMemberId: '4828133',
  ehentaiPassHash: '6887996e40daeae0d9747a5f86875ab',
  exhentaiMemberId: '9263923',
  exhentaiPassHash: 'a8e60f17af666fac7deb905d648f7402',
  exhentaiIgneous: 'm5sj0hxccm8ens1vz',
  downloadPath: ROOT,
  menuStyle: (process.env.MENU_STYLE as 'card' | 'grid' | 'text') ?? 'card',
  searchResultLimit: 9,
  requestInterval: 1000,
  downloadTimeout: 60,
} as unknown as Config)

interface Captured {
  type: string
  src?: string
  text: string
}

async function main(): Promise<void> {
  const ctx = new Context()
  ctx.plugin(HTTP)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await fs.mkdir(ROOT, { recursive: true })

  const plugin = new EhPlugin(ctx as never, config, ROOT)
  await plugin.initialize()

  const captured: Captured[] = []
  const queue: string[] = ['3']
  const session = {
    content: '',
    userId: 'bench',
    guildId: undefined,
    async send(content: unknown) {
      const nodes = Array.isArray(content) ? content : [content]
      const walk = (fragment: Iterable<never>) => {
        for (const element of fragment as Iterable<any>) {
          if (element.type === 'img') {
            captured.push({ type: 'img', src: String(element.attrs?.src ?? '').slice(0, 40), text: '' })
          } else if (element.type === 'text') {
            captured.push({ type: 'text', src: undefined, text: element.attrs?.content ?? '' })
          } else if (element.children) {
            walk(element.children)
          }
        }
      }
      for (const node of nodes) walk(h.normalize(node as never))
    },
    async prompt() {
      return queue.shift()
    },
    async execute(command: string) {
      console.log('  execute:', command)
      return undefined
    },
  }

  const startedAt = Date.now()
  await handleSearch(session as never, plugin, { query: 'language:chinese' }, { label: '中文' })
  console.log(`交互耗时 ${Date.now() - startedAt}ms`)

  const images = captured.filter((item) => item.type === 'img')
  const texts = captured.filter((item) => item.type === 'text')
  console.log(`图片 ${images.length} 张，文字 ${texts.length} 段`)
  for (const image of images) console.log('  image:', image.src.startsWith('data:') ? `data URI ${image.src.length}` : image.src)
  for (const text of texts.slice(0, 6)) console.log('  text:', text.text.replace(/\s+/g, ' ').slice(0, 90))
  plugin.dispose()
}

void main().then(() => process.exit(0), (error) => {
  console.error(error)
  process.exit(1)
})
