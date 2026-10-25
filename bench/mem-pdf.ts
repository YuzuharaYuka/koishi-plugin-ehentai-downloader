/**
 * PDF 打包内存探针：对指定目录里的真实页面做 buildPdf，采样 RSS。
 *   DIR=bench/out/speed/... PAGES=120 node bench/mem-pdf.cjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildPdf, type PageFile } from '../src/services/archive'

const DIR = process.env.DIR!
const LIMIT = Number(process.env.LIMIT ?? 0)

function mb(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(0)}MB` }

function pagesList(): PageFile[] {
  const files = fs.readdirSync(DIR).filter((f) => /\.(webp|jpg|jpeg|png|gif|bmp)$/i.test(f)).sort()
  const picked = LIMIT > 0 ? files.slice(0, LIMIT) : files
  return picked.map((name, i) => {
    const file = path.join(DIR, name)
    return { index: i + 1, path: file, extension: path.extname(name).slice(1), size: fs.statSync(file).size }
  })
}

async function main() {
  const pages = pagesList()
  const total = pages.reduce((sum, p) => sum + p.size, 0)
  const out = path.join(DIR, '..', 'mem-test.pdf')
  let peak = 0
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss
    if (rss > peak) peak = rss
  }, 20)
  const started = Date.now()
  const result = await buildPdf(pages, out, { password: process.env.PWD_PDF, onProgress: () => undefined })
  clearInterval(timer)
  console.log(`${pages.length} 页 源 ${mb(total)} → PDF ${mb(result.size)} 用时 ${Date.now() - started}ms 峰值RSS ${mb(peak)} 结束RSS ${mb(process.memoryUsage().rss)}`)
  fs.rmSync(out, { force: true })
}

void main()
