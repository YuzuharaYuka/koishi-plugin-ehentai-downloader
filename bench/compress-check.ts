import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCanvas, Image } from '@napi-rs/canvas'
import { buildPdf, type PageFile } from '../src/services/archive'

async function makePage(dir: string, index: number, width: number, height: number): Promise<PageFile> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#eeeeee'
  ctx.fillRect(0, 0, width, height)
  const data = ctx.createImageData(width, height)
  for (let i = 0; i < data.data.length; i += 4) {
    data.data[i] = (i * 2654435761) & 0xff
    data.data[i + 1] = (i * 40503) & 0xff
    data.data[i + 2] = (i * 69069) & 0xff
    data.data[i + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  const buffer = canvas.toBuffer('image/jpeg', 92)
  const file = path.join(dir, `${index}.jpg`)
  fs.writeFileSync(file, buffer)
  return { index, path: file, extension: 'jpg', size: buffer.length }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-compress-'))
  const pages = [await makePage(dir, 1, 1280, 1871), await makePage(dir, 2, 1600, 2300)]
  console.log('源文件:', pages.map((p) => `${(p.size / 1024).toFixed(0)}KB`).join(' / '))

  const runs: Array<[string, Parameters<typeof buildPdf>[2]]> = [
    ['threshold 500（小图跳过）', { compression: { enabled: true, quality: 90, threshold: 500, maxEdge: 3000 } }],
    ['threshold 0（全部重编码）', { compression: { enabled: true, quality: 90, threshold: 0, maxEdge: 3000 } }],
    ['关闭压缩', { compression: { enabled: false, quality: 90, threshold: 0, maxEdge: 3000 } }],
  ]
  for (const [label, options] of runs) {
    const out = path.join(dir, `${label.replace(/[^\w]/g, '_')}.pdf`)
    const started = Date.now()
    const result = await buildPdf(pages, out, options)
    console.log(`${label}: ${(result.size / 1024).toFixed(0)}KB, ${Date.now() - started}ms`)
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

void main()
