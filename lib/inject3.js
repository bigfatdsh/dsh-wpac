// dsh-wpac 人格注入（1.9.0）。
//
// 实测结论（探针，2026-10-29）：
//   * 宿主把人格注册成 deployment:persona-prefix，预设里的 persona 行不会替换它；
//   * `systemPrompt.section()` 必须同时带 name 与 order，否则抛 "order must be a finite number"；
//   * `agentPresets.composedPreset(agent.ctx)` 返回预设 id 字符串，但在 agent/created 那一刻
//     可能还没绑定（新会话的 scope 绑定晚于事件），因此**不在创建时判断**，
//     而是把判断放进段的 text() 里，等每轮渲染时再算——此时绑定一定完成；
//   * text() 每次渲染都读 persona.md，改文案不用重启、不用重装。

import fs from 'node:fs';

const PERSONA_URL = new URL('../persona.md', import.meta.url);
const PRESET_ID = 'wpac';

/**
 * 读人格正文；读不到就返回空串（宁可没有段，也不要抛）。
 * @returns {string}
 */
function personaText() {
  try {
    return fs.readFileSync(PERSONA_URL, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * 渲染时判断这个 agent 是不是 WPAC 会话。
 * @param {object} presets
 * @param {object} agent
 * @returns {boolean}
 */
function isWpac(presets, agent) {
  let id = '';
  try {
    const composed = presets?.composedPreset?.(agent?.ctx);
    id = typeof composed === 'string' ? composed : (composed?.presetId ?? composed?.id ?? '');
  } catch {
    /* 退回会话头 */
  }
  if (!id) {
    id = agent?.session?.agentPreset
      ?? agent?.session?.header?.agentPreset
      ?? agent?.session?.state?.agentPreset
      ?? '';
  }
  return id === PRESET_ID;
}

export const name = 'dsh-wpac-persona';

export function apply(ctx) {
  const logger = ctx.logger;
  const presets = ctx.get?.('agentPresets');

  const off = ctx.on?.('agent/created', ({ agent } = {}) => {
    try {
      const sp = agent?.ctx?.systemPrompt;
      if (!sp || typeof sp.section !== 'function') return;
      sp.section({
        name: 'wpac:protocol',
        order: 10,
        text: () => (isWpac(presets, agent) ? personaText() : ''),
      });
    } catch (error) {
      logger?.warn?.(`[dsh-wpac] 人格段没挂上：${error?.message ?? error}`);
    }
  });

  ctx.effect(() => () => {
    if (typeof off === 'function') off();
  });
}
