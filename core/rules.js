'use strict';

/**
 * 规则集（Phase 1 起使用）
 *
 * 文件格式（rules/<id>.md）：
 * ---
 * name: 前端规范
 * paths: src/**, packages/frontend/**
 * ---
 * 正文……
 *
 * paths 为空表示"所有工作目录都生效"。
 * 这里只做 glob-lite：支持 **、*、?，不引入第三方依赖。
 */

function parseFrontmatter(content) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { meta: {}, body: text.trim() };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: text.trim() };
  const head = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n/, '').trim();
  const meta = {};
  for (const line of head.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    meta[key] = value;
  }
  return { meta, body };
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function matchAny(workspacePath, patterns) {
  const target = normalizePath(workspacePath);
  if (!target) return patterns.length === 0;
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => {
    const p = normalizePath(pattern);
    if (!p) return true;
    // 相对模式（frontend/**）按"路径中任意位置"匹配；绝对模式（D:/x/**）原样匹配。
    const scoped = /^([A-Za-z]:|\/)/.test(p) ? p : `**/${p}`;
    if (globToRegExp(scoped).test(target)) return true;
    // 目录模式：`x/**` 同时匹配目录本身（/a/x）与子路径（/a/x/y）
    if (scoped.endsWith('/**') && globToRegExp(scoped.slice(0, -3)).test(target)) return true;
    // 目录前缀语义：pattern 为目录时匹配其子路径
    return target === p || target.startsWith(`${p}/`) || target.endsWith(`/${p}`);
  });
}

function parseRule(id, content) {
  const { meta, body } = parseFrontmatter(content);
  return {
    id,
    name: meta.name || id,
    paths: parseList(meta.paths),
    body,
  };
}

/** 返回在给定工作目录下生效的规则（保持文件顺序）。 */
function selectRules(rules, workspacePath) {
  return (rules || []).filter((rule) => matchAny(workspacePath, rule.paths || []));
}

function renderRules(rules) {
  return (rules || [])
    .map((rule) => rule.body)
    .filter(Boolean)
    .join('\n\n');
}

module.exports = { parseFrontmatter, parseRule, selectRules, renderRules, matchAny, globToRegExp };
