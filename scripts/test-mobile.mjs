#!/usr/bin/env node
// 手机端弹窗渲染回归：用一个极小的假 React 把 lib/client.js 真渲染一遍，
// 断言「窄屏铺满 + 竖排 + 预览图按视口算高度」和「桌面版没被改坏」。
//
// iOS 上没有浏览器可以开，所以这里不测像素，只测渲染出来的样式对象：
// 结构弹窗在手机上最常坏的两处是「左栏 380px 把详情挤成 0 宽」和
// 「面板按 780px 固定高，键盘一弹确认键就跑出屏」，这两条都能在这一层断言。
//
// 用法：node scripts/test-mobile.mjs [--file lib/client.js]

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argIndex = process.argv.indexOf('--file');
const FILE = argIndex !== -1 && process.argv[argIndex + 1]
  ? path.resolve(process.argv[argIndex + 1])
  : path.join(root, 'lib', 'client.js');
const code = fs.readFileSync(FILE, 'utf8');

/** 假 React：只实现组件树渲染需要的 createElement / 函数组件 / Provider / 三个 hook。 */
function makeReact() {
  const stateByPath = new Map();
  const currentRef = { value: null };
  const React = {
    Fragment: { __fragment: true },
    createElement(type, props, ...children) {
      const base = { ...(props || {}) };
      if (children.length) base.children = children;
      return { type, props: base };
    },
    createContext(defaultValue) {
      const ctx = { __ctx: true, defaultValue };
      ctx.Provider = { __provider: ctx };
      return ctx;
    },
    useContext(ctx) {
      return currentRef.value && currentRef.value.ctx.has(ctx) ? currentRef.value.ctx.get(ctx) : ctx.defaultValue;
    },
    useState(init) {
      const h = currentRef.value.hooks;
      const i = h.index++;
      if (!(i in h.values)) h.values[i] = typeof init === 'function' ? init() : init;
      return [h.values[i], (v) => { h.values[i] = typeof v === 'function' ? v(h.values[i]) : v; }];
    },
    useEffect() {},
    useMemo(fn) { return fn(); },
    useSyncExternalStore(_sub, get) { return get(); },
  };
  return { React, stateByPath, currentRef };
}

/** 渲染一次组件树，返回所有宿主元素（带 style 的那种）。 */
function renderTree(host) {
  const { React, stateByPath, currentRef } = host;
  const collected = [];

  function walk(el, keyPath, ctxStack) {
    if (el === null || el === undefined || el === false || el === true) return;
    if (Array.isArray(el)) { el.forEach((c, i) => walk(c, keyPath + '.' + i, ctxStack)); return; }
    if (typeof el === 'string' || typeof el === 'number') return;
    if (!el.type) return;
    const type = el.type;
    if (type.__fragment) return walk(el.props.children, keyPath, ctxStack);
    if (type.__provider) {
      const next = new Map(ctxStack);
      next.set(type.__provider, el.props.value);
      return walk(el.props.children, keyPath, next);
    }
    if (typeof type === 'function') {
      const key = keyPath + ':' + (type.name || 'anon');
      if (!stateByPath.has(key)) stateByPath.set(key, { values: [], index: 0 });
      const hooks = stateByPath.get(key);
      hooks.index = 0;
      const prev = currentRef.value;
      currentRef.value = { hooks, ctx: ctxStack };
      let rendered;
      try {
        rendered = type(el.props);
      } finally {
        currentRef.value = prev;
      }
      return walk(rendered, key + '/', ctxStack);
    }
    collected.push({ tag: type, style: el.props && el.props.style, props: el.props || {} });
    walk(el.props && el.props.children, keyPath + '>', ctxStack);
  }

  currentRef.value = { hooks: { values: [], index: 0 }, ctx: new Map() };
  walk(React.createElement(host.Host, {}), 'host', new Map());
  return collected;
}

