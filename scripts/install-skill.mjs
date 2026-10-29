#!/usr/bin/env node
// 把 wpac 技能装进 DSH 的默认技能根目录（~/.dsh/skills/wpac）。
//
// 为什么不用预设里的 customSkillDirs：那个写法要在预设里内嵌 !!js 表达式，
// 注册时多一个可能失败的环节；装到默认根目录后，任何挂了 skill-filesystem 的
// 预设（包括 WPAC 自己）都能直接看到 wpac，预设声明保持纯静态。
//
// 用法：node scripts/install-skill.mjs [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'skills', 'wpac');
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const target = path.join(dshHome, 'skills', 'wpac');
const dry = process.argv.includes('--dry-run');

if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
  console.error(`源技能不存在：${source}/SKILL.md`);
  process.exit(1);
}

if (dry) {
  console.log(`[dry] ${source} → ${target}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
const size = fs.statSync(path.join(target, 'SKILL.md')).size;
console.log(`已安装技能：${target}（SKILL.md ${size} 字节）`);
