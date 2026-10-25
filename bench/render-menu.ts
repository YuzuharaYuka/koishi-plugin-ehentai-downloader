/**
 * 渲染样例菜单，用于目视检查版式。
 * 用 esbuild 打包后执行：
 *   node node_modules/.bin/esbuild bench/render-menu.ts --bundle --platform=node \
 *     --external:@napi-rs/canvas --outfile=bench/render-menu.cjs && node bench/render-menu.cjs
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createCanvas, Image } from '@napi-rs/canvas'
import type { GalleryDetail, GalleryItem } from '../src/types'
import { MenuRenderer } from '../src/services/menu'
import { decodeImage } from '../src/services/image-codec'

const OUT_DIR = path.join(process.cwd(), 'bench', 'out')

const TITLES = [
  '[Sanjou Tomomi] Bishoujo mesuinu Choukyou [Chinese] [中国翻訳]',
  '[Studio Kurage] Natsu no Owari ni (Kantai Collection) [English]',
  '(C105) [ESSENTIA (Fujima Takuya)] Natsu no Yakusoku',
  '[Ende AA] Saikyou Mizu Zokusei Majutsushi Ayuka VS Choutokushu Debuff Dungeon [Chinese] [机翻]',
  '[Kagura] Umi no Ie',
  '[Ntyplus] Toshishita no Kareshi',
  '[Fuzui Undou (Fuzui)] Bakunyuu InCha Doukyuusei',
  '[Oden Ohgan] Holy Bitch 1',
  '[Ebi no Implant] Otsukare Hito-',
]

const TAGS = ['big breasts', 'sole female', 'sole male', 'blowjob', 'futanari', 'rough translation', 'bikini', 'bondage', 'stockings', 'cheating']

/** 画一张假的封面，形状接近 EH 缩略图（200x290） */
async function fakeCover(index: number, width = 200, height = 290): Promise<Image> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const hue = (index * 47) % 360
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, `hsl(${hue}, 45%, 62%)`)
  gradient.addColorStop(1, `hsl(${(hue + 40) % 360}, 50%, 34%)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(0, 0, width, height * 0.24)
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.font = 'bold 64px "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(index), width / 2, height / 2)
  ctx.font = '16px "Microsoft YaHei", sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText('SAMPLE COVER', width / 2, height * 0.78)
  const image = await decodeImage(canvas.encodeSync('png'))
  if (!image) throw new Error('封面解码失败')
  return image
}

function sampleItems(count: number): GalleryItem[] {
  return Array.from({ length: count }, (_, i) => ({
    gid: 3400000 + i * 37,
    token: `token${i}`,
    title: TITLES[i % TITLES.length],
    category: i % 3 === 0 ? 'Doujinshi' : i % 3 === 1 ? 'Manga' : 'Artist CG',
    url: `https://exhentai.org/g/${3400000 + i * 37}/token${i}/`,
    pages: 20 + i * 9,
    uploader: 'someone',
    posted: '2024-1' + (i % 9) + '-12 08:30',
    rating: 4.5,
    tags: TAGS.slice(i % 4, (i % 4) + 3).map((tag, k) => ({ namespace: 'female', name: tag, key: `female:${tag}-${k}` })),
  })) as GalleryItem[]
}

function sampleDetail(): GalleryDetail {
  const base = sampleItems(1)[0] as GalleryDetail
  return {
    ...base,
    titleJpn: '[エンデ] 最強水属性魔術師アユカVS超特殊デバフダンジョン [中国翻訳]',
    site: 'exhentai',
    language: 'Chinese',
    fileSize: 128_000_000,
    favoriteCount: 2138,
    ratingCount: 128,
    torrentCount: 3,
    archiverAvailable: true,
    tags: TAGS.map((tag, i) => ({ namespace: i < 6 ? 'female' : 'other', name: tag, key: `${i < 6 ? 'female' : 'other'}:${tag}` })),
  } as GalleryDetail
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const menu = new MenuRenderer()

  const started = Date.now()
  const list = await menu.renderList(
    await Promise.all(sampleItems(9).map(async (item, i) => ({ item, cover: await fakeCover(i + 1) }))),
    { page: 2, pageCount: 20, total: 163123, hasPrev: true, hasNext: true, showTags: true },
  )
  const listMs = Date.now() - started
  const listPath = path.join(OUT_DIR, 'menu-list.jpg')
  await fs.writeFile(listPath, list.buffer)

  const noCover = await menu.renderList(
    [{ item: sampleItems(1)[0], cover: undefined }, { item: sampleItems(2)[1], cover: undefined }],
    { page: 1, pageCount: 1, hasPrev: false, hasNext: false, showTags: false },
  )
  await fs.writeFile(path.join(OUT_DIR, 'menu-list-empty.jpg'), noCover.buffer)

  const startedDetail = Date.now()
  const detail = await menu.renderGallery(sampleDetail(), await fakeCover(7, 340, 476), true)
  const detailMs = Date.now() - startedDetail
  await fs.writeFile(path.join(OUT_DIR, 'menu-detail.jpg'), detail.buffer)

  const kb = (buffer: Buffer) => `${(buffer.length / 1024).toFixed(0)}KB`
  console.log(`list   ${listMs}ms ${list.width}x${list.height} ${kb(list.buffer)}`)
  console.log(`detail ${detailMs}ms ${detail.width}x${detail.height} ${kb(detail.buffer)}`)
  console.log(`空封面 ${noCover.width}x${noCover.height} ${kb(noCover.buffer)}`)
  console.log(`输出目录 ${OUT_DIR}`)
}

void main()
