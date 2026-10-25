/**
 * 输出打包：PDF 与 ZIP。
 * 依赖都在调用时才加载，缺失时给出可读错误而不是让插件启动失败。
 */
import * as fs from 'fs'
import { PDF_EMBEDDABLE_EXTENSIONS, PDF_JPEG_QUALITY, PDF_MAX_EDGE } from '../constants'
import { fileSize, getErrorMessage, logger, removePath } from '../utils'
import { IMAGE_PROCESS_CONCURRENCY, decodeImage, encodeJpeg, releaseImage } from './image-codec'

export interface PageFile {
  index: number
  path: string
  extension: string
  size: number
}

export interface PackageOptions {
  password?: string
  /** PDF 内页长边上限，0 或省略表示不缩放 */
  maxEdge?: number
  onProgress?: (done: number, total: number) => void
}

export interface PackageResult {
  pages: number
  size: number
}

interface PdfReady {
  buffer: Buffer
  width: number
  height: number
}

/** 读取 PNG / JPEG 的尺寸（不解码像素） */
function readImageSize(buffer: Buffer, extension: string): { width: number, height: number } | undefined {
  const ext = extension.toLowerCase()
  if (ext === 'png') {
    if (buffer.length < 24) return undefined
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = buffer[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      const length = buffer.readUInt16BE(offset + 2)
      if (length <= 0) break
      offset += 2 + length
    }
  }
  return undefined
}

/**
 * PDF 只接受 jpeg / png：已在格式内的直接嵌入，其余格式（webp / gif / bmp）转 JPEG。
 * 尺寸超过 PDF_MAX_EDGE 的页会顺带缩放，避免个别超大图把文件撑大。
 */
async function preparePdfPage(page: PageFile, maxEdge: number): Promise<PdfReady | undefined> {
  const source = await fs.promises.readFile(page.path)
  const ext = page.extension.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') {
    const size = readImageSize(source, ext)
    return { buffer: source, ...(size ?? { width: 1, height: 1 }) }
  }
  const image = await decodeImage(source)
  if (!image) {
    // 解不出来就按原文件塞进去，交给 pdfkit 判断
    if (PDF_EMBEDDABLE_EXTENSIONS.has(ext)) {
      const size = readImageSize(source, ext)
      if (size) return { buffer: source, ...size }
    }
    logger.warn(`[PDF] 第 ${page.index} 页格式不受支持，已跳过。`)
    return undefined
  }
  try {
    // PNG 直接塞进 PDF 会被展开成原始像素再压缩，体积通常比源文件还大；统一转 JPEG
    let encoded = await encodeJpeg(image, PDF_JPEG_QUALITY, maxEdge > 0 ? maxEdge : undefined)
    if (encoded.buffer.length > source.length && PDF_JPEG_QUALITY > 70) {
      const lighter = await encodeJpeg(image, 70, maxEdge > 0 ? maxEdge : undefined)
      if (lighter.buffer.length < encoded.buffer.length) encoded = lighter
    }
    return encoded
  } finally {
    releaseImage(image)
  }
}

export async function buildPdf(pages: PageFile[], outPath: string, options: PackageOptions = {}): Promise<PackageResult> {
  const maxEdge = options.maxEdge ?? PDF_MAX_EDGE
  const { default: PDFDocument } = await import('pdfkit')
  const doc = new PDFDocument({
    autoFirstPage: false,
    userPassword: options.password,
    ownerPassword: options.password,
  })
  const output = fs.createWriteStream(outPath)
  const finished = new Promise<void>((resolve, reject) => {
    output.on('finish', () => resolve())
    output.on('error', reject)
  })
  doc.pipe(output)

  // 预读若干页后按顺序写入：解码与编码在等待上一页写入时已经并行完成
  const concurrency = Math.max(1, Math.min(IMAGE_PROCESS_CONCURRENCY, pages.length))
  const inflight: Promise<PdfReady | undefined>[] = []
  let cursor = 0
  const fill = () => {
    while (inflight.length < concurrency && cursor < pages.length) {
      inflight.push(preparePdfPage(pages[cursor++], maxEdge))
    }
  }
  fill()

  let written = 0
  let processed = 0
  try {
    while (inflight.length) {
      const ready = await inflight.shift()
      if (ready) {
        const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(ready.width, ready.height)) : 1
        const width = Math.round(ready.width * scale)
        const height = Math.round(ready.height * scale)
        doc.addPage({ size: [width, height], margin: 0 })
        doc.image(ready.buffer, 0, 0, { width, height })
        written++
      }
      processed++
      options.onProgress?.(processed, pages.length)
      fill()
    }
    if (!written) throw new Error('没有可写入 PDF 的页面')
    doc.end()
    await finished
  } catch (error) {
    doc.end()
    await removePath(outPath)
    throw new Error(`生成 PDF 失败: ${getErrorMessage(error)}`)
  }

  return { pages: written, size: await fileSize(outPath) }
}

export async function buildZip(pages: PageFile[], outPath: string, options: PackageOptions = {}): Promise<PackageResult> {
  const archiverModule = (await import('archiver')) as unknown as {
    default: {
      (format: string, archiveOptions?: Record<string, unknown>): {
        pipe<T extends NodeJS.WritableStream>(destination: T): T
        file(filepath: string, data?: Record<string, unknown>): void
        finalize(): Promise<void>
        on(event: 'error' | 'warning', listener: (error: Error) => void): void
        on(event: 'close', listener: () => void): void
      }
      registerFormat(format: string, module: unknown): void
      isRegisteredFormat(format: string): boolean
    }
  }
  const archiver = archiverModule.default
  const format = options.password ? 'zip-encrypted' : 'zip'
  const archiveOptions: Record<string, unknown> = { zlib: { level: 0 } }

  if (options.password) {
    try {
      const encrypted = (await import('archiver-zip-encrypted')) as unknown as { default: unknown }
      if (!archiver.isRegisteredFormat('zip-encrypted')) {
        archiver.registerFormat('zip-encrypted', encrypted.default)
      }
    } catch (error) {
      throw new Error(`加密 ZIP 需要 archiver-zip-encrypted，当前环境不可用: ${getErrorMessage(error)}`)
    }
    archiveOptions.encryptionMethod = 'aes256'
    archiveOptions.password = options.password
  }

  const zip = archiver(format, archiveOptions)
  const output = fs.createWriteStream(outPath)
  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve())
    output.on('error', reject)
    zip.on('error', reject)
    zip.on('warning', (warning) => logger.debug(`[ZIP] ${warning.message}`))
  })
  zip.pipe(output)

  const width = Math.max(3, String(pages.length).length)
  try {
    for (const [position, page] of pages.entries()) {
      zip.file(page.path, { name: `${String(page.index).padStart(width, '0')}.${page.extension}` })
      options.onProgress?.(position + 1, pages.length)
    }
    await zip.finalize()
    await finished
  } catch (error) {
    await removePath(outPath)
    throw new Error(`生成 ZIP 失败: ${getErrorMessage(error)}`)
  }

  return { pages: pages.length, size: await fileSize(outPath) }
}
