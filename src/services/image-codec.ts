/**
 * 基于 @napi-rs/canvas 的图片编解码：
 * - 缩略图统一缩到 320 宽后压成 JPEG；
 * - PDF 只嵌入 jpeg / png，其余格式先转 JPEG；
 * - 解码与编码都是原生实现，不需要再引入 sharp。
 */
import { Image, createCanvas } from '@napi-rs/canvas'
import { getErrorMessage, logger } from '../utils'

/** 像素处理并发数：canvas 的编码走 libuv 线程池，超过线程池大小会拖慢甚至崩溃 */
export const IMAGE_PROCESS_CONCURRENCY = 4

const DECODE_TIMEOUT_MS = 10_000

const EMPTY = new Uint8Array(0)

/**
 * 释放解码后的位图。
 * napi-canvas 的 Image 持有一整块原生位图（1280×1871 约 9 MB），这部分内存 V8 感知不到，
 * 光靠 GC 回收不掉：不手动清空 src，几百页的 PDF 会把进程撑到数 GB。
 */
export function releaseImage(image: { src: Uint8Array | string } | undefined): void {
  if (!image) return
  try {
    image.src = EMPTY
  } catch {
    // 部分版本的 src 不可写，忽略
  }
}

/** 解码图片，失败或超时返回 undefined */
export async function decodeImage(buffer: Buffer): Promise<Image | undefined> {
  if (!buffer.length) return undefined
  const image = new Image()
  image.src = buffer
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('decode failed'))
      }),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('decode timeout')), DECODE_TIMEOUT_MS)
      }),
    ])
    return image.width && image.height ? image : undefined
  } catch (error) {
    logger.debug(`[图片] 解码失败: ${getErrorMessage(error)}`)
    return undefined
  }
}

/** 把图片缩放到目标宽度（不放大），并编码为 JPEG */
export async function resizeToJpeg(
  buffer: Buffer,
  width: number,
  quality: number,
): Promise<{ buffer: Buffer, width: number, height: number } | undefined> {
  const image = await decodeImage(buffer)
  if (!image) return undefined

  try {
    const scale = Math.min(1, width / image.width)
    const targetWidth = Math.max(1, Math.round(image.width * scale))
    const targetHeight = Math.max(1, Math.round(image.height * scale))
    const canvas = createCanvas(targetWidth, targetHeight)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetWidth, targetHeight)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

    const encoded = await canvas.encode('jpeg', quality)
    return { buffer: Buffer.from(encoded), width: targetWidth, height: targetHeight }
  } finally {
    releaseImage(image)
  }
}

/** 解码后重新编码为 JPEG（透明区域铺白底），用于 PDF 嵌入 */
export async function toJpeg(
  buffer: Buffer,
  quality: number,
  maxEdge?: number,
): Promise<{ buffer: Buffer, width: number, height: number } | undefined> {
  const image = await decodeImage(buffer)
  if (!image) return undefined
  try {
    return await encodeJpeg(image, quality, maxEdge)
  } finally {
    releaseImage(image)
  }
}

/** 已经解码过的图片直接编码，避免为试探压缩率重复解码 */
export async function encodeJpeg(
  image: Image,
  quality: number,
  maxEdge?: number,
): Promise<{ buffer: Buffer, width: number, height: number }> {
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(image.width, image.height)) : 1
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)

  const encoded = await canvas.encode('jpeg', quality)
  return { buffer: Buffer.from(encoded), width, height }
}
