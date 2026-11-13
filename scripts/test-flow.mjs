#!/usr/bin/env node
// 结构确认「整条流程」的离线集成测试：真 HTTP + 真端点 + 真客户端 bundle + 假浏览器。
//
// 链路：工具 execute → pending → 浏览器半边轮询取到结构（这一步等价于弹窗弹出）
//       → 模拟用户点确认（POST feedback）→ 工具 resolve 出 feedback。
// 不依赖 DSH App、不依赖浏览器，任何机器都能跑；跑完打印每一步耗时。
//
// 用法：node scripts/test-flow.mjs

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 测试不要污染生产诊断日志
process.env.WPAC_REVIEW_LOG = path.join(os.tmpdir(), `wpac-flow-${process.pid}.log`)

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let failures = 0
const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { failures += 1; console.log(`  ✗ ${msg}`) }
const eq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(`${label} = ${JSON.stringify(actual)}`)
  else bad(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(what, check, timeout = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (check()) return Date.now() - started
    await sleep(50)
  }
  throw new Error(`等不到：${what}（${timeout}ms）`)
}

// 1×1 PNG（真文件，给预览端点用）
const PREVIEW_FILE = '/tmp/wpac-flow-preview.png'
fs.writeFileSync(PREVIEW_FILE, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))

console.log('整条流程（真 HTTP 往返）')

// ---- 1. 用生产代码起端点：registerReview 的接线路径 ------------------------
const routes = new Map()
let toolDef = null
const ctx = {
  get(name) {
    if (name === 'webServer') return { register: (route) => { routes.set(route.path, route) } }
    if (name === 'tools') return { register: (definition) => { toolDef = definition } }
    return undefined
  },
  logger: { warn() {} },
}
const { registerReview } = await import(pathToFileURL(path.join(root, 'lib/review.js')).href)
registerReview(ctx)
const reviewRoute = routes.get('/dsh-wpac-review')
const previewRoute = routes.get('/dsh-wpac-preview')
if (!reviewRoute) bad('端点没注册')
else ok('端点注册（review.js → webServer.register）')
if (!toolDef) bad('工具没注册')
else eq(toolDef.name, 'wpac_structure_review', '工具名')

const server = http.createServer((req, res) => {
  const path = String(req.url || '/').split('?')[0]
  const route = path === '/dsh-wpac-preview' ? previewRoute : reviewRoute
  if (!route) { res.statusCode = 404; res.end('{}'); return }
  route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
ok(`本地端点起来：${base}/dsh-wpac-review`)

// ---- 2. 假浏览器：真 fetch，相对路径补成 base；记下客户端看到的 review --------
const realFetch = globalThis.fetch
let lastReview = null
let helloSeen = false
const requested = []
globalThis.fetch = async (url, init) => {
  const raw = String(url)
  const target = raw.startsWith('/') ? base + raw : raw
  const method = (init && init.method) || 'GET'
  requested.push(`${method} ${raw}`)
  if (raw.includes('hello=1')) helloSeen = true
  const res = await realFetch(target, init)
  if (method === 'GET' && raw.includes('/dsh-wpac-review') && !raw.includes('hello=1')) {
    const copy = res.clone()
    const data = await copy.json().catch(() => null)
    if (data && data.review && data.review.id) lastReview = data.review
  }
  return res
}

let decl = null
globalThis.window = {
  __ModuleLoader__: { load: (value) => { decl = value } },
  addEventListener() {},
  removeEventListener() {},
}
const fakeReact = {
  createElement: () => null,
  Fragment: 'Fragment',
  useState: () => [0, () => {}],
  useEffect: () => {},
}
await import(pathToFileURL(path.join(root, 'lib/client.js')).href)
const plugin = decl.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error('客户端半边只能 require(react)，多了：' + name)
})
const slots = []
plugin.apply({
  slots: {
    inject: (name, callback) => callback(),
    register: (options) => { slots.push(options); return () => {} },
  },
})
eq(slots.map((s) => s.name), ['shell.overlay'], '客户端注册的槽位')
await waitFor('客户端第一次轮询', () => requested.some((r) => r.startsWith('GET /dsh-wpac-review')), 3000)
ok('客户端半边已在轮询端点（等价于弹窗已挂上）')
if (helloSeen) ok('槽位 beacon 已回（modal slot registered 会出现在宿主日志）')
else bad('槽位 beacon 没回')

