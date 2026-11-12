// wpac 结构确认的工具行：让 wpac 的 agent 在工具表里真的看到 wpac_structure_review。
import { registerReview } from './inject6.js'

export const name = 'wpac-review-tools'

export function apply(ctx) {
  registerReview(ctx)
}
