'use strict';

/**
 * 技能加载（Phase 1 起使用）
 *
 * 文件格式（skills/<id>.md）：
 * ---
 * name: 名称
 * description: 一句话描述
 * tags: a, b
 * ---
 * 正文（即 registerSkill 的 content）
 *
 * 插件安装目录只读；技能随仓库分发，不写用户数据目录。
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('./rules');

function parseSkill(id, content) {
  const { meta, body } = parseFrontmatter(content);
  return {
    name: meta.name || id,
    description: meta.description || '',
    tags: meta.tags ? String(meta.tags).split(',').map((s) => s.trim()).filter(Boolean) : [],
    content: body,
  };
}

function loadSkills(dir, fsImpl = fs) {
  if (!dir || !fsImpl.existsSync(dir)) return [];
  return fsImpl
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const id = path.basename(f, '.md');
      const raw = fsImpl.readFileSync(path.join(dir, f), 'utf8');
      return { id, ...parseSkill(id, raw) };
    })
    .filter((s) => s.content);
}

module.exports = { parseSkill, loadSkills };
