#!/usr/bin/env node
// dsh-wpac 自检脚本：装之前先跑一遍，确认补丁结构、人格段、技能文件都完整。
// 用法：node scripts/verify.mjs
// 退出码：0 通过，1 失败（打印每一条问题）。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const profileDir = process.env.DSH_PROFILE_DIR || path.join(process.env.DSH_HOME || '', 'profiles', 'desktop');
const failures = [];
const checks = [];
const ok = (msg) => checks.push(`  ✓ ${msg}`);
const bad = (msg) => {
  checks.push(`  ✗ ${msg}`);
  failures.push(msg);
};
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---- 1. package.json -------------------------------------------------------
let pkg;
try {
  pkg = JSON.parse(read('package.json'));
  ok(`package.json: ${pkg.name}@${pkg.version}`);
} catch (error) {
  bad(`package.json 无法解析：${error.message}`);
}
if (pkg) {
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') bad('package.json 缺少 dsh.bundle.patch 指向 ./cordis.patch.yml');
  else ok('dsh.bundle.patch 指向 cordis.patch.yml');
  if (pkg.author !== '姜涛') bad('package.json author 必须为「姜涛」');
  else ok('作者：姜涛');
}

// ---- 2. YAML 解析（允许 !!js 自定义标签）-----------------------------------
const require = createRequire(import.meta.url);
function adapt(mod) {
  // `yaml` 自带 customTags；`js-yaml` 用 Type 扩 schema。统一成 .parse(text)。
  if (typeof mod.parse === 'function') return mod;
  const schema = mod.DEFAULT_SCHEMA.extend([
    new mod.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (s) => ({ js: s }) }),
  ]);
  return { parse: (text) => mod.load(text, { schema }) };
}
function loadYaml() {
  const homes = [
    '',
    process.env.DSH_PROFILE_DIR || '',
    path.join(process.env.DSH_HOME || '', 'profiles', 'desktop'),
  ];
  const candidates = [];
  for (const home of homes) {
    for (const pkg of ['yaml', 'js-yaml']) {
      candidates.push(home ? path.join(home, 'node_modules', pkg) : pkg);
    }
  }
  for (const candidate of candidates) {
    try {
      return adapt(require(candidate));
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}
const YAML = loadYaml();
let patch = null;
if (!YAML) {
  bad('找不到 yaml 包：请在 profile 目录或设置 DSH_PROFILE_DIR 后重跑');
} else {
  try {
    patch = YAML.parse(read('cordis.patch.yml'), {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (s) => ({ js: s }) }],
      logLevel: 'silent',
    });
    ok('cordis.patch.yml 语法可解析');
  } catch (error) {
    bad(`cordis.patch.yml 解析失败：${error.message}`);
  }
}

