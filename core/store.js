'use strict';

/**
 * 插件数据目录读写（Phase 1）
 *
 * - 所有写入走临时文件 + rename，避免半截 JSON；
 * - 坏文件重命名成 .bad 后回退默认值，不阻塞启动；
 * - 首次运行把随包 presets/rules/*.md 复制到数据目录（不覆盖用户已有文件）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createState, parseState } = require('./state');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTextAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function loadState(dataDir) {
  const file = path.join(dataDir, 'state.json');
  if (!fs.existsSync(file)) return createState();
  const raw = readText(file);
  const { state, corrupted } = parseState(raw);
  if (corrupted) {
    try {
      fs.renameSync(file, `${file}.bad`);
    } catch {
      /* ignore */
    }
  }
  return state;
}

function saveState(dataDir, state) {
  writeJsonAtomic(path.join(dataDir, 'state.json'), state);
  return state;
}

function loadPromptInject(dataDir) {
  return readText(path.join(dataDir, 'prompt-inject.md'), '');
}

function savePromptInject(dataDir, text) {
  writeTextAtomic(path.join(dataDir, 'prompt-inject.md'), String(text || ''));
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
  const safe = String(id || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) return '';
  return readText(path.join(dataDir, 'rules', `${safe}.md`), '');
}

function writeRuleFile(dataDir, id, content) {
  const safe = String(id || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) throw new Error('invalid rule id');
  writeTextAtomic(path.join(dataDir, 'rules', `${safe}.md`), String(content || ''));
  return safe;
}

function deleteRuleFile(dataDir, id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) return false;
  const file = path.join(dataDir, 'rules', `${safe}.md`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
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
  writeTextAtomic,
  writeJsonAtomic,
  readText,
  loadState,
  saveState,
  loadPromptInject,
  savePromptInject,
  listRuleFiles,
  readRuleFile,
  writeRuleFile,
  deleteRuleFile,
  seedRules,
};
