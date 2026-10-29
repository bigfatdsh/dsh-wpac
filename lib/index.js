// dsh-wpac 人格注入：预设里的 persona 行在 agent 挂载时不会替换部署级人格段
// （宿主把 persona 注册成 deployment:persona-prefix，预设同名段被忽略），
// 所以改成在 agent/created 时，只给 agentPreset === 'wpac' 的会话挂一段 system prompt。
//
// 参考同一个宿主上验证过的做法：dsh-fish 的 lib/identity.js
//（agent.ctx.systemPrompt.section({ text })，事件参数是 { agent, source, signal }）。

import fs from 'node:fs';

const PROTOCOL = fs.readFileSync(new URL('../persona.md', import.meta.url), 'utf8').trim();

/** 目标预设 id；改预设 id 时同步这里。 */
const PRESET_ID = 'wpac';

/**
 * 读 agent 所属的预设 id。
 * 首选宿主自己的 `agentPresets.composedPreset(ctx)`（registry 内部也用它）；
 * 拿不到时退回会话头里的 agentPreset。
 * @param {object} presets
 * @param {object} agent
 * @returns {string}
 */
function presetOf(presets, agent) {
  try {
    const composed = presets?.composedPreset?.(agent?.ctx);
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
    // 与 dsh-fish/lib/identity.js 完全同形：只传 text，避免多余字段被 schema 拒绝。
    sp.section({ text: () => PROTOCOL });
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
  const off = ctx.on?.('agent/created', ({ agent } = {}) => {
    if (presetOf(presets, agent) !== PRESET_ID) return;
    const result = attach(agent, logger);
    if (result.ok) logger?.info?.('[dsh-wpac] 人格段已挂进 system prompt');
  });
  ctx.effect(() => () => {
    if (typeof off === 'function') off();
  });
}
