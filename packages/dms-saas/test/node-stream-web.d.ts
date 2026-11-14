export {};

declare module "node:stream/web" {
  /**
   * The source a default `ReadableStream` reads, which happy-dom's
   * declarations name and `@types/node` declares only from version 25.
   */
  type UnderlyingDefaultSource<R> = UnderlyingSource<R>;
}
