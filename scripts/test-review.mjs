#!/usr/bin/env node
// 结构确认「两半边」的离线回归：
//   1. 浏览器半边 —— client.js 是不是 __ModuleLoader__ 形式、模块 id 对不对、
//      有没有挂到 shell.overlay、apply 之后有没有开始轮询。
//   2. 宿主半边 —— registerReview 起端点 + 工具；execute 挂起 → GET 取到结构 →
//      POST confirm 带 feedback → 工具带着 feedback resolve；cancel 同理。
// 不连真实网页、不起服务器，只跑插件自己的契约。用法：node scripts/test-review.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url';

// 测试不要污染生产诊断日志
process.env.WPAC_REVIEW_LOG = path.join(os.tmpdir(), `wpac-test-${process.pid}.log`)

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures += 1; console.log(`  ✗ ${msg}`); };
const eq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(`${label} = ${JSON.stringify(actual)}`);
  else bad(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. 浏览器半边 ---------------------------------------------------
console.log('浏览器半边（lib/client.js）');
{
  let decl = null;
  globalThis.window = {
    __ModuleLoader__: { load: (value) => { decl = value; } },
    addEventListener() {},
    removeEventListener() {},
  };
  const fetched = [];
  globalThis.fetch = async (url, init) => {
    fetched.push({ url: String(url), method: (init && init.method) || 'GET' });
    return { ok: true, status: 200, json: async () => ({ ok: true, review: null }) };
  };

  await import(pathToFileURL(path.join(root, 'lib/client.js')).href);
  if (!decl) { bad('没有调用 window.__ModuleLoader__.load'); }
  else {
    ok('以 __ModuleLoader__.load({ id, factory }) 注册');
    eq(decl.id, 'dsh-wpac', '客户端模块 id');

    const fakeReact = {
      createElement: () => null,
      Fragment: 'Fragment',
      useState: () => [0, () => {}],
      useEffect: () => {},
    };
    const plugin = decl.factory((name) => {
      if (name === 'react') return fakeReact;
      throw new Error('客户端半边只能 require(react)，多了：' + name);
    });
    eq(Array.isArray(plugin.inject) ? plugin.inject : plugin.inject, ['slots'], '插件 inject');

    const slots = [];
    let disposed = null;
    const ctx = {
      slots: {
        inject: (name, callback) => { disposed = () => {}; callback(); },
        register: (options, Component) => {
          slots.push({ options, Component });
          return () => {};
        },
      },
    };
    plugin.apply(ctx);
    eq(slots.map((entry) => entry.options.name), ['shell.overlay'], '注册的 slot');
    eq(slots[0] && slots[0].options.id, 'wpac-review-host', 'slot 条目 id');
    if (typeof slots[0]?.Component !== 'function') bad('slot 注册的不是组件');
    else ok('slot 注册的是 React 组件');

    await sleep(40);
    if (fetched.some((f) => f.url === '/dsh-wpac-review')) {
      ok('apply 之后开始轮询 /dsh-wpac-review');
    } else {
      bad('apply 之后没有轮询端点');
    }
    if (typeof disposed === 'function') ok('slots.inject 用了注入式注册');
  }
}

// ---------- 2. 宿主半边 -----------------------------------------------------
console.log('宿主半边（lib/review.js: 端点 + 工具）');
{
  const { registerReview, clampText, cleanFeedback, normalizeReview, inferFormat, createReviewBroker } = await import(pathToFileURL(path.join(root, 'lib/review.js')).href);
  let endpoint = null;
  let tool = null;
  const warns = [];
  const ctx = {
    get: (name) => {
      if (name === 'webServer') return { register: (route) => { endpoint = route; } };
      if (name === 'tools') return { register: (definition) => { tool = definition; } };
      return undefined;
    },
    logger: { warn: (msg) => warns.push(String(msg)) },
  };
  registerReview(ctx);
  if (!endpoint) bad('没有注册 /dsh-wpac-review 端点');
  else { ok('端点已注册：' + endpoint.path); eq(endpoint.kind, 'exact', '端点 kind'); }
  if (!tool) bad('没有注册 wpac_structure_review 工具');
  else eq(tool.name, 'wpac_structure_review', '工具名');

  // 假 req/res：让端点处理器能读写一跳 JSON
  const callEndpoint = async (method, body) => {
    const req = { method, [Symbol.asyncIterator]: async function* () { if (body) yield Buffer.from(JSON.stringify(body)); } };
    let payload = '';
    const res = {
      statusCode: 0,
      setHeader() {},
      end: (chunk) => { payload = String(chunk || ''); },
    };
    await endpoint.handler(req, res);
    return { status: res.statusCode, body: payload ? JSON.parse(payload) : null };
  };

  const args = {
    title: '测试稿', kind: '观后感', round: 1,
    modules: [
      { id: 'm1', title: '到场', role: '开场', summary: '进门先看到铁家伙', text: '进门之前我以为会看到一屋子奖状。' },
      { id: 'm2', title: '抓手', role: '主体', summary: '抓斗怎么改的', text: '那些铁家伙是抓斗，一个爪子张开合上。' },
    ],
  };

  // text 必填：缺正文时不开 pending，直接给模型一个可读的打回原因
  const rejected = await tool.execute({ title: 'x', modules: [{ id: 'a', title: '没有正文' }] });
  eq(rejected.ok, false, '缺 text 时 ok');
  eq(rejected.reason, 'missing-text', '缺 text 时的 reason');
  const noModules = await tool.execute({ modules: [] });
  eq(noModules.reason, 'no-modules', '空模块时的 reason');

  // 第一轮：confirm 且带一条意见
  const running = tool.execute(args);
  await sleep(20);
  const got = await callEndpoint('GET');
  eq(got.status, 200, 'GET 状态');
  eq(got.body.review && got.body.review.modules.length, 2, 'GET 取到模块数');
  eq(got.body.review && got.body.review.modules[0].text, '进门之前我以为会看到一屋子奖状。', 'GET 取到模块正文（右侧详情用）');
  eq(got.body.review && got.body.review.format, 'prose', 'GET 取到交付物结构类型');
  eq(inferFormat('PPT 汇报'), 'slides', 'kind 猜格式：PPT');
  eq(inferFormat('Word 报告'), 'document', 'kind 猜格式：Word');
  eq(inferFormat('Excel 台账'), 'table', 'kind 猜格式：Excel');
  eq(normalizeReview({ format: 'slides', modules: [] }, '1').format, 'slides', '显式 format 生效');
  const itemSchema = tool.parameters.properties.modules.items;
  eq(itemSchema.required, ['id', 'title', 'text'], '模块 schema 必填 text');
  eq(got.body.review && got.body.review.round, 1, 'GET 取到轮次');
  const post = await callEndpoint('POST', {
    id: got.body.review.id, action: 'confirm',
    feedback: [{ moduleId: 'm2', moduleTitle: '抓手', instruction: '这一段写具体点' }, { instruction: '' }],
  });
  eq(post.status, 200, 'POST 状态');
  const result = await running;
  eq(result.ok, true, '工具返回值 ok');
  eq(result.action, 'confirm', '工具返回值 action');
  eq(result.feedback.length, 1, '空意见被丢掉后的意见条数');
  eq(result.feedback[0].moduleId, 'm2', '意见 moduleId');
  eq(result.feedback[0].instruction, '这一段写具体点', '意见正文');

  // 第二轮：cancel
  const running2 = tool.execute(Object.assign({}, args, { round: 2 }));
  await sleep(20);
  const got2 = await callEndpoint('GET');
  eq(got2.body.review.round, 2, '第二轮轮次');
  await callEndpoint('POST', { id: got2.body.review.id, action: 'cancel' });
  const result2 = await running2;
  eq(result2.action, 'cancel', '取消时 action');
  eq(result2.feedback, [], '取消时没有反馈');

  // 参数限长：超长字段会被 clamp，模块数最多 12
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 'x' + i, title: 'T'.repeat(200), summary: 'S'.repeat(900), text: 'B'.repeat(9999) }));
  const running3 = tool.execute({ title: 'T'.repeat(500), kind: 'K'.repeat(60), modules: many });
  await sleep(20);
  const got3 = await callEndpoint('GET');
  eq(got3.body.review.modules.length, 12, '模块数上限');
  eq(got3.body.review.modules[0].title.length, 80, '标题限长');
  eq(got3.body.review.modules[0].summary.length, 400, '摘要限长');
  eq(got3.body.review.modules[0].text.length, 4000, '正文限长（弹窗里的块）');
  eq(got3.body.review.title.length, 120, '总标题限长');
  eq(got3.body.review.kind.length, 24, '任务类型限长');
  eq(normalizeReview({ modules: [{ id: 'a', title: 't', text: 'x'.repeat(9999) }] }, '1').modules[0].text.length, 4000, '正文限长');
  eq(clampText('abc', 2), 'ab', 'clampText 截断');
  eq(cleanFeedback([{ instruction: '' }]).length, 0, 'cleanFeedback 丢空意见');
  await callEndpoint('POST', { id: got3.body.review.id, action: 'cancel' });
  await running3;
}

