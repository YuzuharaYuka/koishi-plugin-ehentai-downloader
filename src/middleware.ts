/**
 * 链接自动识别：消息中的画廊链接直接触发下载。
 */
import type { Context, Next, Session } from 'koishi'
import type { Config } from './config'
import { GALLERY_URL_SEARCH_REGEX } from './constants'
import { logger } from './utils'

export function installLinkRecognition(ctx: Context, config: Config): void {
  ctx.middleware(async (session: Session, next: Next) => {
    if (!config.enableLinkRecognition) return next()
    const content = session.stripped?.content ?? session.content
    // 已经是指令调用时不再拦截，避免循环
    const prefix = session.resolve('eh')
    if (prefix && session.stripped?.content?.trimStart().startsWith(prefix)) return next()

    const match = GALLERY_URL_SEARCH_REGEX.exec(content)
    if (!match) return next()
    const url = match[0]
    logger.debug(`[链接识别] 捕获画廊链接: ${url}`)
    return session.execute(`eh.download ${url}`)
  })
}
