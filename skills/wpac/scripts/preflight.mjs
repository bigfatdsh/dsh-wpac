#!/usr/bin/env node
// 输出前自检：字数 + 标题格式 + 事实闸（个人动作 / 展品 / 引语 / 自己的事 / 编造画面）。
// 只查机械可判的项，不判文风。
// 用法：node preflight.mjs [--min 800] [--max 1200] [--no-details] <file|->
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = { min: 0, max: Infinity, noDetails: false };
let file = '-';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--min') opt.min = Number(argv[++i]);
  else if (a === '--max') opt.max = Number(argv[++i]);
  else if (a === '--no-details') opt.noDetails = true;
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

// 字数
if (opt.min && han < opt.min) fails.push(`字数 ${han} < 下限 ${opt.min}`);
if (opt.max !== Infinity && han > opt.max) fails.push(`字数 ${han} > 上限 ${opt.max}`);

// 标题格式
if (/^#/m.test(text)) warns.push('标题带了 markdown #，交付前删');

// 事实闸：用户没给的细节一律算问题；加 --no-details 时直接判 FAIL
const push = (msg) => (opt.noDetails ? fails : warns).push(msg);

const actions = count(/我(站了|站了挺久|翻开|翻到|走到|看见|看到|摸了摸|回头|坐|坐不住|掏出|拿出|跟着|走进|出了展馆|回到宿舍|回到|路过|读了)/g);
if (actions > 0) push(`第一人称具体动作 ${actions} 处（用户没给就删）`);

const exhibit = count(/工作证|成绩单|作业本|红笔|展板|展柜|模型|奖章|奖状/g);
if (exhibit > 0) push(`具体展品 ${exhibit} 处（用户没给就改概括）`);

const quote = count(/他说[，,：:]/g);
if (quote > 0) push(`真人引语 ${quote} 处（必须核对原文，查不到就转述）`);

const selfFact = count(/我[^。！？\n]{0,12}(抄|挂科|拖到|没交|作弊|拖延)/g);
if (selfFact > 0) push(`自己的事 ${selfFact} 处（用户没说就删）`);

const imagined = count(/大红花|胸前.{0,4}花|证书|站在台上|台上笑|领奖台/g);
if (imagined > 0) push(`想象画面 ${imagined} 处（用户没给就删）`);

const personal = count(/实验|课设|社团|班干部|比赛|挂科|宿舍|食堂|早八|课表|作业/g);
if (personal > 0) push(`个人经历词 ${personal} 处（用户没给就删）`);

const cnNum = count(/[一二三四五六七八九十百千万零两〇]+(岁|年|个|项|届|位|多)/g);
if (cnNum > 5) push(`中文数字 ${cnNum} 处（确认来源）`);

const facts = count(/\d{4}\s*年|\d+\s*(岁|个|项|届|年)/g);
if (facts > 6) push(`具体数字 ${facts} 处（确认来源，≤4 更好）`);

// 规划 / 元叙事漏进正文：一定是 FAIL
const planMeta = count(/字数大概|需要加|可以加一段|不能编|禁止|写到这里|现在写下来/g);
if (planMeta > 0) fails.push(`规划 / 元叙事漏进正文 ${planMeta} 处`);

console.log('== 输出前自检 ==');
console.log(`汉字 ${han} / 字符 ${chars} / 段 ${paras.length}`);
for (const w of warns) console.log('[WARN] ' + w);
for (const f of fails) console.log('[FAIL] ' + f);
if (!warns.length && !fails.length) console.log('[PASS] 字数 / 标题 / 事实闸全过');
else console.log(`[结论] ${fails.length} 项 FAIL、${warns.length} 项 WARN；改完再跑。`);
process.exit(fails.length ? 1 : 0);
