#!/usr/bin/env node
// 把宿主自带 standard 预设的工具面，同步进本预设的 plugins 列表。
//
// 为什么要有它：工具面是手工从 standard 抄的，宿主加工具/改名字时 wpac 不会自动跟上。
// 这个脚本从当前装的 DSH 里找到 `dsh-web-app/presets/standard.patch.yml`（装机自带的那份），
// 抽出它的插件行，替换掉本包 `cordis.patch.yml` 里 preset-wpac 的 plugins 块，
// 只保留本包自己的第一行 `wpac-persona`。
//
// 用法：
//   node scripts/adapt-tools.mjs            # 只报告差异（退出码 1 表示有差异）
//   node scripts/adapt-tools.mjs --write    # 写入 cordis.patch.yml
//   node scripts/adapt-tools.mjs --source <path/to/standard.patch.yml>
//
// 找不到宿主时：设置 DSH_ASAR 指到 app.asar，或 DSH_WEB_APP_PRESET 直接指到 standard.patch.yml。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PATCH = path.join(root, 'cordis.patch.yml');
const WRITE = process.argv.includes('--write');
const sourceArg = (() => {
  const i = process.argv.indexOf('--source');
  return i !== -1 ? process.argv[i + 1] : undefined;
})();

/** 读 asar 里的一个文本文件（asar = 8 字节头 + JSON 目录 + 文件体）。 */
function readAsarFile(archive, wanted) {
  const fd = fs.openSync(archive, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    const size = head.readUInt32LE(4);
    const dir = Buffer.alloc(size);
    fs.readSync(fd, dir, 0, size, 8);
    const text = dir.toString('utf8');
    const tree = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const base = 8 + size;
    const parts = wanted.split('/');
    let node = tree;
    for (const part of parts) {
      if (!node?.files?.[part]) return undefined;
      node = node.files[part];
    }
    if (!node || node.files) return undefined;
    const out = Buffer.alloc(node.size);
    fs.readSync(fd, out, 0, node.size, base + Number(node.offset));
    return out.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** 可能装着 @deepseek-ai/dsh-web-app 的目录：当前 profile + 引擎根。
 *
 * 桌面版把包装在 profile 的 node_modules 里；iOS / Web 版把引擎放在 App 的
 * nodejs-project 下，profile 里只有注入的本地插件，所以要把引擎根也找出来。
 */
function pluginRoots() {
  const out = [];
  const add = (dir) => {
    if (!dir) return;
    const abs = path.resolve(dir);
    if (!out.includes(abs)) out.push(abs);
  };
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profiles = path.join(home, 'profiles');
  if (process.env.DSH_PROFILE_DIR) add(process.env.DSH_PROFILE_DIR);
  try {
    for (const name of fs.readdirSync(profiles)) add(path.join(profiles, name));
  } catch { /* 没有 profiles 目录 */ }
  add(process.env.DSH_ENGINE_ROOT);
  // iOS 客户端：引擎在 App 的 nodejs-project 里；桌面 App：resources 里。
  add('/opt/dsh/nodejs-project');
  add(path.join(os.homedir(), 'nodejs-project'));
  for (const entry of [process.argv[1], process.execPath]) {
    if (!entry) continue;
    let dir = path.dirname(entry);
    for (let i = 0; i < 8; i += 1) {
      if (fs.existsSync(path.join(dir, 'node_modules', '@deepseek-ai'))) { add(dir); break; }
      const next = path.dirname(dir);
      if (next === dir) break;
      dir = next;
    }
  }
  return out;
}

/** 找宿主里那份 standard.patch.yml。 */
function locateStandard() {
  if (sourceArg) return { text: fs.readFileSync(sourceArg, 'utf8'), from: sourceArg };
  if (process.env.DSH_WEB_APP_PRESET) {
    return { text: fs.readFileSync(process.env.DSH_WEB_APP_PRESET, 'utf8'), from: process.env.DSH_WEB_APP_PRESET };
  }
  // 先按当前机器上真实的安装位置找：profile 与引擎根（iOS / Web 走这条）。
  for (const dir of pluginRoots()) {
    const candidate = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml');
    if (fs.existsSync(candidate)) return { text: fs.readFileSync(candidate, 'utf8'), from: candidate };
  }
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const inProfile = path.join(home, 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml');
  if (fs.existsSync(inProfile)) return { text: fs.readFileSync(inProfile, 'utf8'), from: inProfile };

  const asars = [
    process.env.DSH_ASAR,
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar',
    path.join(os.homedir(), 'Applications', 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar'),
    'C:/Program Files/DeepSeek Harness/resources/app.asar',
    '/opt/DeepSeek Harness/resources/app.asar',
  ].filter(Boolean);
  for (const archive of asars) {
    if (!fs.existsSync(archive)) continue;
    const text = readAsarFile(archive, 'dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml');
    if (text) return { text, from: archive };
  }
  return undefined;
}

/** 从 standard 里抽出 plugins 块（统一成相对缩进 0 起）。 */
function extractStandardPlugins(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s+plugins:\s*$/.test(l));
  if (start === -1) throw new Error('standard.patch.yml 里找不到 plugins 块');
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') { body.push(''); continue; }
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    body.push(line);
  }
  const childIndent = Math.min(...body.filter((l) => l.trim() !== '').map((l) => l.match(/^\s*/)[0].length));
  const dedented = body.map((l) => (l.trim() === '' ? '' : l.slice(childIndent)));
  // 去掉 persona 行（本包用 wpac-persona 注入人格）
  const out = [];
  let skipping = false;
  for (const line of dedented) {
    if (/^- id: persona\s*$/.test(line)) { skipping = true; continue; }
    if (skipping && /^- id: /.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/**
 * 去掉 skill-filesystem 行的 customSkillDirs 配置。
 * host 的 standard.patch.yml 里这段是个 !!js 表达式（resolve @deepseek-ai/dsh-agent-preset），
 * 在预设上下文里跑不通，DSH rc.3 的设置页会显示「加载失败」。wpac 的技能是实体装在
 * ~/.dsh/skills/wpac 的，本来也不需要这段。
 */
function stripSkillFilesystemConfig(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hit = line.match(/^(\s*)- id: skill-filesystem\s*$/);
    if (!hit) { out.push(line); continue; }
    const base = hit[1].length;
    out.push(line);
    let dropping = false;      // 进入 config 块后一直丢，直到缩进回到 base
    for (i += 1; i < lines.length; i += 1) {
      const cur = lines[i];
      const indent = cur.match(/^\s*/)[0].length;
      if (cur.trim() === '') { out.push(cur); continue; }
      if (indent <= base) { i -= 1; break; }
      if (/^\s*config:\s*$/.test(cur)) { dropping = true; continue; }
      if (dropping) continue;
      out.push(cur);
    }
  }
  return out.join('\n');
}

/** 取本包 patch 里 preset-wpac 的 plugins 块（相对缩进）。 */
function extractOurs(text) {
  const lines = text.split('\n');
  const presetAt = lines.findIndex((l) => /^\s*- id: preset-wpac\s*$/.test(l));
  if (presetAt === -1) throw new Error('cordis.patch.yml 里找不到 preset-wpac');
  const start = lines.findIndex((l, i) => i > presetAt && /^\s+plugins:\s*$/.test(l));
  if (start === -1) throw new Error('preset-wpac 下找不到 plugins 块');
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') { body.push(''); continue; }
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    body.push(line);
  }
  const childIndent = Math.min(...body.filter((l) => l.trim() !== '').map((l) => l.match(/^\s*/)[0].length));
  return { body, childIndent, start, end: start + body.length + 1 };
}

const found = locateStandard();
if (!found) {
  console.error('找不到宿主自带的 standard.patch.yml；设置 DSH_ASAR 或 DSH_WEB_APP_PRESET 后重试。');
  process.exit(2);
}

const standardPlugins = extractStandardPlugins(found.text);
const ours = extractOurs(fs.readFileSync(PATCH, 'utf8'));

// 本包保留的第一行（注入插件），其余由 standard 覆盖
const keep = ['- id: wpac-persona', "  name: 'dsh-wpac/inject'", '- id: wpac-review-tools', "  name: 'dsh-wpac/tools'"];
const merged = [...keep, ...standardPlugins];

const indent = ' '.repeat(ours.childIndent);
const mergedText = merged.map((l) => (l.trim() === '' ? '' : indent + l)).join('\n');

const currentText = ours.body.join('\n');
const cleanedText = stripSkillFilesystemConfig(mergedText);
const same = currentText.trim() === cleanedText.trim();

console.log(`宿主来源：${found.from}`);
console.log(`standard 工具行：${standardPlugins.length} 行（已剔除 persona）`);
console.log(`本包当前：${ours.body.length} 行`);
if (same) {
  console.log('✓ 工具面与宿主 standard 一致');
  process.exit(0);
}

const oursIds = new Set(ours.body.map((l) => l.match(/^\s*- id: (\S+)/)?.[1]).filter(Boolean));
const stdIds = new Set(standardPlugins.map((l) => l.match(/^\s*- id: (\S+)/)?.[1]).filter(Boolean));
const added = [...stdIds].filter((id) => !oursIds.has(id));
const removed = [...oursIds].filter((id) => !['wpac-persona', 'wpac-review-tools'].includes(id) && !stdIds.has(id));
console.log(`宿主有、本包没有：${added.join(', ') || '（无）'}`);
console.log(`本包有、宿主没有：${removed.join(', ') || '（无）'}`);

if (!WRITE) {
  console.log('\n有差异；跑 `node scripts/adapt-tools.mjs --write` 写入，再重装预设。');
  process.exit(1);
}

const lines = fs.readFileSync(PATCH, 'utf8').split('\n');
const rebuilt = [...lines.slice(0, ours.start + 1), cleanedText, ...lines.slice(ours.end)];
fs.writeFileSync(PATCH, rebuilt.join('\n'));
console.log('\n✓ 已写入 cordis.patch.yml；重装预设后生效（unmanaged，需重启 App）。');
