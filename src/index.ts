/**
 * 插件入口：注册指令、中间件与生命周期。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Context } from 'koishi'
import type {} from '@koishijs/plugin-console'
import type { Config } from './config'
import { PLUGIN_VERSION, SITES } from './constants'
import { installLinkRecognition } from './middleware'
import { EhPlugin } from './plugin'
import { canvasAvailable } from './services/canvas'
import { registerCommands } from './commands'
import { getErrorMessage, logger, resolveDownloadPath, setLoggerLevel } from './utils'

export * from './config'

export const name = 'ehentai-downloader'
export const inject = {
  required: ['http'],
  optional: ['console'],
}
export const version = PLUGIN_VERSION

const STALE_WORK_DIR_MS = 24 * 60 * 60 * 1000

export const usage = `
E-Hentai / ExHentai 画廊搜索与下载，**内容涉及成人向内容，请在合适的范围内使用**

指令前缀 \`eh\`（\`eh.指令\` / \`eh指令\` 均可）

| 指令 | 别名 | 说明 |
| :--- | :--- | :--- |
| \`eh.search <关键词>\` | \`eh搜索\` | 按关键词搜索，\`-l\` 筛选语言、\`-c\` 限定分类、\`-n\` 指定条数 |
| \`eh.download <ID/链接>\` | \`eh下载\` | 下载画廊，\`-p\` PDF、\`-z\` ZIP、\`-i\` 逐张图片、\`-k\` 密码 |
| \`eh.toplist [类型]\` | \`eh排行\` | 表站排行榜，类型如 \`all-time\`、\`past-month\` |
| \`eh.popular\` | \`eh热门\` | 当前热门画廊 |
| \`eh.random\` | \`eh随机\` | 随机抽一个画廊，回 \`Y\` 下载 |
| \`eh.info <ID/链接>\` | \`eh详情\` | 查看画廊详情 |
| \`eh.cancel\` | \`eh取消\` | 取消当前会话的下载 |
| \`eh.retry\` | \`eh重试\` | 只补下上次失败的页 |

搜索结果回复序号即可下载，\`F\` 下一页、\`B\` 上一页、\`N\` 退出

账号凭据：登录 [E-hentai](https://e-hentai.org/) / [Exhentai](https://exhentai.org/) 后按 F12 → Application(应用) → Cookies → e-hentai.org / exhentai.org，把 \`ipb_member_id\`、\`ipb_pass_hash\` 填到「账号」，只有具备里站资格的账号，才能获取到能够正常进站的 \`igneous\`，该凭据可能变化，失效时需要重新获取并更新
`

/** 清理超过一天未使用的工作目录，保留缓存目录 */
async function cleanupWorkDir(downloadPath: string): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(downloadPath)
  } catch {
    return
  }
  let removed = 0
  const now = Date.now()
  for (const entry of entries) {
    if (entry === 'cache') continue
    const target = path.join(downloadPath, entry)
    try {
      const info = await fs.stat(target)
      if (!info.isDirectory() || now - info.mtimeMs < STALE_WORK_DIR_MS) continue
      await fs.rm(target, { recursive: true, force: true })
      removed++
    } catch {
      // 清理失败不影响启动
    }
  }
  if (removed) logger.info(`已清理 ${removed} 个过期工作目录`)
}

export function apply(ctx: Context, config: Config): void {
  setLoggerLevel(Boolean(config.debug))
  config.downloadPath = resolveDownloadPath(ctx.baseDir, config.downloadPath)
  const plugin = new EhPlugin(ctx, config, config.downloadPath)

  installLinkRecognition(ctx, config)
  registerCommands(ctx, () => plugin)

  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: path.resolve(__dirname, '../client/index.ts'),
      prod: path.resolve(__dirname, '../dist'),
    })
  })

  ctx.on('ready', async () => {
    try {
      await cleanupWorkDir(config.downloadPath)
      await plugin.initialize()
      const site = plugin.http.primarySite
      logger.info(`站点 ${SITES[site].label}，输出格式 ${config.defaultFormat}，并发 ${config.downloadConcurrency}，取图 ${config.imageQuality}`)
      if (config.debug) logger.debug('调试日志已开启')
      if (!canvasAvailable()) {
        logger.warn('未加载 @napi-rs/canvas：菜单改用文字列表，PDF 不可用；在项目目录执行 yarn install 后重启即可恢复')
      }

      if (!plugin.http.hasCredentials(site)) {
        logger.warn(`未配置 ${SITES[site].label}凭据：只能浏览公开画廊，原图与里站不可用`)
        if (config.imageQuality === 'original') logger.warn('取图设置为原图，但原图需要登录，实际会退回缩放版')
      } else {
        const status = await plugin.http.probeLogin(site).catch(() => 'invalid' as const)
        if (status === 'ok') logger.info(`${SITES[site].label}凭据可用`)
        else logger.warn(`${SITES[site].label}凭据不可用，请更新配置里的 Cookie`)
      }
    } catch (error) {
      const message = getErrorMessage(error)
      logger.error(`初始化失败: ${message}`)
      if (/Cannot find module '(pdfkit|archiver|archiver-zip-encrypted|cheerio)/.test(message)) {
        logger.error('缺少依赖：在 Koishi 项目目录执行 yarn install 后重启')
      }
    }
  })

  ctx.on('dispose', () => {
    plugin.dispose()
  })
}