// ---- 3. 预设声明 ----------------------------------------------------------
if (patch) {
  if (!Array.isArray(patch) || patch.length < 1 || patch.some((entry) => !Array.isArray(entry?.insert))) {
    bad('补丁层必须是只含 insert 的数组（不得覆盖宿主行）');
  } else {
    ok(`顶层结构：${patch.length} 条 insert，全部只做新增`);
    const allRows = patch.flatMap((entry) => entry.insert);
    const row = allRows.find((r) => r.id === 'preset-wpac');
    if (!row) bad('缺少 id: preset-wpac 的行');
    else {
      ok('行 id：preset-wpac');
      if (row.name !== '@deepseek-ai/dsh-agent-preset') bad('行 name 必须是 @deepseek-ai/dsh-agent-preset');
      const cfg = row.config || {};
      if (cfg.id !== 'wpac') bad('config.id 必须是 wpac');
      else ok('config.id：wpac');
      if (!Number.isFinite(cfg.order)) bad('config.order 必须是数字');
      else ok(`config.order：${cfg.order}`);
      if (!cfg.name) bad('缺少显示名 config.name');
      if (!cfg.description || !cfg.description.includes('姜涛')) bad('config.description 必须写清楚用途并标注作者姜涛');
      else ok('描述含作者');
      if (!Array.isArray(cfg.plugins) || cfg.plugins.length < 5) bad('config.plugins 为空或过少');
      else ok(`plugins：${cfg.plugins.length} 行`);
      const ids = (cfg.plugins || []).map((p) => p.id);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dup.length) bad(`插件 id 重复：${dup.join(', ')}`);
      else ok('插件 id 无重复');
      for (const required of ['tool-fs', 'tool-ask-user', 'tool-todo', 'tool-web', 'tool-skill', 'present']) {
        if (!ids.includes(required)) bad(`缺少必需插件行：${required}`);
      }
      if ((cfg.plugins || []).some((p) => p.id === 'persona')) {
        bad('预设里不要放 persona 行：宿主会忽略它，人格改由 wpac-persona 插件注入（persona.md）');
      } else {
        ok('预设不含 persona 行（人格走 wpac-persona 注入）');
      }
      const injector = (cfg.plugins || []).find((p) => p.id === 'wpac-persona');
      if (!injector) bad('预设里缺少注入插件行 wpac-persona');
      else if (injector.name !== 'dsh-wpac/inject') bad(`wpac-persona 行应指向 dsh-wpac/inject，实际是 ${injector.name}`);
      else ok('预设内注入行：wpac-persona → dsh-wpac/inject');
      const personaSrc = path.join(root, 'lib', 'persona.js');
      if (!fs.existsSync(personaSrc)) bad('缺少 lib/persona.js（人格注入实现）');
      else {
        const lib = read('lib/persona.js');
        if (!lib.includes("name: 'wpac:protocol'")) bad('section 调用缺少 name（宿主会拒绝）');
        if (!/text:\s*\(\)\s*=>/.test(lib) || !lib.includes('loadPersonaText')) bad('section 的 text 不是每轮现读 persona.md（改文案就必须重启）');
        if (!lib.includes('ctx.systemPrompt')) bad('注入插件没有直接用 ctx.systemPrompt（预设级注入）');
        if (!lib.includes("inject = ['systemPrompt']")) bad('注入插件缺少 inject 声明（Cordis 会拒绝读 systemPrompt）');
        if (!lib.includes('FALLBACK')) bad('注入插件没有兜底人格（persona.md 丢失会变无人格）');
        else ok('人格注入插件：预设内直接注册 system prompt 段');
      }
      // 入口文件是契约：预设行指向 dsh-wpac/inject，必须能拿到 apply。
      const entrySrc = read('lib/inject6.js');
      if (!/export\s*\{[^}]*apply[^}]*\}\s*from\s*'\.\/persona\.js'/.test(entrySrc)) {
        bad('lib/inject6.js 应只做转发（export { name, inject, apply } from \'./persona.js\'）');
      } else ok('入口 lib/inject6.js 只做转发，人格实现在 persona.js');
      if (!fs.existsSync(path.join(root, 'lib', 'review.js'))) bad('缺少 lib/review.js（结构确认实现）');
      else {
        const review = read('lib/review.js');
        for (const marker of ['createReviewBroker', 'createEndpointHandler', 'createTool', 'registerReview']) {
          if (!review.includes(marker)) bad(`lib/review.js 缺少 ${marker}`);
        }
        if (!review.includes('text: clampText')) bad('结构模块没有把正文 text 传给浏览器（右侧详情会空）');
        else if (!review.includes("required: ['id', 'title', 'text']")) bad('模块 schema 没把 text 设成必填（模型会省掉，右侧看不到正文）');
        else if (!review.includes('FORMATS') || !review.includes('inferFormat')) bad('review.js 缺少交付物格式（prose/slides/document/table）适配');
        else ok('结构确认实现：review.js 的 broker/端点/工具分层齐全');
        const clientSrc = read('lib/client.js');
        if (!clientSrc.includes('FALLBACK_META') || !clientSrc.includes('review.display')) bad('client.js 没有用宿主下发的 display（格式文案唯一真源在 formats.js）');
        if (!clientSrc.includes('color-mix')) bad('client.js 的底色没有跟主题走（应 color-mix 前景色做淡淡的分区）');
        if (!clientSrc.includes('gridTemplateRows')) bad('左栏没用 grid 固定行（上下会互相挤/遮挡）');
        if (!clientSrc.includes('lastConfirmedSignature')) bad('client.js 缺少同内容去重（模型多调一次会再弹一遍）');
        if (!clientSrc.includes('COPY.guide')) bad('弹窗缺少引导条');
        if (/关闭（不确认）|aria-label:\s*'关闭'/.test(clientSrc)) bad('弹窗还有 × 关闭键（应去掉，只留确认）');
        // var(--token, #fff) 里的兜底色不算硬编码；其余十六进制颜色必须来自令牌。
        const withoutFallbacks = clientSrc.replace(/var\(--dsw-alias-[a-z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--token)');
        if (/#[0-9a-fA-F]{6}\b|#fff\b/.test(withoutFallbacks)) bad('client.js 出现硬编码颜色（必须走 --dsw-alias-* 令牌）');
      }
      if (!read('lib/tools.js').includes("from './review.js'")) bad('lib/tools.js 应引入 ./review.js');
      if (!fs.existsSync(path.join(root, 'skills', 'wpac', 'references', '文件类-WPAC.md'))) {
        bad('缺少 references/文件类-WPAC.md（PDF/PPT/Word/表格的流程细则）');
      } else ok('文件类参考：references/文件类-WPAC.md');
      if (!fs.existsSync(path.join(root, 'persona.md'))) bad('缺少 persona.md');
      else {
        const prefix = read('persona.md');
        if (prefix.length < 800) bad('persona.md 太短，四要素与流程写不全');
        else ok(`persona.md：${prefix.length} 字`);
        for (const marker of ['W 我是', 'P 要什么', 'A 给谁', 'C 约束', '四轮', 'S1.5', '文件类', '只有正文', '自检 11 条', '语料路由', '加载 wpac 技能', 'AI 味红线', '中文AI味清单', 'preflight', '去金句', 'C1 形式', '继续补充', '人话测试', '反作文腔', '管线', '口语化', '废话', '姜涛']) {
          if (!prefix.includes(marker)) bad(`persona.md 缺少段落标记：${marker}`);
        }
      }
    }
  }
}

