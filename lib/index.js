// 入口只做转发：真正的实现与修正在 lib/inject.js。
// 分成两个文件是有意的——ESM 按 URL 缓存，改 index.js 必须重启才生效；
// 把实现放新文件并让 Loader 直接指向它，重装就能立刻生效。
export * from './inject.js';
