// wpac 结构确认的工具行：让 wpac 的 agent 在工具表里真的看到 wpac_structure_review。
// 实现全在 ./review.js（端点 + 工具 + pending 队列），这里只做 Cordis 插件壳。
import fs from 'node:fs'
import { registerReview, REVIEW_LOG_PATH } from './review.js'

export const name = 'wpac-review-tools'

// Cordis 只把已 declare 的服务往 ctx 上挂。不写这一行，apply 时 ctx.get('tools') 和
// ctx.tools 都是 undefined，注册会静默 return —— 工具和 /dsh-wpac-review 端点都不出现。
export const inject = ['tools', 'webServer']

export function apply(ctx) {
  try {
    fs.appendFileSync(
      REVIEW_LOG_PATH,
      `[${new Date().toISOString()}] row wpac-review-tools apply\n`,
    )
  } catch { /* 只影响诊断 */ }
  registerReview(ctx)
}
