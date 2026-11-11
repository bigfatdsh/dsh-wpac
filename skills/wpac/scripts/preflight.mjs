#!/usr/bin/env node
// 输出前自检：字数 + 高频 AI 味句式 + 标题格式。
// 用法：node preflight.mjs [--min 800] [--max 1200] [--max-bushi 1] [--max-jiu 2] <file|->
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = { min: 0, max: Infinity, maxBushi: 1, maxJiu: 2 };
let file = '-';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--min') opt.min = Number(argv[++i]);
  else if (a === '--max') opt.max = Number(argv[++i]);
  else if (a === '--max-bushi') opt.maxBushi = Number(argv[++i]);
  else if (a === '--max-jiu') opt.maxJiu = Number(argv[++i]);
  else if (!a.startsWith('--')) file = a;
}

const text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
const chars = text.length;
let paras = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
if (paras.length <= 1) paras = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const count = (re) => (text.match(re) || []).length;
const fails = [];
const warns = [];

if (opt.min && han < opt.min) fails.push(`字数 ${han} < 下限 ${opt.min}`);
if (opt.max !== Infinity && han > opt.max) fails.push(`字数 ${han} > 上限 ${opt.max}`);

const bushi = count(/不是/g);
if (bushi > opt.maxBushi) fails.push(`「不是」${bushi} 处（上限 ${opt.maxBushi}）`);

const meta = count(/所谓|说穿了|这意味着|这说明/g);
if (meta > 0) fails.push(`自我注解 ${meta} 处（所谓 / 说穿了 / 这意味着）`);

const symbol = count(/见证了|承载着|彰显了|缩影/g);
if (symbol > 0) fails.push(`象征膨胀动词 ${symbol} 处`);

const signpost = count(/首先|其次|值得注意的是|总而言之|综上所述/g);
if (signpost > 0) warns.push(`显性路标 ${signpost} 处`);

const bang = count(/！/g);
if (bang > 1) warns.push(`感叹号 ${bang} 个（≤1）`);

const aph = count(/就是|其实是|不过是|才是|更像是|说白了/g);
if (aph > 3) warns.push(`判断 / 金句候选 ${aph} 处（>3，人工看）`);

const jiu = paras.map((p) => (p.match(/就/g) || []).length);
const jiuMax = Math.max(0, ...jiu);
if (jiuMax > opt.maxJiu) fails.push(`单段「就」${jiuMax} 个（上限 ${opt.maxJiu}）`);

if (/^#/m.test(text)) warns.push('标题带了 markdown #，交付前删');

console.log('== 输出前自检 ==');
console.log(`汉字 ${han} / 字符 ${chars} / 段 ${paras.length}`);
console.log(`「就」逐段：${jiu.join(' ')}（上限 ${opt.maxJiu}）`);
for (const w of warns) console.log('[WARN] ' + w);
for (const f of fails) console.log('[FAIL] ' + f);
if (!warns.length && !fails.length) console.log('[PASS] 机械项全过；金句 / 对仗 / 判断收尾还要人工过 §13');
else console.log(`[结论] ${fails.length} 项 FAIL、${warns.length} 项 WARN；改完再跑。`);
process.exit(fails.length ? 1 : 0);
