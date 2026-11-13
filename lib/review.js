// 结构确认（宿主半边：pending 队列 + HTTP 端点 + 工具）。
//
// 分工：
//   · createReviewBroker —— 纯逻辑，不碰 Cordis、不碰 socket，可单测；
//   · createEndpointHandler —— 浏览器半边（lib/client.js）轮询的 /dsh-wpac-review；
//   · createTool —— wpac 预设里的 `wpac_structure_review`；
//   · registerReview —— 把上面三样接到 Cordis 上下文（Cordis 里插件可无副作用加载）。
//
// 端点、工具的注册都尽量独立：任一半挂不上只告警，不让整个预设变「加载失败」。

import fs from 'node:fs'
import { FORMATS, inferFormat, resolveFormat, formatMeta } from './formats.js'

// 老测试/脚本从 review.js 拿这两个名字，保留兼容导出；实现只在 formats.js。
export { FORMATS, inferFormat }

/** 浏览器轮询的端点路径（改它要同步改 lib/client.js）。 */
export const REVIEW_PATH = '/dsh-wpac-review'

/** 启动期诊断日志：只落 /tmp，不上报。测试可用 WPAC_REVIEW_LOG 指到临时文件。 */
const REVIEW_LOG = process.env.WPAC_REVIEW_LOG || '/tmp/wpac-review-boot.log'

/** 给 tools.js 的行日志用（同一路径，测试时一起重定向）。 */
export const REVIEW_LOG_PATH = REVIEW_LOG

/** 入参 / 用户意见的限长，防异常输入把弹窗撑坏。 */
export const LIMITS = Object.freeze({
  title: 120,
  kind: 24,
  modules: 12,
  moduleId: 40,
  moduleTitle: 80,
  moduleRole: 80,
  summary: 400,
  text: 4000,
  feedback: 24,
  instruction: 2000,
})

/** 20s 内没有浏览器来取 → 判定客户端没挂上；用户思考上限 10 分钟。 */
export const TIMEOUTS = Object.freeze({
  noClient: 20000,
  overall: 10 * 60 * 1000,
})

/** 诊断日志（同步 append；写不进去就算了）。 */
export function rvlog(message) {
  try {
    fs.appendFileSync(REVIEW_LOG, `[${new Date().toISOString()}] ${message}\n`)
  } catch { /* 只影响诊断，不影响功能 */ }
}

/** 只留字符串并按上限截断。 */
export function clampText(value, max) {
  if (typeof value !== 'string') return ''
  return value.length > max ? value.slice(0, max) : value
}

/**
 * 工具入参 → 给浏览器看的 review。字段全部限长；模块最多 12 个。
 * @param {object} args 工具参数
 * @param {string} id 本次 pending 的 id
 * @param {typeof LIMITS} [limits]
 */
export function normalizeReview(args, id, limits = LIMITS) {
  const list = Array.isArray(args?.modules) ? args.modules : []
  return {
    id: String(id),
    title: clampText(args?.title, limits.title) || '结构确认',
    kind: clampText(args?.kind, limits.kind) || '任务',
    format: resolveFormat(args?.format, args?.kind),
    round: Math.min(2, Math.max(1, Number(args?.round) || 1)),
    // 弹窗文案（标签/单位/标题）由宿主下发，浏览器不再自己维护一份格式表。
    display: formatMeta(resolveFormat(args?.format, args?.kind)),
    modules: list.slice(0, limits.modules).map((module, index) => ({
      id: clampText(module?.id, limits.moduleId) || String(index + 1),
      title: clampText(module?.title, limits.moduleTitle) || `模块 ${index + 1}`,
      role: clampText(module?.role, limits.moduleRole),
      summary: clampText(module?.summary, limits.summary),
      // 这一段草稿的正文：弹窗右侧「选中模块」时展示的就是它。
      text: clampText(module?.text, limits.text),
    })),
  }
}

/** 浏览器回传的 feedback：只留三个字段，按条限长、最多 24 条，空意见丢掉。 */
export function cleanFeedback(list, limits = LIMITS) {
  if (!Array.isArray(list)) return []
  return list
    .slice(0, limits.feedback)
    .map((item) => ({
      moduleId: clampText(item?.moduleId, limits.moduleId),
      moduleTitle: clampText(item?.moduleTitle, limits.moduleTitle),
      instruction: clampText(item?.instruction, limits.instruction),
    }))
    .filter((item) => item.instruction.length > 0)
}

/**
 * 结构确认的 pending 队列。
 * @param {{ log?: (msg: string) => void, limits?: typeof LIMITS, timeouts?: typeof TIMEOUTS }} [deps]
 */
