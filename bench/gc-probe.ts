import fs from 'node:fs'
import path from 'node:path'
import { decodeImage } from '../src/services/image-codec'

const DIR = process.env.DIR!
const MODE = process.env.MODE ?? 'plain'
const LIMIT = Number(process.env.LIMIT ?? 40)

function mb(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(0)}MB` }

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f)).sort().slice(0, LIMIT)
  for (const [i, name] of files.entries()) {
    const source = fs.readFileSync(path.join(DIR, name))
    const image = await decodeImage(source)
    if (!image) continue
    if (MODE === 'clear') {
      image.src = new Uint8Array(0)
    }
    if (i % 10 === 0) console.log(`${MODE} ${i} rss ${mb(process.memoryUsage().rss)}`)
  }
  console.log(`${MODE} 结束 rss ${mb(process.memoryUsage().rss)}`)
}

void main()