/** 把 client.js 塞进一个假 window，跑完 apply()，拿回 shell.overlay 里的组件。 */
function boot({ narrow, width, height }) {
  const host = makeReact();
  const { React } = host;
  let plugin = null;
  const slots = [];
  const win = {
    innerWidth: width,
    innerHeight: height,
    matchMedia: () => ({ matches: narrow, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    visualViewport: { height, addEventListener() {}, removeEventListener() {} },
    addEventListener() {},
    removeEventListener() {},
    __ModuleLoader__: {
      load(spec) {
        plugin = spec.factory((name) => {
          if (name === 'react') return React;
          throw new Error('客户端只允许 require("react")，实际：' + name);
        });
      },
    },
  };
  win.window = win;

  const sandbox = {
    window: win,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask,
    document: { addEventListener() {}, removeEventListener() {}, body: {} },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        review: {
          id: 'r1', title: '交付前的结构确认', format: 'prose', round: 1,
          modules: [
            { id: 'm1', title: '开头', role: '钩子', hasPreview: true, summary: '一句话钩住读者', text: '第一段正文。' },
            { id: 'm2', title: '论证', role: '主体', summary: '三段递进', text: '第二段正文。' },
          ],
        },
      }),
    }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: path.basename(FILE) });

  if (!plugin) throw new Error('模块没有注册到 window.__ModuleLoader__');
  plugin.apply({
    slots: {
      inject(name, fn) { slots.push({ name, fn }); },
      register(_spec, component) { return component; },
    },
  });
  const injected = slots.find((s) => s.name === 'shell.overlay');
  if (!injected) throw new Error('shell.overlay 没注册');
  host.Host = injected.fn();
  return host;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function screen(label, opts) {
  const host = boot(opts);
  await sleep(30); // 等 startPolling 的第一跳（假 fetch 立刻返回）把弹窗打开

  let nodes = renderTree(host);
  // 点第一个模块：详情 + 预览图只有选中模块后才渲染。
  const row = nodes.find((n) => n.props && typeof n.props.onClick === 'function' && typeof n.props.title === 'string');
  if (row) {
    row.props.onClick();
    nodes = renderTree(host);
  }
  const styles = nodes.map((n) => n.style).filter(Boolean);

  const panel = styles.find((s) => s.display === 'flex' && s.flexDirection === 'column' && s.overflow === 'hidden');
  const body = styles.find((s) => s.flex === '1 1 auto' && s.display === 'flex');
  const textarea = styles.find((s) => s.resize === 'none');
  const preview = styles.find((s) => s.objectFit === 'contain');

  console.log(`\n== ${label} ${opts.width}×${opts.height}（narrow=${opts.narrow}）`);
  console.log(`  面板：${panel ? panel.width + ' × ' + panel.height + '，圆角 ' + panel.borderRadius : '缺失'}`);
  console.log(`  正文区：flexDirection=${body ? body.flexDirection : '横排'}，预览上限=${preview ? preview.maxHeight : '缺失'}`);

  if (!panel) throw new Error('没渲染出弹窗面板');
  if (!textarea) throw new Error('没渲染出意见输入框');
  if (!preview) throw new Error('没渲染出预览图（hasPreview 模块应显示 <img>）');
  if (preview.objectFit !== 'contain') throw new Error('预览图 objectFit 不是 contain，会被裁切');
  if (preview.maxWidth !== '100%') throw new Error('预览图没有限制宽度');

  if (!opts.narrow) {
    if (panel.width !== 'min(1140px, 100%)') throw new Error('桌面版面板宽度被改坏：' + panel.width);
    if (preview.maxHeight !== 'min(52vh, 520px)') throw new Error('桌面版预览高度被改坏：' + preview.maxHeight);
    return;
  }

  if (panel.width !== '100%' || panel.height !== '100%') throw new Error(`窄屏面板没铺满：${panel.width} × ${panel.height}`);
  if (panel.borderRadius !== 0) throw new Error('窄屏面板还留着圆角，四周会漏底');
  if (panel.paddingTop !== 'env(safe-area-inset-top, 0px)') throw new Error('窄屏没给刘海留安全区');
  if (!body || body.flexDirection !== 'column') throw new Error('窄屏没有改成上下两段，详情会被挤成 0 宽');
  if (textarea.fontSize !== 16) throw new Error('窄屏输入框字号不是 16px，iOS 聚焦会放大整页');
  if (typeof preview.maxHeight !== 'number' || preview.maxHeight <= 0) throw new Error('窄屏预览高度没有按视口算：' + preview.maxHeight);
}

await screen('手机', { narrow: true, width: 390, height: 844 });
await screen('小屏手机', { narrow: true, width: 320, height: 568 });
await screen('横屏手机', { narrow: true, width: 640, height: 360 });
await screen('桌面', { narrow: false, width: 1440, height: 900 });
console.log('\n✓ 手机端 / 桌面端弹窗渲染断言全部通过');
process.exit(0);