export function createReviewBroker(deps = {}) {
  const log = deps.log ?? rvlog
  const limits = deps.limits ?? LIMITS
  const timeouts = deps.timeouts ?? TIMEOUTS

  // 单槽：进程里同时只允许一条结构确认。新的一条进来时旧的作废（superseded），
  // 否则旧 pending 会在用户确认后又被轮询到，变成「弹两次窗」。
  let current = null
  const seen = { client: false, slot: false }
  let seq = 0

  function close(entry) {
    if (entry.timer) clearInterval(entry.timer)
    entry.timer = null
  }

  /**
   * 开一条 pending，等浏览器提交。
   * @param {object} args 工具参数
   * @returns {Promise<{ ok: boolean, action?: string, round?: number, feedback?: object[], reason?: string, message?: string }>}
   */
  function create(args) {
    if (current) {
      const stale = current
      current = null
      close(stale)
      stale.resolve({ ok: false, reason: 'superseded', message: '有更新的结构确认，这一条作废，不要交付' })
      log(`review superseded: #${stale.public.id}`)
    }
    seq += 1
    const review = normalizeReview(args, String(seq), limits)
    log(`review start: #${review.id} kind=${review.kind} format=${review.format} modules=${review.modules.length} withText=${review.modules.filter((m) => m.text).length}`)
    return new Promise((resolve) => {
      const entry = { public: review, lastPoll: 0, resolve, timer: null }
      current = entry
      const started = Date.now()
      entry.timer = setInterval(() => {
        if (current !== entry) { close(entry); return }
        const now = Date.now()
        if (entry.lastPoll === 0 && now - started > timeouts.noClient) {
          current = null
          close(entry)
          resolve({ ok: false, reason: 'no-client', message: '页面里没有结构确认客户端（弹窗没挂上），本轮没确认' })
        } else if (now - started > timeouts.overall) {
          current = null
          close(entry)
          resolve({ ok: false, reason: 'timeout', message: '用户没有提交' })
        }
      }, 1000)
    })
  }

  /** 浏览器 GET：取当前 pending；顺手记录「客户端第一次来」。 */
  function take() {
    if (!seen.client) {
      seen.client = true
      log('client half is alive: first poll')
    }
    if (!current) return null
    current.lastPoll = Date.now()
    return current.public
  }

  /** 浏览器 beacon：弹窗槽位真的挂上了。 */
  function noteSlot() {
    if (seen.slot) return
    seen.slot = true
    log('modal slot registered: shell.overlay')
  }

  /** 浏览器 POST：confirm / cancel。只有当前这条能被结算。 */
  function settle(id, payload) {
    if (!current || current.public.id !== String(id ?? '')) return false
    const entry = current
    current = null
    close(entry)
    const action = payload?.action === 'cancel' ? 'cancel' : 'confirm'
    const feedback = action === 'confirm' ? cleanFeedback(payload?.feedback, limits) : []
    log(`settle: ${action} round=${entry.public.round} feedback=${feedback.length}`)
    entry.resolve({ ok: true, action, round: entry.public.round, feedback })
    return true
  }

  return {
    create,
    take,
    settle,
    noteSlot,
    size: () => (current ? 1 : 0),
    seen,
  }
}

/** HTTP 端点处理器：GET 取结构，POST 交决定；?hello=1 是槽位 beacon。 */
export function createEndpointHandler(broker, log = rvlog) {
  return async function handler(req, res) {
    const send = (code, value) => {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(value))
    }
    if (req.method === 'GET') {
      if (String(req.url || '').includes('hello=1')) {
        broker.noteSlot()
        return send(200, { ok: true })
      }
      return send(200, { ok: true, review: broker.take() })
    }
    if (req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      let data = {}
      try { data = JSON.parse(body || '{}') } catch { /* 空 body 当取消处理 */ }
      broker.settle(data?.id, data)
      if (log !== undefined) log(`settle: ${data?.action ?? 'confirm'}`)
      return send(200, { ok: true })
    }
    return send(405, { ok: false, error: 'method not allowed' })
  }
}

