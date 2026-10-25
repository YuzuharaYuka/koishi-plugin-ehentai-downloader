/**
 * @napi-rs/canvas 的懒加载入口。
 *
 * 这个包是原生模块。下列情况会让它加载失败：
 * - 依赖没能装上（安装时 Koishi 正在运行，Windows 会锁住 skia.*.node，link 阶段报 EPERM）；
 * - 用户在插件市场点了更新但没重启，node_modules 处于半更新状态。
 *
 * 静态 import 会在插件加载阶段就抛错，整个插件连带崩掉，用户只看得到一段堆栈。
 * 这里改成运行时探测：缺依赖时插件照常启动，菜单退回文字列表、PDF 给出明确提示。
 */
import type { Canvas, Image, SKRSContext2D } from '@napi-rs/canvas'

export type { Canvas, Image, SKRSContext2D }

type CanvasModule = typeof import('@napi-rs/canvas')

const INSTALL_HINT = 'PDF 与图片菜单需要 @napi-rs/canvas，请在 Koishi 项目目录执行 yarn install 后重启'

let canvasModule: CanvasModule | null | undefined

/** 取 canvas 模块，加载失败返回 undefined（只尝试一次） */
export function loadCanvas(): CanvasModule | undefined {
  if (canvasModule !== undefined) return canvasModule ?? undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    canvasModule = require('@napi-rs/canvas') as CanvasModule
  } catch {
    canvasModule = null
  }
  return canvasModule ?? undefined
}

/** 依赖是否可用，用于决定走图片菜单还是文字菜单 */
export function canvasAvailable(): boolean {
  return Boolean(loadCanvas())
}

/** 取 canvas 模块，缺失时抛出可读的错误 */
export function requireCanvas(): CanvasModule {
  const module = loadCanvas()
  if (!module) throw new Error(INSTALL_HINT)
  return module
}
