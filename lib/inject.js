// dsh-wpac 人格注入（唯一实现）。
//
// 背景：宿主把人格段注册成 deployment:persona-prefix，预设里的 persona 行在 agent 挂载时被忽略
// （实测：WPAC 会话的 system prompt 里只有 54 字的部署人格）。所以改成宿主级插件，
// 在 agent/created 时给 agentPreset === 'wpac' 的会话挂一段 system prompt。
//
// 关键细节（都是探针实测出来的）：
//   * 事件参数是 { agent, source, signal }，不是 agent 本身；
//   * `agentPresets.composedPreset(agent.ctx)` 返回的是**预设 id 字符串**（例如 'wpac'），不是对象；
//   * 挂段用 `agent.ctx.systemPrompt.section({ text })`，与 dsh-fish/lib/identity.js 同形；
//   * 插件加载时顺带扫一遍已存在的 agent，让已开的会话也能立刻生效。

import fs from 'node:fs';

const PROTOCOL = fs.readFileSync(new URL('../persona.md', import.meta.url), 'utf8').trim();

/** 目标预设 id；改预设 id 时同步这里。 */
const PRESET_ID = 'wpac';

/**
 * 从 agent 上读会话预设 id。
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
    sp.section({ text: () => PROTOCOL });
    return { ok: true };
  } catch (error) {
    logger?.warn?.(`[dsh-wpac] 人格段没挂上：${error?.message ?? error}`);
    return { ok: false, why: String(error?.message ?? error) };
  }
}

/**
 * 扫一遍已存在的 agent（已开的 WPAC 会话也能立刻生效）。
 * @param {object} ctx
 * @param {object} presets
 * @param {object} logger
 */
function scanExisting(ctx, presets, logger) {
  try {
    const agents = ctx.get?.('agents');
    const store = agents?.store;
    if (!store || typeof store[Symbol.iterator] !== 'function') return;
    for (const [, value] of store) {
      const agent = value?.ctx ? value : value?.agent;
      if (agent && presetOf(presets, agent) === PRESET_ID) attach(agent, logger);
    }
  } catch (error) {
    logger?.warn?.(`[dsh-wpac] 已开会话补挂失败：${error?.message ?? error}`);
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

  const timer = setTimeout(() => scanExisting(ctx, presets, logger), 800);

  ctx.effect(() => () => {
    clearTimeout(timer);
    if (typeof off === 'function') off();
  });
}
