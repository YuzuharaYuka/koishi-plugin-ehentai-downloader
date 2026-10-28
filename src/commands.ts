/**
 * 指令注册。入口保持薄：只做参数解析与转发。
 */
import type { Context } from 'koishi'
import {
  GALLERY_URL_REGEX,
  GID_REGEX,
  IMAGE_URL_REGEX,
  LANGUAGE_ALIASES,
  MESSAGES,
  TOPLIST_LABELS,
} from './constants'
import type { EhPlugin } from './plugin'
import { handleSearch, handleToplist, handlePopular } from './handlers/search'
import { promptAnswer } from './handlers/common'
import { handleDownload, handleGalleryInfo, handleRandom } from './handlers/download'
import { handleCancel, handleRetry } from './handlers/manage'
import { logger } from './utils'

type PluginGetter = () => EhPlugin

function isGalleryInput(input: string): boolean {
  const value = input.trim()
  if (GID_REGEX.test(value)) return true
  if (GALLERY_URL_REGEX.test(value)) return true
  if (IMAGE_URL_REGEX.test(value)) return true
  return false
}

function normalizeLanguageOption(input: string | undefined): string | undefined {
  if (!input) return undefined
  const key = input.trim().toLowerCase()
  if (LANGUAGE_ALIASES[key]) return LANGUAGE_ALIASES[key]
  return input
}

export function registerCommands(ctx: Context, getPlugin: PluginGetter): void {
  ctx.command('eh', 'E-Hentai / ExHentai 搜索与下载')
    .alias('ehentai')
    .usage('使用 `eh.help` 查看子指令，或直接发送画廊链接（需开启链接自动识别）。')

  ctx.command('eh.search [query:text]', '按关键词搜索画廊')
    .alias('eh搜索', 'ehsearch')
    .option('category', '-c <category:string> 只搜索指定分类，多个用逗号分隔')
    .option('language', '-l <language:string> 语言筛选：chinese、japanese、english、korean、translated')
    .option('limit', '-n <count:number> 本次展示条数（覆盖配置值）')
    .option('grid', '--grid 用缩略图型菜单')
    .option('text', '--text 用文字列表代替图片菜单')
    .option('noTags', '--no-tags 不展示标签')
    .option('forward', '--forward 强制使用合并转发')
    .usage('关键词支持 EH 搜索语法，例如 `f:full_color`、`artist:`、`language:chinese`。\n示例: eh.search 千反田 -c doujinshi -l chinese')
    .example('eh.search 千反田')
    .action(async ({ session, options }, query) => {
      if (!session) return
      const plugin = getPlugin()
      if (!plugin.ensureReady()) return session.send(MESSAGES.notInitialized)
      const language = normalizeLanguageOption(options?.language as string | undefined)
      let text = (query ?? '').trim()
      if (!text && !options?.category) {
        await session.send('发关键词，我直接搜。')
        const answer = await promptAnswer(session, plugin.config.promptTimeout * 1000)
        if (!answer) return session.send(MESSAGES.promptTimeout)
        text = answer
      }
      const limit = Number.parseInt(String(options?.limit ?? ''), 10)
      await handleSearch(session, plugin, {
        query: text,
        language,
        category: options?.category as string | undefined,
      }, {
        limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 25) : undefined,
        menuStyle: options?.text ? 'text' : options?.grid ? 'grid' : undefined,
        showTags: options?.noTags ? false : undefined,
        useForward: options?.forward ? true : undefined,
      })
    })

  ctx.command('eh.download <input:text>', '下载画廊（ID、链接或图片页链接）')
    .alias('eh下载', 'ehdownload')
    .option('pdf', '-p 输出为 PDF')
    .option('zip', '-z 输出为 ZIP')
    .option('image', '-i 输出为图片')
    .option('key', '-k <password:string> 压缩包 / PDF 密码')
    .option('noPassword', '--no-password 不使用密码')
    .option('pages', '-r <pages:string> 页码范围，例如 1-20、1,3,5')
    .option('quality', '-q <quality:string> 图片质量：original、resized')
    .usage('未指定格式时使用配置中的默认格式。\n示例: eh.download https://exhentai.org/g/4281216/3ede3090c5/ -p')
    .example('eh.download 4281216')
    .action(async ({ session, options }, input) => {
      if (!session) return
      const plugin = getPlugin()
      if (!plugin.ensureReady()) return session.send(MESSAGES.notInitialized)
      const value = (input ?? '').trim()
      if (!value) return session.send('用法：eh.download <ID | 链接 | 菜单序号>')
      if (!isGalleryInput(value)) {
        if (/^\d{1,2}$/.test(value)) {
          return session.send(`没找到序号 ${value}，先 eh.search 出菜单再回序号，或直接发画廊链接。`)
        }
        return session.send(MESSAGES.invalidGalleryInput)
      }
      await handleDownload(session, plugin, value, {
        pdf: Boolean(options?.pdf),
        zip: Boolean(options?.zip),
        image: Boolean(options?.image),
        key: options?.key as string | undefined,
        noPassword: Boolean(options?.noPassword),
        pages: options?.pages as string | undefined,
        quality: options?.quality as string | undefined,
      })
    })

  ctx.command('eh.toplist [type:text]', '查看排行榜（仅表站）')
    .alias('eh排行', 'ehtoplist')
    .option('page', '-p <page:number> 页码')
    .usage(`可用类型: ${Object.keys(TOPLIST_LABELS).join('、')}。\n示例: eh.toplist past-month`)
    .example('eh.toplist all-time')
    .action(async ({ session, options }, type) => {
      if (!session) return
      const plugin = getPlugin()
      if (!plugin.ensureReady()) return session.send(MESSAGES.notInitialized)
      const page = Number.parseInt(String(options?.page ?? '1'), 10)
      await handleToplist(session, plugin, type?.trim(), Number.isInteger(page) ? page : 1)
    })

  ctx.command('eh.popular', '查看当前热门画廊')
    .alias('eh热门', 'ehpopular')
    .usage('示例: eh.popular')
    .action(async ({ session }) => {
      if (!session) return
      const plugin = getPlugin()
      if (!plugin.ensureReady()) return session.send(MESSAGES.notInitialized)
      await handlePopular(session, plugin)
    })

  ctx.command('eh.random', '随机抽一个画廊')
    .alias('eh随机', 'ehrandom')
    .action(async ({ session }) => {
      if (!session) return
      await handleRandom(session, getPlugin())
    })

  ctx.command('eh.info <input:text>', '查看单个画廊的详细信息')
    .alias('eh详情', 'ehinfo')
    .example('eh.info 4281216')
    .action(async ({ session }, input) => {
      if (!session) return
      const plugin = getPlugin()
      const value = (input ?? '').trim()
      if (!value) return session.send(MESSAGES.invalidGalleryInput)
      await handleGalleryInfo(session, plugin, value)
    })

  ctx.command('eh.cancel', '取消当前会话进行中的下载')
    .alias('eh取消', 'ehcancel')
    .action(async ({ session }) => {
      if (!session) return
      await handleCancel(session, getPlugin())
    })

  ctx.command('eh.retry', '重试最近一次下载失败的页面')
    .alias('eh重试', 'ehretry')
    .action(async ({ session }) => {
      if (!session) return
      await handleRetry(session, getPlugin())
    })

  logger.debug('[指令] 已注册 eh 指令集')
}