/** 工具定义：把成稿结构交给用户在弹窗里按模块确认。 */
export function createTool(broker) {
  const description = [
    '把成稿的内容结构交给用户按模块确认（只有 wpac 会调）。弹窗在你的会话里独立出现，不在聊天里问。',
    '交付前最后一步调用：按交付物拆 4–12 个模块，每个给 id / title / role / summary / text（text 必填）。',
    'format 决定模块是什么：prose=文字稿按段；slides=PPT 按页；document=Word/报告按节；pdf=PDF 按页；table=表格按区域。模型不传就按 kind 猜。',
    '文件类交付（PPT/Word/PDF/表格）也走本工具，但前提是用户已经同意启用「文件类 WPAC（实验性）」；没问过、用户选不启用，就不要调本工具。',
    '  · title：这块在任务里干什么（如「难在哪」），不是内容概括；',
    '  · role：它在全文里的作用（开场 / 主体 / 转折 / 收束…）；',
    '  · summary：一句话说清这块落到哪个具体事实；',
    '  · text：这一块的内容原文，必填，不许摘要——文字稿贴这段正文；PPT 贴这一页的标题层级 + 要点 + 讲稿；Word 贴这一节正文；表格贴这块的列与行要点。用户点模块时弹窗右侧显示它。',
    '返回 { ok, action, round, feedback:[{moduleId, moduleTitle, instruction}] }。',
    'action=confirm 且有 feedback：只改对应模块，跑 preflight，然后直接交付——不要再弹一次窗（除非用户明确说「改完再给我看」）。',
    'action=confirm 且反馈为空：结构没问题，可以交付。',
    'action=cancel / reason=timeout / reason=no-client / reason=superseded：不许交付，如实告诉用户「弹窗没走完」或「这条作废了」，等下一句。',
    '弹窗只有一个「确认」按钮，没有关闭键：用户不确认就一直等（宿主最多等 10 分钟）。',
    'text 缺任何一块都会被打回（reason=missing-text），补上再调一次。',
    '禁止用 ask_user_question 或正文里的结构清单代替本工具。',
  ].join('')

  return {
    name: 'wpac_structure_review',
    description,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '这篇的标题' },
        kind: { type: 'string', description: '任务类型：观后感 / 报告 / 小说 / 口播 / 公文 / PPT / Word…' },
        format: {
          type: 'string',
          enum: FORMATS,
          description: '交付物结构类型：prose=文字稿按段；slides=PPT 按页；document=Word 按节；table=表格按区域',
        },
        round: { type: 'integer', description: '确认轮次，默认 1。用户明确要求复看时才可以传 2（正常情况下一次交付只弹一次）' },
        modules: {
          type: 'array',
          description: '交付物的结构模块（文字稿=段、PPT=页、Word=节、表格=区域），按交付顺序',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              role: { type: 'string', description: '这个模块在全文里起什么作用' },
              summary: { type: 'string', description: '一句话：这块落到哪个具体事实' },
              text: { type: 'string', description: '这一段的草稿正文，照原文贴，不要摘要' },
            },
            required: ['id', 'title', 'text'],
          },
        },
      },
      required: ['modules'],
    },
    output: {
      schema: { type: 'object', properties: {}, additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value ?? null) }],
    },
    async execute(args) {
      const modules = Array.isArray(args?.modules) ? args.modules : []
      if (!modules.length) {
        return { ok: false, reason: 'no-modules', message: '至少给 1 个结构模块（id / title / text）再调一次' }
      }
      const missing = modules.filter((module) => !String(module?.text ?? '').trim())
      if (missing.length) {
        return {
          ok: false,
          reason: 'missing-text',
          message: `${missing.length} 个模块没给 text（弹窗右侧要看正文）：${missing.map((m) => m?.title || m?.id).join(' / ')}。贴上原文再调一次。`,
        }
      }
      return broker.create(args)
    },
  }
}

/** Cordis 接线：端点 + 工具各自 try/catch，挂不上只告警。 */
let sharedBroker = null
let endpointMounted = false

/** 进程级单例：预设上下文重复挂载时，端点和工具共用同一条 pending 队列。 */
export function getReviewBroker() {
  if (!sharedBroker) sharedBroker = createReviewBroker()
  return sharedBroker
}

function registerReviewUnsafe(ctx) {
  const broker = getReviewBroker()
  const web = ctx.get?.('webServer') ?? ctx.webServer
  const toolsProbe = ctx.get?.('tools') ?? ctx.tools
  rvlog(`apply: web=${typeof web} web.register=${typeof web?.register} tools=${typeof toolsProbe} tools.register=${typeof toolsProbe?.register} mounted=${endpointMounted}`)

  if (web && typeof web.register === 'function' && !endpointMounted) {
    try {
      web.register({ kind: 'exact', path: REVIEW_PATH, handler: createEndpointHandler(broker) })
      endpointMounted = true
      rvlog('endpoint mounted: ' + REVIEW_PATH)
    } catch (error) {
      rvlog('endpoint failed: ' + (error?.message ?? error))
      ctx.logger?.warn?.(`[dsh-wpac] 结构端点没挂上：${error?.message ?? error}`)
    }
  }

  const tools = toolsProbe
  if (!tools || typeof tools.register !== 'function') return
  try {
    tools.register(createTool(broker))
    rvlog('tool registered: wpac_structure_review')
  } catch (error) {
    rvlog('tool register failed: ' + (error?.message ?? error))
    ctx.logger?.warn?.(`[dsh-wpac] 结构工具没注册上：${error?.message ?? error}`)
  }
}

/** 结构确认注册失败也不能让预设变「加载失败」。 */
export function registerReview(ctx) {
  try {
    registerReviewUnsafe(ctx)
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-wpac] 结构确认没挂上：${error?.message ?? error}`)
  }
}
