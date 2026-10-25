/**
 * 第三方模块的类型补充：archiver 与 archiver-zip-encrypted 均未自带类型，
 * 这里只声明实际用到的结构，避免在业务代码里使用 as any。
 */
declare module 'archiver' {
  interface ArchiverOptions {
    zlib?: { level?: number }
    encryptionMethod?: string
    password?: string
    [key: string]: unknown
  }

  interface Archiver {
    pipe<T extends NodeJS.WritableStream>(destination: T): T
    file(filepath: string, data?: Record<string, unknown>): void
    append(source: Buffer | NodeJS.ReadableStream, data?: Record<string, unknown>): void
    finalize(): Promise<void>
    on(event: 'error' | 'warning', listener: (error: Error) => void): this
    on(event: 'close', listener: () => void): this
  }

  function archiver(format: string, options?: ArchiverOptions): Archiver

  namespace archiver {
    function registerFormat(format: string, module: unknown): void
    function isRegisteredFormat(format: string): boolean
  }

  export = archiver
}

declare module 'archiver-zip-encrypted' {
  const plugin: unknown
  export = plugin
}
