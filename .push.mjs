/**
 * 通过 GitHub Git Data API 提交本次改动。
 *
 * 为什么不直接 git push：项目约定 GitHub 相关操作一律走云端 API，
 * 不在本地克隆仓库再推送。这里逐文件上传 blob → 组装 tree → 建 commit → 更新 ref。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = 'deltrivx/tonecore';
const BRANCH = 'main';
const ROOT = process.cwd();

/** 需要排除的路径（依赖、构建产物、本地工具目录） */
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git']);
const EXCLUDE_FILES = new Set(['package-lock.json']);

function gh(args, input) {
  const out = execFileSync('gh', args, {
    input,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  return out;
}

function ghJson(args, input) {
  const raw = gh(args, input);
  try { return JSON.parse(raw); } catch { return raw.trim(); }
}

/** 递归收集要提交的文件（相对路径） */
function collect(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = e.name;
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      out.push(...collect(path.join(dir, name), path.join(base, name)));
    } else {
      if (EXCLUDE_FILES.has(name)) continue;
      out.push(path.join(base, name).split(path.sep).join('/'));
    }
  }
  return out;
}

// ---- 1. 取当前 HEAD 与其 tree ----
const ref = ghJson(['api', `repos/${REPO}/git/ref/heads/${BRANCH}`]);
const headSha = ref.object.sha;
const headCommit = ghJson(['api', `repos/${REPO}/git/commits/${headSha}`]);
const baseTree = headCommit.tree.sha;
console.log(`当前 HEAD: ${headSha.slice(0, 8)}  tree: ${baseTree.slice(0, 8)}`);

// ---- 2. 逐文件上传 blob ----
const files = collect(ROOT).filter((f) => !f.startsWith('.git/'));
console.log(`待提交文件：${files.length} 个`);

const treeEntries = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const content = fs.readFileSync(abs);
  const isBinary = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot)$/i.test(rel);

  const body = JSON.stringify({
    content: isBinary ? content.toString('base64') : content.toString('utf8'),
    encoding: isBinary ? 'base64' : 'utf-8',
  });

  const blob = ghJson(
    ['api', '--method', 'POST', `repos/${REPO}/git/blobs`, '--input', '-'],
    body,
  );
  treeEntries.push({
    path: rel,
    mode: '100644',
    type: 'blob',
    sha: blob.sha,
  });
  process.stdout.write(`  ✓ ${rel}\n`);
}

// ---- 3. 组装新 tree ----
const treeBody = JSON.stringify({
  base_tree: baseTree,
  tree: treeEntries,
});
const newTree = ghJson(
  ['api', '--method', 'POST', `repos/${REPO}/git/trees`, '--input', '-'],
  treeBody,
);
console.log(`新 tree: ${newTree.sha.slice(0, 8)}`);

// ---- 4. 建 commit ----
const message = fs.readFileSync(path.join(ROOT, '.commitmsg'), 'utf8').trim();
const commitBody = JSON.stringify({
  message,
  tree: newTree.sha,
  parents: [headSha],
});
const newCommit = ghJson(
  ['api', '--method', 'POST', `repos/${REPO}/git/commits`, '--input', '-'],
  commitBody,
);
console.log(`新 commit: ${newCommit.sha.slice(0, 8)}`);

// ---- 5. 更新分支引用 ----
const updBody = JSON.stringify({ sha: newCommit.sha, force: false });
ghJson(
  ['api', '--method', 'PATCH', `repos/${REPO}/git/refs/heads/${BRANCH}`, '--input', '-'],
  updBody,
);
console.log(`已更新 ${BRANCH} → ${newCommit.sha.slice(0, 8)}`);
console.log(`提交地址：${newCommit.html_url}`);