// ---- 3.4 服务隔离：预设里带服务的插件必须放在 isolate 组里 -----------------
// 否则注册时 registry 会报「Preset services require isolate realms: …」，界面显示「加载失败」。
if (patch) {
  const presetPlugins = (patch ?? []).flatMap((entry) => entry.insert ?? []).find((row) => row.id === 'preset-wpac')?.config?.plugins ?? [];
  let isolateOk = true;
  const walkGroups = (rows) => {
    for (const row of rows || []) {
      const children = Array.isArray(row.config) ? row.config : [];
      const names = children.map((child) => child?.name).filter(Boolean);
      const isolate = row.isolate ?? {};
      if (names.some((name) => name.endsWith('dsh-compaction-tool-result-pruner')) && isolate.toolResultPruner !== true) {
        bad(`组 ${row.id} 含 tool-result-pruner 却没 isolate.toolResultPruner：预设会显示「加载失败」`);
        isolateOk = false;
      }
      if (names.some((name) => name.endsWith('dsh-workflow-ptc')) && isolate.workflowEngine !== true) {
        bad(`组 ${row.id} 含 workflow-ptc 却没 isolate.workflowEngine：预设会显示「加载失败」`);
        isolateOk = false;
      }
      walkGroups(children);
    }
  };
  walkGroups(presetPlugins);
  if (isolateOk) ok('服务隔离完整（toolResultPruner / workflowEngine）');
}

// ---- 3.5 !!js 表达式：必须能编译，技能目录必须真能算出来 -------------------
function collectJs(node, out = []) {
  if (node && typeof node === 'object') {
    if (typeof node.js === 'string' && Object.keys(node).length === 1) out.push(node.js);
    for (const value of Object.values(node)) collectJs(value, out);
  }
  return out;
}
if (patch) {
  const exprs = collectJs(patch);
  if (exprs.length === 0) ok('补丁不含 !!js 表达式（纯静态声明，注册环节最少）');
  let compiled = 0;
  for (const expr of exprs) {
    try {
      new Function('baseUrl', 'process', `return (${expr})`);
      compiled += 1;
    } catch (error) {
      bad(`!!js 表达式语法错误：${expr.slice(0, 60)}… → ${error.message}`);
    }
  }
  if (exprs.length > 0 && compiled === exprs.length) ok(`!!js 表达式 ${compiled} 条均可编译`);
  const skillExpr = exprs.find((expr) => expr.includes('skills'));
  if (!skillExpr) checks.push('  - 跳过：没有技能目录表达式（技能走默认根目录）');
  else {
    try {
      const baseUrl = pathToFileURL(path.join(profileDir, 'package.json')).href;
      const value = new Function('baseUrl', 'process', `return (${skillExpr})`)(baseUrl, process);
      if (typeof value === 'string' && fs.existsSync(path.join(value, 'wpac', 'SKILL.md'))) ok(`!!js 求值：技能目录 ${value}`);
      else bad(`!!js 求值结果不是有效技能目录：${String(value)}`);
    } catch (error) {
      if (String(error?.message ?? '').includes('Cannot find module')) {
        const fallback = path.join(os.homedir(), '.dsh', 'skills');
        if (fs.existsSync(path.join(fallback, 'wpac', 'SKILL.md'))) ok(`!!js 技能目录本地按默认根校验：${fallback}`);
        else bad(`!!js 求值失败，且默认技能根没有 wpac：${error.message}`);
      } else {
        bad(`!!js 求值失败：${error.message}`);
      }
    }
  }
}

