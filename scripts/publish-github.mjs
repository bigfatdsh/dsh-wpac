#!/usr/bin/env node
// dsh-wpac 发布脚本：把本目录的源码推到 GitHub（走 api.github.com，本机 github.com:22 不通）。
//
// 用法：
//   node scripts/publish-github.mjs --dry-run   # 只看会推哪些文件
//   node scripts/publish-github.mjs             # 推送到 bigfatdsh/dsh-wpac
//
// 环境变量：REPO（默认 bigfatdsh/dsh-wpac）、BRANCH（默认 main）、GITHUB_TOKEN / GH_TOKEN。
// token 依次取：环境变量 → --token-file（默认 ~/.dsh/github-token）→ macOS 钥匙串。
//
// 只推有变化的文件：先取远端文件 sha 比对，一样就跳过，重复跑不会制造空提交。

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = process.env.REPO ?? 'bigfatdsh/dsh-wpac';
const BRANCH = process.env.BRANCH ?? 'main';
const API = 'https://api.github.com';
const DRY = process.argv.includes('--dry-run');

// token 来源（按顺序找，找到就用）：
//   1. 环境变量 GITHUB_TOKEN / GH_TOKEN —— iOS / 服务器上最省事；
//   2. --token-file <path>（默认 ~/.dsh/github-token）——不想让 token 进 shell 历史时用它；
//   3. macOS 钥匙串（老路径，桌面版继续能用）。
function readTokenFile() {
  const i = process.argv.indexOf('--token-file');
  const file = i !== -1 ? process.argv[i + 1] : path.join(os.homedir(), '.dsh', 'github-token');
  if (!file || !fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').replace(/\s+$/, '');
}

const TOKEN = (() => {
  const fromEnv = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  const fromFile = readTokenFile().trim();
  if (fromFile) return fromFile;
  try {
    return execSync('security find-internet-password -s github.com -w', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    console.error([
      '取不到 GitHub token。三选一：',
      '  · 环境变量：GITHUB_TOKEN=github_pat_xxx node scripts/publish-github.mjs',
      '  · 文件：把 token 写进 ~/.dsh/github-token（chmod 600），再直接跑脚本',
      '  · 桌面版：security add-internet-password -s github.com -a <用户名> -w <token>',
    ].join('\n'));
    process.exit(1);
  }
})();

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`,
  'User-Agent': 'dsh-wpac-publish',
  'Content-Type': 'application/json',
};

/** 要发布的文件：package.json 的 files（目录递归），外加 package.json 自身。 */
function collect() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const out = new Set(['package.json']);
  const walk = (rel) => {
    const abs = path.join(root, rel);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(abs)) {
        // ._* 是 macOS 的资源分叉影子文件，别推到仓库里。
        if (name === 'node_modules' || name === '.DS_Store' || name.startsWith('._')) continue;
        walk(path.join(rel, name));
      }
    } else {
      out.add(rel);
    }
  };
  for (const entry of pkg.files ?? []) if (fs.existsSync(path.join(root, entry))) walk(entry);
  // 发布脚本自身也进仓库，换台机器还能继续发。
  if (fs.existsSync(path.join(root, 'scripts/publish-github.mjs'))) out.add('scripts/publish-github.mjs');
  return [...out].sort();
}

async function api(endpoint, init = {}) {
  const response = await fetch(`${API}${endpoint}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body };
}

async function ensureRepo() {
  const existing = await api(`/repos/${REPO}`);
  if (existing.ok) return 'exists';
  if (existing.status !== 404) throw new Error(`检查仓库失败：${existing.status} ${JSON.stringify(existing.body).slice(0, 200)}`);
  const created = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: REPO.split('/')[1],
      description: 'WPAC agent preset for DeepSeek Harness: W/P/A/C prompt engineering (author: 姜涛)',
      private: false,
      has_issues: true,
      has_wiki: false,
    }),
  });
  if (!created.ok) throw new Error(`创建仓库失败：${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  return 'created';
}

async function remoteSha(file) {
  const res = await api(`/repos/${REPO}/contents/${encodeURI(file)}?ref=${BRANCH}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`读取远端 ${file} 失败：${res.status}`);
  return res.body?.sha ?? null;
}

function blobSha(buffer) {
  return createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

async function main() {
  console.log(`发布 ${root} → ${REPO}@${BRANCH}${DRY ? '（dry-run）' : ''}`);
  if (!DRY) console.log(`仓库：${await ensureRepo()}`);
  let pushed = 0;
  let skipped = 0;
  for (const file of collect()) {
    const buffer = fs.readFileSync(path.join(root, file));
    const sha = await remoteSha(file);
    if (sha !== null && sha === blobSha(buffer)) {
      console.log(`  = ${file} 未变化`);
      skipped += 1;
      continue;
    }
    if (DRY) {
      console.log(`  ⇢ ${file} 会推送（${(buffer.length / 1024).toFixed(1)} KB）`);
      pushed += 1;
      continue;
    }
    const res = await api(`/repos/${REPO}/contents/${encodeURI(file)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `dsh-wpac ${file}`,
        content: buffer.toString('base64'),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!res.ok) throw new Error(`推送 ${file} 失败：${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    console.log(`  ✓ ${file}（${(buffer.length / 1024).toFixed(1)} KB）`);
    pushed += 1;
  }
  console.log(`\n${DRY ? '[dry] ' : ''}${pushed} 个文件${DRY ? '会推送' : '已推送'}，${skipped} 个未变化 · ${REPO}@${BRANCH}`);
}

main().catch((error) => {
  console.error(`发布失败：${error?.message ?? error}`);
  process.exit(1);
});
