/**
 * 插件内部的数据结构。所有面向站点页面的字段都保持原始语义，不做展示层加工。
 */

/** 站点类型：表站 / 里站 */
export type Site = 'e-hentai' | 'exhentai'

/** 输出格式 */
export type OutputFormat = 'pdf' | 'zip' | 'img'

/** 图片质量：原图 / 页面缩放版 */
export type ImageQuality = 'original' | 'resized'

/** 配置里的站点选择，auto 表示优先里站 */
export type SiteOption = 'auto' | Site

/** 画廊标签 */
export interface GalleryTag {
  namespace: string
  name: string
}

/** 列表页（搜索 / 排行 / 收藏 / 热门）中的一条画廊 */
export interface GalleryItem {
  gid: number
  token: string
  title: string
  category: string
  url: string
  pages?: number
  uploader?: string
  thumbUrl?: string
  posted?: string
  rating?: number
  tags: GalleryTag[]
}

/** 画廊详情页解析结果 */
export interface GalleryDetail extends GalleryItem {
  titleJpn?: string
  site: Site
  visible?: string
  parentGid?: number
  language?: string
  fileSize?: number
  favoriteCount?: number
  ratingCount?: number
  torrentCount?: number
  archiverAvailable: boolean
  tags: GalleryTag[]
}

/** 图廊中的一页 */
export interface GalleryPageEntry {
  /** 1 基页码 */
  index: number
  pageToken: string
  pageUrl: string
  filename?: string
  thumbUrl?: string
}

/** 图廊分页结果 */
export interface GalleryPageList {
  entries: GalleryPageEntry[]
  totalPages: number
}

/** 图片页解析结果 */
export interface ImagePageInfo {
  /** 图片页展示的缩放版地址 */
  resizedUrl?: string
  /** Download original 指向的原图地址 */
  originalUrl?: string
  filename?: string
  width?: number
  height?: number
  sizeText?: string
  /** 多页查看器画廊，无法直接取图 */
  mpv: boolean
}

/** 一页下载成功后的落盘信息 */
export interface DownloadedPage {
  index: number
  path: string
  extension: string
  size: number
}

/** 列表页解析结果 */
export interface SearchListing {
  results: GalleryItem[]
  nextUrl?: string
  countText?: string
}

/** 下载任务选项 */
export interface DownloadOptions {
  format: OutputFormat
  quality: ImageQuality
  concurrency: number
  password?: string
  /** 只下载这些页码（1 基）；为空表示全部 */
  indexes?: number[]
}

/** 下载结果 */
export interface DownloadOutcome {
  gallery: GalleryDetail
  options: DownloadOptions
  /** PDF / ZIP 的文件路径 */
  filePath?: string
  /** 逐张输出时的文件路径 */
  imageFiles: DownloadedPage[]
  failedIndexes: number[]
  total: number
  successCount: number
  /** 逐张输出时的图片目录 */
  partialDir?: string
  elapsedMs: number
}

/** 进度回调载荷 */
export interface DownloadProgress {
  downloaded: number
  total: number
  failed: number
}
