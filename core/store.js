'use strict';

/**
 * 插件数据目录读写（v1 精简版）
 *
 * 只负责「规则集文件」这一件事：
 * - 首次运行把随包 presets/rules/*.md 复制到数据目录（不覆盖用户已改过的文件）；
 * - 列出 / 读取规则文件；
 * - 其余（state.json / prompt-inject.md）已随 v1 重构废弃，文件保留但不读取。
 *
 * 无写入路径：本版没有编辑 UI，规则由用户手工编辑（改完重载插件生效）。
 */

const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function safeRuleId(id) {
  return String(id || '').replace(/[^A-Za-z0-9._-]/g, '');
}

function listRuleFiles(dataDir) {
  const dir = path.join(dataDir, 'rules');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

function readRuleFile(dataDir, id) {
  const safe = safeRuleId(id);
  if (!safe) return '';
  return readText(path.join(dataDir, 'rules', `${safe}.md`), '');
}

/** 首次运行：把插件自带 presets/rules 复制到数据目录（只补缺失文件） */
function seedRules(pluginDir, dataDir) {
  const src = path.join(pluginDir || '', 'presets', 'rules');
  const dst = path.join(dataDir, 'rules');
  ensureDir(dst);
  if (!pluginDir || !fs.existsSync(src)) return 0;
  let copied = 0;
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith('.md')) continue;
    const target = path.join(dst, f);
    if (fs.existsSync(target)) continue;
    fs.copyFileSync(path.join(src, f), target);
    copied++;
  }
  return copied;
}

module.exports = {
  ensureDir,
  readText,
  listRuleFiles,
  readRuleFile,
  seedRules,
};
