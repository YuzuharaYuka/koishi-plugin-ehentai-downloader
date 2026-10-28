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
import { handleRandom } from '../src/handlers/download'

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

  const plugin = new EhPlugin(ctx as never, config, ROOT)
  await plugin.initialize()

  const captured: string[] = []
  const queue: string[] = ['n']
  const session = {
    content: '',
    userId: 'bench',
    guildId: undefined,
    async send(content: unknown) {
      const nodes = Array.isArray(content) ? content : [content]
      const walk = (fragment: Iterable<never>) => {
        for (const element of fragment as Iterable<any>) {
          if (element.type === 'img') captured.push('<图片>')
          else if (element.type === 'text') captured.push(element.attrs?.content ?? '')
        }
      }
      for (const node of nodes) {
        if (typeof node === 'string') captured.push(node)
        else if (node && typeof (node as never)[Symbol.iterator] === 'function') walk((node as never)[Symbol.iterator]())
        else captured.push(String((node as { attrs?: { src?: string } }).attrs?.src ?? '<元素>').slice(0, 40))
      }
    },
    async prompt() {
      const next = queue.shift()
      return next ?? undefined
    },
    async execute(command: string) {
      captured.push(`<execute ${command}>`)
    },
  }

  await handleRandom(session as never, plugin)
  console.log('随机结果:')
  for (const line of captured) console.log(' ', String(line).slice(0, 120))
  await ctx.stop()
}

void main()