// ---- 3. broker 的失败路径（没有人取 / 中途 settle 不存在的 id） --------------
console.log('broker 失败路径');
{
  const { createReviewBroker } = await import(pathToFileURL(path.join(root, 'lib/review.js')).href);
  const logs = [];
  const broker = createReviewBroker({ log: (m) => logs.push(m), timeouts: { noClient: 100, overall: 5000 } });
  const started = Date.now();
  const pending = broker.create({ title: 't', modules: [{ id: 'm1', title: 't', text: '正文' }] });
  // tick 是 1s 一次，所以这里要等 ~1.1s
  const failed = await pending;
  eq(failed.reason, 'no-client', '无人轮询时的 reason');
  if (Date.now() - started < 900) bad('no-client 判定太快（定时器没跑到）');
  else ok('no-client 在 ~1s 后判定（未阻塞会话）');
  const empty = createReviewBroker({ log: () => {} });
  eq(empty.settle('nope', { action: 'confirm' }), false, 'settle 不存在的 id');
  eq(empty.take(), null, '没有 pending 时 take 返回 null');

  // 单槽：新的一条进来，旧的作废（不然用户确认完又会弹出旧的）
  const single = createReviewBroker({ log: () => {} });
  const first = single.create({ title: '第一条', modules: [{ id: 'a', title: 'a', text: '正文' }] });
  const second = single.create({ title: '第二条', modules: [{ id: 'b', title: 'b', text: '正文' }] });
  const firstResult = await first;
  eq(firstResult.reason, 'superseded', '旧一条被新一条顶掉');
  eq(single.take().title, '第二条', 'take 只给最新一条');
  eq(single.settle('1', { action: 'confirm' }), false, 'settle 过期 id 不生效');
  eq(single.size(), 1, 'pending 只有一个槽');
  await single.settle(single.take().id, { action: 'cancel' });
  eq((await second).action, 'cancel', '当前一条能正常结算');
  logs.length = 0;
}

console.log(failures ? `\n失败 ${failures} 项` : '\n两半边契约全部通过');
process.exit(failures ? 1 : 0);
