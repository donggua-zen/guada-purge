'use strict';

/**
 * 提示词解析（Phase 1 起使用）
 *
 * 优先级（与 dsh-purge 的 prompt-inject.md > 规则集 > 默认 一致）：
 *   1. 用户编辑的 prompt-inject.md（非空）
 *   2. 当前选中的规则集正文
 *   3. 空（不注入任何内容）
 */

function normalize(text) {
  return typeof text === 'string' ? text.trim() : '';
}

function resolveInjectText({ promptInject, ruleText, fallback } = {}) {
  const own = normalize(promptInject);
  if (own) return { text: own, source: 'prompt' };
  const rule = normalize(ruleText);
  if (rule) return { text: rule, source: 'rules' };
  const def = normalize(fallback);
  if (def) return { text: def, source: 'default' };
  return { text: '', source: 'none' };
}

/** 把人格段与规则段拼成一次注入文本（顺序固定，便于测试）。 */
function composeSections({ persona, rules } = {}) {
  return [normalize(persona), normalize(rules)].filter(Boolean).join('\n\n');
}

module.exports = { resolveInjectText, composeSections, normalize };
