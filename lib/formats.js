// 交付物格式：一处定义，宿主和弹窗共用同一套文案。
//
// 为什么单独一个文件：格式（文字稿 / PPT / Word / PDF / 表格）以前散在 review.js 的
// FORMATS 和 client.js 的 FORMAT_META 里，加一种就得改两处、还容易漏。现在只有这里
// 是唯一真源：review.js 把 display 一起下发给浏览器，client.js 直接照着渲染。
//
// 每个条目给弹窗用的字段：
//   tag    表头标签（PPT / Word/文档 / PDF / 表格 / 文字稿）
//   struct 右侧标题（幻灯片结构 / 文档结构 / PDF 结构 / 表格结构 / 内容结构）
//   unit   模块单位（页 / 节 / 块 / 段）
//   body   详情里正文块的标题
//   kicker 详情里第一行的位置说明
//   job    summary 的标题（这一页要讲什么）
export const FORMAT_META = Object.freeze({
  prose: Object.freeze({
    tag: '文字稿', struct: '内容结构', unit: '段', body: '这段正文',
    kicker: '这一段在全文里的位置', job: '它干什么',
  }),
  slides: Object.freeze({
    tag: 'PPT', struct: '幻灯片结构', unit: '页', body: '这一页的内容',
    kicker: '这一页在汇报里的位置', job: '这页要讲什么',
  }),
  document: Object.freeze({
    tag: 'Word/文档', struct: '文档结构', unit: '节', body: '这一节的内容',
    kicker: '这一节在文档里的位置', job: '这节要写什么',
  }),
  pdf: Object.freeze({
    tag: 'PDF', struct: 'PDF 结构', unit: '页', body: '这一页的内容',
    kicker: '这一页在文件里的位置', job: '这页要讲什么',
  }),
  table: Object.freeze({
    tag: '表格', struct: '表格结构', unit: '块', body: '这一块的内容',
    kicker: '这一块在表里的位置', job: '这块放什么',
  }),
})

/** 支持的格式（工具 schema 的 enum 也用它）。 */
export const FORMATS = Object.freeze(Object.keys(FORMAT_META))

/** kind 里出现这些词时自动判格式，模型没给 format 也不至于错。 */
export function inferFormat(kind) {
  const text = String(kind || '').toLowerCase()
  if (/ppt|slides?|幻灯片|演示|路演|汇报页/.test(text)) return 'slides'
  if (/pdf/.test(text)) return 'pdf'
  if (/docx?|word|文档|报告|方案|论文|公文|简历/.test(text)) return 'document'
  if (/xlsx?|excel|表格|数据表|台账|csv/.test(text)) return 'table'
  return 'prose'
}

/** 归一化 format；非法值按 kind 猜。 */
export function resolveFormat(format, kind) {
  return FORMATS.includes(format) ? format : inferFormat(kind)
}

/** 某个格式的弹窗文案；未知格式退回文字稿。 */
export function formatMeta(format) {
  return FORMAT_META[format] || FORMAT_META.prose
}
