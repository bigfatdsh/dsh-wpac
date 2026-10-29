// dsh-wpac 人格注入（实现，唯一一份）。
//
// 背景（全部来自探针实测）：
//   * 宿主把人格段注册成 deployment:persona-prefix，预设里的 persona 行在 agent 挂载时被忽略；
//   * 事件参数是 { agent, source, signal }，不是 agent 本身；
//   * `agentPresets.composedPreset(agent.ctx)` 直接返回预设 id 字符串（如 'wpac'）；
//   * `systemPrompt.section()` 必须带 name 和 order（否则报 "order must be a finite number"），
//     而且必须在 agent/created 当场挂——晚一步就不进 assemble()（实测补挂无效）。

import fs from 'node:fs';

const PROTOCOL = fs.readFileSync(new URL('../persona.md', import.meta.url), 'utf8').trim();

/** 目标预设 id；改预设 id 时同步这里。 */
const PRESET_ID = 'wpac';

/**
 * 读 agent 所属的预设 id。
 * @param {object} presets
 * @param {object} agent
 * @returns {string}
 */
function presetOf(presets, agent) {
  try {
    const composed = presets?.composedPreset?.(agent?.ctx);
    if (typeof composed === 'string' && composed !== '') return composed;
    const id = composed?.presetId ?? composed?.id ?? composed?.config?.id;
    if (typeof id === 'string' && id !== '') return id;
  } catch {
    /* 退回会话头 */
  }
  return agent?.session?.agentPreset
    ?? agent?.session?.header?.agentPreset
    ?? agent?.session?.state?.agentPreset
    ?? '';
}

/**
 * 给匹配的 agent 挂上 WPAC 协议段。
 * @param {object} agent
 * @param {object} logger
 * @returns {{ok: boolean, why?: string}}
 */
function attach(agent, logger) {
  try {
    const sp = agent?.ctx?.systemPrompt;
    if (!sp || typeof sp.section !== 'function') return { ok: false, why: 'no systemPrompt.section' };
    sp.section({ name: 'wpac:protocol', order: 10, text: () => PROTOCOL });
    return { ok: true };
  } catch (error) {
    logger?.warn?.(`[dsh-wpac] 人格段没挂上：${error?.message ?? error}`);
    return { ok: false, why: String(error?.message ?? error) };
  }
}

export const name = 'dsh-wpac-persona';

export function apply(ctx) {
  const logger = ctx.logger;
  const presets = ctx.get?.('agentPresets');
  const off = ctx.on?.('agent/created', (payload = {}) => {
    const agent = payload?.agent ?? payload;
    if (presetOf(presets, agent) !== PRESET_ID) return;
    if (attach(agent, logger).ok) logger?.info?.('[dsh-wpac] 人格段已挂进 system prompt');
  });
  ctx.effect(() => () => {
    if (typeof off === 'function') off();
  });
}
