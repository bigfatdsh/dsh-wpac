// dsh-wpac 人格注入（最终版）。
//
// 运行事实（2026-10-29 实测，别再踩）：
//   1. 预设里的 `persona` 行会被部署级人格顶掉，所以人格改由本插件注册一段 system prompt；
//   2. Cordis 要求先声明 `inject = ['systemPrompt']`，否则 apply 里读 ctx.systemPrompt 直接报错，
//      整个预设会被标成「加载失败」；
//   3. `systemPrompt.section()` 必须同时给 name 与 order；
//   4. 注册发生在预设挂载时（agent 创建过程中），此时机早于第一次 prompt 组装，能进最终 system 消息；
//   5. 事后用 `assemble()` 去看段列表是**看不出来的**（它只反映部署级段），
//      要验证得读会话里的 system 消息本体（deriveMessages）。
//
// text() 每轮现读 persona.md：改文案不用重启、不用重装。

import fs from 'node:fs';

const PERSONA_URL = new URL('../persona.md', import.meta.url);

/** persona.md 丢了也会有一份能用的兜底，不让会话变成无人格。 */
const FALLBACK = [
  '你是 **WPAC**：先把委托拆成 W/P/A/C，再动笔。',
  '追问固定四轮，一轮只问一个槽：W 身份 → P 目的 → A 受众 → C 约束，问完就停等回答，四轮走完才写。',
  '交付正文时回复里只有正文，不加说明、字数、客套；正片无小标题、无列表、少形容词。',
  '文字类口语化优先，专业词直接用不解释。',
].join('\n');

/**
 * 读人格正文；空文件或读失败时用兜底。
 * @returns {string}
 */
function personaText() {
  try {
    const text = fs.readFileSync(PERSONA_URL, 'utf8').trim();
    return text === '' ? FALLBACK : text;
  } catch {
    return FALLBACK;
  }
}

export const name = 'dsh-wpac-persona';

export const inject = ['systemPrompt'];

export function apply(ctx) {
  try {
    const sp = ctx.systemPrompt;
    if (!sp || typeof sp.section !== 'function') {
      ctx.logger?.warn?.('[dsh-wpac] 预设上下文里没有 systemPrompt.section，人格未挂载');
      return;
    }
    sp.section({
      name: 'wpac:protocol',
      order: 10,
      text: () => personaText(),
    });
  } catch (error) {
    // 重复挂载会抛「already registered」；吞掉但不能让预设因此变 broken。
    ctx.logger?.warn?.(`[dsh-wpac] 人格段没挂上：${error?.message ?? error}`);
  }
}