// ---- 4. 技能包 ------------------------------------------------------------
const skillFile = path.join(root, 'skills', 'wpac', 'SKILL.md');
if (!fs.existsSync(skillFile)) bad('缺少 skills/wpac/SKILL.md');
else {
  const skill = fs.readFileSync(skillFile, 'utf8');
  const front = skill.match(/^---\n([\s\S]*?)\n---/);
  if (!front) bad('SKILL.md 缺少 frontmatter');
  else {
    if (!/^name:\s*wpac\s*$/m.test(front[1])) bad('SKILL.md frontmatter 的 name 必须是 wpac');
    if (!/^description:\s*\S/m.test(front[1])) bad('SKILL.md frontmatter 缺少 description');
    ok(`技能：skills/wpac/SKILL.md（${skill.length} 字）`);
  }
}

// ---- 4.4 入口与导出目标必须真实存在（2.2.0 曾指向已删除的 inject5.js）----
try {
  const pkgNow = JSON.parse(read('package.json'));
  const targets = [pkgNow.main, ...Object.values(pkgNow.exports ?? {})]
    .filter((v) => typeof v === 'string' && v.startsWith('./'));
  const missing = targets.filter((rel) => !fs.existsSync(path.join(root, rel)));
  if (missing.length) bad(`package.json 指向的文件不存在：${missing.join(', ')}`);
  else ok(`入口与导出目标 ${targets.length} 个，文件都存在`);
  const entry = read('lib/index.js');
  if (/export\s+function\s+apply\s*\(/.test(entry) && !/export\s+\*\s+from/.test(entry)) {
    ok('lib/index.js 是空宿主半边（只当客户端的 Loader 锚点）');
  } else {
    bad('lib/index.js 必须保持空 apply：它会被 profile Loader 当独立插件加载，转发 inject6 会把 wpac 人格泄漏到所有会话');
  }
} catch (error) {
  bad(`检查入口失败：${error.message}`);
}

// ---- 4.5 文档与许可 -------------------------------------------------------
for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE', 'tests/behavior.md']) {
  if (!fs.existsSync(path.join(root, file))) bad(`缺少 ${file}`);
}
if (fs.existsSync(path.join(root, 'LICENSE')) && !read('LICENSE').includes('姜涛')) {
  bad('LICENSE 里没有作者署名');
}
if (fs.existsSync(path.join(root, 'templates', 'profile.md'))) ok('长期设定模板存在');
else bad('缺少 templates/profile.md');
const installedSkill = path.join(process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh'), 'skills', 'wpac', 'SKILL.md');
if (!fs.existsSync(installedSkill)) {
  bad(`技能还没装进默认根目录（跑 node scripts/install-skill.mjs）：${installedSkill}`);
} else {
  const src = fs.readFileSync(path.join(root, 'skills', 'wpac', 'SKILL.md'));
  const deployed = fs.readFileSync(installedSkill);
  if (!src.equals(deployed)) {
    bad(`已安装的技能与源码不一致（跑 node scripts/install-skill.mjs）：${installedSkill}`);
  } else {
    ok(`技能已装且与源码逐字节一致：${installedSkill}`);
  }
}

// ---- 5. 与现有预设不重名 ---------------------------------------------------
const profileCordis = path.join(profileDir, 'cordis.yml');
let profileDoc = null;
if (YAML && fs.existsSync(profileCordis)) {
  try {
    profileDoc = YAML.parse(fs.readFileSync(profileCordis, 'utf8'), {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (s) => ({ js: s }) }],
      logLevel: 'silent',
    });
    const clash = (profileDoc || []).filter(
      (e) => e?.id === 'preset-wpac' || e?.config?.id === 'wpac',
    );
    if (clash.length) bad('profile 的 cordis.yml 里已存在 preset-wpac 行：本包应只通过 bundle 层声明，避免重复');
    else ok('与现有预设无 id 冲突');
  } catch (error) {
    bad(`读取 profile cordis.yml 失败：${error.message}`);
  }
} else {
  checks.push('  - 跳过：找不到 profile 的 cordis.yml');
}

