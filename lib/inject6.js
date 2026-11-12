// dsh-wpac 宿主半边的入口：只做转发。
//
// 文件名是契约：cordis.patch.yml 里预设的 `wpac-persona` 行指向 `dsh-wpac/inject`
// （package.json exports → ./lib/inject6.js）。ESM 按 URL 缓存，实现换文件可以，
// 但这个入口名别动；它只负责把人格插件面重新导出。
//
//   · 人格：./persona.js
//   · 结构确认（端点 + 工具）：./review.js，由 `dsh-wpac/tools` 行加载
//   · 浏览器半边：./client.js，由 profile Loader 里的 `dsh-wpac` 锚点行带进页面
export { name, inject, apply } from './persona.js'
