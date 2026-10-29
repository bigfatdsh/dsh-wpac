#!/usr/bin/env node
// dsh-wpac 冒烟：一条命令把「仓库 ↔ 机器」的一致性跑完，并打印 5 条人工委托。
//
// 用法：node scripts/smoke.mjs
// 退出码：0 通过，1 有不一致。
//
// 能自动断言的部分：部署一致性（技能副本、人格热读）、规则存在性、预设声明完整性。
// 不能自动断言的部分（宿主不提供建会话的接口）：模型真的按规则行为——所以最后会把
// 5 条固定委托打出来，人工跑一遍，对照每条的「期望」。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh');
const failures = [];

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.log(`  ✗ ${msg}`);
  failures.push(msg);
};

console.log('dsh-wpac 冒烟');

// 1. 技能副本与源码逐字节一致（上一轮就是这里漏了：装的是旧手册）
const srcSkill = path.join(root, 'skills', 'wpac', 'SKILL.md');
const dstSkill = path.join(home, 'skills', 'wpac', 'SKILL.md');
if (!fs.existsSync(dstSkill)) bad('技能没装到 ~/.dsh/skills/wpac（node scripts/install-skill.mjs）');
else {
  const a = fs.readFileSync(srcSkill);
  const b = fs.readFileSync(dstSkill);
  if (!a.equals(b)) bad(`技能副本过期：源 ${sha(a)} / 机器 ${sha(b)}（重跑 install-skill）`);
  else ok(`技能副本一致（${sha(a)}）`);
}

// 2. 人格五条关键规则必须在场（改人格时最容易删掉其中一条）
const persona = read('persona.md');
const rules = [
  ['四轮追问', '四轮'],
  ['不走四轮的开口', '不走四轮'],
  ['纯正文', '只有正文'],
  ['去 AI 味', '去 AI 味'],
  ['自检', '自检'],
];
for (const [label, marker] of rules) {
  if (!persona.includes(marker)) bad(`人格缺少「${label}」（找不到 ${marker}）`);
  else ok(`人格含「${label}」`);
}

// 3. 追问口径三处一致：人格 / 手册 / README
const skill = read('skills/wpac/SKILL.md');
const readme = read('README.md');
const confirmRule = '1 题确认';
if (!persona.includes('只问 1 题确认')) bad('人格没写「四要素齐全只问 1 题确认」');
else if (!skill.includes(confirmRule)) bad('手册没写「1 题确认」——和人格冲突');
else if (!readme.includes(confirmRule)) bad('README 验收没写「1 题确认」——和人格冲突');
else ok('追问口径三处一致（人格 / 手册 / README）');

// 4. 预设声明：一条 insert、注入行在预设内、order 0
const patch = read('cordis.patch.yml');
if (!patch.includes("- id: wpac-persona")) bad('预设里没有 wpac-persona 注入行');
else if (!patch.includes("name: 'dsh-wpac/inject'")) bad('注入行没指向 dsh-wpac/inject');
else if (!/order:\s*0/.test(patch)) bad('预设 order 不是 0（新建会话不会排第一）');
else ok('预设声明完整（注入行 + order 0）');

// 5. 交付口径一致：不再出现「三行说明」
for (const [name, text] of [['手册', skill], ['README', readme], ['人格', persona]]) {
  if (/三行|3 行说明/.test(text)) bad(`${name} 里还留着「三行说明」，与「最多一行」冲突`);
}
ok('交付口径无「三行」残留');

// 6. 人工委托（自动断言做不到的部分）
console.log('\n人工跑这 5 条，对照期望：');
const cases = [
  ['帮我写一篇关于大学生活的文章', '应只问 W（谁的身份），不写正文'],
  ['我是大一新生，写 300 字自我介绍交给班主任', '四要素齐全：应只回 1 题确认，不逐槽追问'],
  ['别问了，直接写 200 字产品介绍，智能水杯', '0 问，直接出纯正文'],
  ['改一下上面那篇，把结尾写得更口语', '改稿：应至少问 1 题（改哪里/保留什么）'],
  ['Python 的 GIL 是什么，两句话', '闲聊/知识题：不套四轮，直接答'],
];
for (const [prompt, expect] of cases) console.log(`  · ${prompt}\n    期望：${expect}`);

if (failures.length) {
  console.error(`\n冒烟失败：${failures.length} 项`);
  process.exit(1);
}
console.log('\n自动断言全部通过（行为部分需人工跑上面 5 条）');