// ---- 6. 插件名都在既有预设里出现过（防止笔误）------------------------------
if (profileDoc) {
  const known = new Set();
  const scan = (rows) => {
    for (const row of rows || []) {
      if (row?.name) known.add(row.name);
      if (Array.isArray(row?.config)) scan(row.config);
    }
  };
  for (const entry of profileDoc) {
    scan(entry?.config?.plugins);
    if (Array.isArray(entry?.config)) scan(entry.config);
  }
  const unknown = [];
  const collect = (rows) => {
    for (const row of rows || []) {
      if (row?.name && !known.has(row.name)) unknown.push(row.name);
      if (Array.isArray(row?.config)) collect(row.config);
    }
  };
  collect((patch ?? []).flatMap((entry) => entry.insert ?? []).find((r) => r.id === 'preset-wpac')?.config?.plugins);
  if (known.size === 0) checks.push('  - 跳过：profile 里没有内联预设行（预设来自 bundle 层，无法比对）');
  else if (unknown.length) bad(`这些插件名在既有预设里没出现过，可能有笔误：${unknown.join(', ')}`);
  else ok('插件名与既有预设计一致（无新增依赖）');
}

// ---- 7. 技能目录表达式在本机可解析 ----------------------------------------
try {
  const req = createRequire(path.join(profileDir, 'package.json'));
  const pkgPath = req.resolve('dsh-wpac/package.json');
  const skillDir = path.join(path.dirname(pkgPath), 'skills');
  if (!fs.existsSync(path.join(skillDir, 'wpac', 'SKILL.md'))) bad(`技能目录解析后不存在 SKILL.md：${skillDir}`);
  else ok(`技能目录可解析：${skillDir}`);
} catch (error) {
  bad(`customSkillDirs 表达式解析失败（dsh-wpac 尚未装进 profile？）：${error.message}`);
}

// ---- 7. 工具面与当前 standard 同步（升级 DSH 后最容易悄悄过期的地方）------
try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'adapt-tools.mjs')], {
    stdio: 'pipe',
    env: { ...process.env, DSH_PROFILE_DIR: profileDir },
  });
  ok('预设工具面与当前 DSH 的 standard 一致');
} catch (error) {
  if (error?.status === 1) {
    bad('预设工具面落后于当前 DSH 的 standard（会导致设置里「加载失败」）：跑 node scripts/adapt-tools.mjs --write');
  } else {
    checks.push('  - 跳过：读不到当前 DSH 的 standard（未安装 App 或路径不同）');
  }
}

// ---- 输出 -----------------------------------------------------------------
// ---- 8. 浏览器半边（结构确认弹窗）要真的会进页面 ---------------------------
try {
  const pkgNow = JSON.parse(read('package.json'));
  const client = pkgNow.dsh?.client;
  if (!client || client.platform !== 'web') bad('package.json 缺 dsh.client.platform=web：客户端半边不会被加载');
  else ok('dsh.client.platform = web');

  const exportRel = pkgNow.exports?.['./client'];
  if (!exportRel) bad('package.json 缺 exports["./client"]');
  else if (!fs.existsSync(path.join(root, exportRel))) bad(`exports["./client"] 指向的文件不存在：${exportRel}`);
  else ok(`客户端入口：${exportRel}`);

  const clientCode = read(exportRel || 'lib/client.js');
  const idm = clientCode.match(/__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/);
  if (!idm) bad('客户端入口不是 __ModuleLoader__.load({ id, factory }) 形式');
  else if (idm[1] !== pkgNow.name) bad(`客户端模块 id（${idm[1]}）必须等于包名 ${pkgNow.name}`);
  else ok(`客户端模块 id = ${pkgNow.name}`);
  if (!/shell\.overlay/.test(clientCode)) bad('弹窗没挂到 shell.overlay（挂 conversation.input.right 弹不出来）');
  else ok('弹窗挂在 shell.overlay');

  // 关键：Loader 里必须有以包名命名的一行，客户端模块系统才扫得到这个包。
  const names = [];
  const walk = (node) => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string') names.push(node.name);
    for (const value of Object.values(node)) walk(value);
  };
  walk(patch);
  const anchors = names.filter((name) => name === pkgNow.name);
  if (!anchors.length) bad(`cordis.patch.yml 里没有 name: '${pkgNow.name}' 的 Loader 行：客户端半边永不加载（0.3.6 前弹窗出不来的根因）`);
  else if (anchors.length > 1) bad(`name: '${pkgNow.name}' 的 Loader 行重复 ${anchors.length} 次，删掉多余的`);
  else ok(`Loader 锚点行：name: '${pkgNow.name}'`);
} catch (error) {
  bad(`检查浏览器半边失败：${error.message}`);
}

console.log(`dsh-wpac 自检（${root}）`);
console.log(checks.join('\n'));
if (failures.length) {
  console.error(`\n失败 ${failures.length} 项`);
  process.exit(1);
}
console.log('\n全部通过');