// ---- 3. 工具调用 → 客户端取到结构（= 弹窗该弹了） ---------------------------
const args = {
  title: '劳模的路是一步步踩出来的',
  kind: '观后感',
  format: 'prose',
  round: 1,
  modules: [
    { id: 'm1', title: '到场，预期落空', role: '开场', summary: '以为奖状墙，先看到铁家伙', text: '进门之前我以为会看到一屋子奖状奖章。', preview: PREVIEW_FILE },
    { id: 'm2', title: '那些铁家伙', role: '主体', summary: '抓斗，卸木材靠人扛', text: '展柜里是抓斗，一个铁爪子张开合上。' },
  ],
}
const pending = toolDef.execute(args)
const waited = await waitFor('客户端取到结构', () => lastReview !== null, 5000)
ok(`工具挂 pending → 客户端取到结构（${waited}ms）`)
eq(lastReview.format, 'prose', '客户端拿到的 format')
eq(lastReview.modules.length, 2, '客户端拿到的模块数')
eq(lastReview.modules[0].text, '进门之前我以为会看到一屋子奖状奖章。', '客户端拿到的正文（右侧详情要显示）')
eq(lastReview.modules[0].hasPreview, true, '客户端知道这一块有预览图')
const imgRes = await realFetch(`${base}/dsh-wpac-preview?review=${encodeURIComponent(lastReview.id)}&module=m1`)
const imgBuf = Buffer.from(await imgRes.arrayBuffer())
eq(imgRes.status, 200, '预览图端点状态')
eq(imgRes.headers.get('content-type'), 'image/png', '预览图 MIME')
if (imgBuf.length > 60) ok(`预览图返回 ${imgBuf.length} 字节`)
else bad('预览图返回内容太小：' + imgBuf.length)
eq((await realFetch(`${base}/dsh-wpac-preview?review=${encodeURIComponent(lastReview.id)}&module=nope`)).status, 404, '不存在的模块 404')

// 缺正文会被打回、不开 pending
const rejected = await toolDef.execute({ title: 'x', modules: [{ id: 'a', title: '没正文' }] })
eq(rejected.reason, 'missing-text', '缺正文时打回原因')

// ---- 4. 模拟用户点「确认并修改」：POST feedback -----------------------------
const post = await realFetch(`${base}/dsh-wpac-review`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    id: lastReview.id,
    action: 'confirm',
    feedback: [
      { moduleId: 'm1', moduleTitle: '到场，预期落空', instruction: '开场写具体一点，别用「大受震撼」。' },
      { moduleId: 'm2', moduleTitle: '那些铁家伙', instruction: '' },
    ],
  }),
})
eq(post.status, 200, 'POST 状态')
const result = await pending
eq(result.ok, true, '工具返回 ok')
eq(result.action, 'confirm', '工具返回 action')
eq(result.round, 1, '工具返回 round')
eq(result.feedback.length, 1, '空意见被丢掉后的条数')
eq(result.feedback[0].moduleId, 'm1', 'feedback moduleId')
eq(result.feedback[0].instruction, '开场写具体一点，别用「大受震撼」。', 'feedback 正文')

// ---- 5. 弹窗开着时不重复拉（避免同一结构被反复弹） ---------------------------
const getCount = () => requested.filter((r) => r === 'GET /dsh-wpac-review').length
const whileOpen = getCount()
await sleep(1600)
eq(getCount(), whileOpen, '弹窗打开期间的 GET 次数（应不再拉）')

server.close()
globalThis.fetch = realFetch
console.log(failures ? `\n失败 ${failures} 项` : '\n整条流程跑通：工具 → 客户端取结构 → 用户确认 → feedback 回到工具')
process.exit(failures ? 1 : 0)
