// dsh-wpac 人格注入（预设级，唯一实现）。
//
// 为什么挂在预设里、而不是宿主级 agent/created：
//   * 宿主把人格注册成 deployment:persona-prefix，预设里的 persona 行会被忽略；
//   * 宿主级的 agent/created 监听里调用 systemPrompt.section()，注册成功但不进 assemble()
//     （实测：调用不报错，段数一直是 12），怀疑段要挂在 agent 自己的上下文上；
//   * 预设里的插件本来就挂进 agent 上下文（工具面就是这么来的），所以把注入做成预设内的一行插件，
//     apply 时直接 ctx.systemPrompt.section(...)，时机在会话第一次组装之前。

import fs from 'node:fs';

const PERSONA_URL = new URL('../persona.md', import.meta.url);

/**
 * 每轮现读人格正文，改文案不用重启。
 * @returns {string}
 */
function personaText() {
  try {
    return fs.readFileSync(PERSONA_URL, 'utf8').trim();
  } catch {
    return '';
  }
}

export const name = 'dsh-wpac-persona';

// Cordis 要求先声明 inject，才能读 ctx.systemPrompt（否则报
// "cannot get property "systemPrompt" without inject"）。
export const inject = ['systemPrompt'];

export function apply(ctx) {
  const sp = ctx.systemPrompt;
  if (!sp || typeof sp.section !== 'function') {
    ctx.logger?.warn?.('[dsh-wpac] 预设上下文里没有 systemPrompt.section');
    return;
  }
  sp.section({
    name: 'wpac:protocol',
    order: 10,
    text: () => personaText(),
  });
}
