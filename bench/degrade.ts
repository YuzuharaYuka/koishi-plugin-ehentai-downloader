/**
 * 验证缺少 @napi-rs/canvas 时的降级行为：插件能起来、菜单回退文字、PDF 给出提示。
 *   ../../node_modules/.bin/esbuild bench/degrade.ts --bundle --platform=node \
 *     --external:@napi-rs/canvas --external:koishi --external:@koishijs/plugin-http \
 *     --external:cheerio --external:pdfkit --external:archiver \
 *     --external:archiver-zip-encrypted --outfile=bench/degrade.cjs && node bench/degrade.cjs
 */
import Module from 'node:module'
import path from 'node:path'
import HTTP from '@koishijs/plugin-http'
import { Context } from 'koishi'
import { normalizeConfig } from '../src/config'
import { handleDownload } from '../src/handlers/download'
import { handleSearch } from '../src/handlers/search'
import { EhPlugin } from '../src/plugin'
import { canvasAvailable, requireCanvas } from '../src/services/canvas'

// 在插件首次用到 canvas 之前屏蔽它，模拟依赖没装上
const original = Module._resolveFilename
Module._resolveFilename = function (request: string, ...args: unknown[]): string {
  if (request === '@napi-rs/canvas') throw new Error("Cannot find module '@napi-rs/canvas'")
  return original.call(this, request, ...args)
}

const ROOT = path.join(process.cwd(), 'bench', 'out', 'degrade')

const config = normalizeConfig({
  site: 'auto',
  downloadPath: ROOT,
  menuStyle: 'card',
  searchResultLimit: 9,
  requestInterval: 1000,
  downloadTimeout: 60,
} as never)

const captured: { type: string, text: string }[] = []
const answers = ['退出']

function collect(node: unknown): void {
  if (node == null) return
  if (typeof node === 'string') {
    captured.push({ type: 'text', text: node })
    return
  }
  const element = node as { type?: string, attrs?: Record<string, unknown>, children?: unknown[] }
  if (element.type === 'text') captured.push({ type: 'text', text: String(element.attrs?.content ?? '') })
  else if (element.type === 'image') captured.push({ type: 'image', text: '' })
  else if (Array.isArray(element.children)) element.children.forEach(collect)
}

function createSession() {
  return {
    content: '',
    quote: () => '',
    userId: 'test',
    channelId: 'test',
    isDirect: true,
    async send(content: unknown) {
      const nodes = Array.isArray(content) ? content : [content]
      for (const node of nodes) collect(node)
    },
    async prompt() {
      return answers.shift()
    },
  }
}

async function main(): Promise<void> {
  const ctx = new Context()
  ctx.plugin(HTTP)
  await new Promise((resolve) => setTimeout(resolve, 300))

  console.log('canvasAvailable:', canvasAvailable())
  try {
    requireCanvas()
  } catch (error) {
    console.log('requireCanvas 提示:', (error as Error).message)
  }

  const plugin = new EhPlugin(ctx as never, config, ROOT)
  await plugin.initialize()
  const session = createSession()

  await handleSearch(session as never, plugin, { query: 'language:chinese' }, { label: '中文' })
  const images = captured.filter((item) => item.type === 'image').length
  const texts = captured.filter((item) => item.type === 'text').length
  console.log(`搜索：图片 ${images} 张，文字 ${texts} 段`)
  console.log('首行:', (captured.find((item) => item.type === 'text')?.text ?? '').slice(0, 46))

  captured.length = 0
  await handleDownload(session as never, plugin, '4281519', { format: 'pdf' } as never)
  console.log('PDF 提示:', (captured.find((item) => item.type === 'text')?.text ?? '').slice(0, 70))
}

void main()
