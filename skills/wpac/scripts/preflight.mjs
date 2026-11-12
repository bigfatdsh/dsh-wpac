#!/usr/bin/env node
// 输出前自检：字数 + 高频 AI 味句式 + 标题格式。
// 用法：node preflight.mjs [--min 800] [--max 1200] [--max-bushi 1] [--max-jiu 2] <file|->
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = { min: 0, max: Infinity, maxBushi: 1, maxJiu: 2, noDetails: false };
let file = '-';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--min') opt.min = Number(argv[++i]);
  else if (a === '--max') opt.max = Number(argv[++i]);
  else if (a === '--max-bushi') opt.maxBushi = Number(argv[++i]);
  else if (a === '--max-jiu') opt.maxJiu = Number(argv[++i]);
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

if (opt.min && han < opt.min) fails.push(`字数 ${han} < 下限 ${opt.min}`);
if (opt.max !== Infinity && han > opt.max) fails.push(`字数 ${han} > 上限 ${opt.max}`);

const fanan = count(/不是[^。！？\n]{0,20}[，,]\s*(是|而是)/g)
  + count(/算不上[^。！？\n]{0,20}(只是|就是)/g)
  + count(/与其说[^。！？\n]{0,20}不如说/g)
  + count(/不在于[^。！？\n]{0,20}而在于/g);
if (fanan > 0) fails.push(`翻案句 ${fanan} 处（不是…是 / 算不上…只是 / 与其说…不如说）`);

const duizhang = count(/的是[^。！？\n]{0,15}[，,][^。！？\n]{0,15}的是/g);
if (duizhang > 0) fails.push(`对仗 ${duizhang} 处（A 的是…，B 的是…）`);

const women = count(/我们/g);
if (women > 2) fails.push(`「我们」${women} 次（上限 2）`);

const yasuo = count(/不算新闻|不算什么|不过如此/g);
if (yasuo > 0) warns.push(`压缩句 ${yasuo} 处（不算新闻 / 不算什么 / 不过如此）`);

const tail = paras.slice(-2).join('');
const hedge = (tail.match(/大概率|也许|或许/g) || []).length;
if (hedge > 0) warns.push(`结尾含糊 ${hedge} 处（大概率 / 也许 / 或许）`);

const push = (msg) => (opt.noDetails ? fails : warns).push(msg);

const actions = count(/我(站了|站了挺久|翻开|翻到|走到|看见|看到|摸了摸|回头|坐|坐不住|掏出|拿出|跟着|走进|出了展馆|回到宿舍|回到|路过|读了)/g);
if (actions > 0) push(`第一人称具体动作 ${actions} 处（用户没给就删）`);

const exhibit = count(/工作证|成绩单|作业本|红笔|展板|展柜|模型|奖章|奖状/g);
if (exhibit > 0) push(`具体展品 ${exhibit} 处（用户没给就改概括）`);

const quote = count(/他说[，,：:]/g);
if (quote > 0) push(`真人引语 ${quote} 处（必须核对原文，查不到就转述）`);

const selfFact = count(/我[^。！？\n]{0,12}(抄|挂科|拖到|没交|作弊|拖延)/g);
if (selfFact > 0) push(`自己的事 ${selfFact} 处（用户没说就删）`);

const cnNum = count(/[一二三四五六七八九十百千万零两〇]+(岁|年|个|项|届|位|多)/g);
if (cnNum > 5) push(`中文数字 ${cnNum} 处（确认来源）`);

const personal = count(/实验|课设|社团|班干部|比赛|挂科|宿舍|食堂|早八|课表|作业/g);
if (personal > 0) push(`个人经历词 ${personal} 处（用户没给就删）`);

const unhuman = count(/离[^。！？\n]{0,10}很远|离[^。！？\n]{0,10}不远|算个意外|的账|验收人|颗粒度|底层逻辑|闭环|抓手|范式|复用|对齐|问不接/g);
if (unhuman > 0) fails.push(`不像人话 ${unhuman} 处（离…很远 / 算个意外 / 的账 / 验收人…）`);

const facts = count(/\d{4}\s*年|\d+\s*(岁|个|项|届|年)/g);
if (facts > 6) push(`具体数字 ${facts} 处（确认来源，≤4 更好）`);

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

const filler = count(/说起来|其实|说实话|说白了|我一开始|那时候|后来才|现在想起来|反正|你看|怎么说呢/g);
if (filler < 3) warns.push(`口语连接 / 废话 ${filler} 处（<3，可能太紧）`);

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
