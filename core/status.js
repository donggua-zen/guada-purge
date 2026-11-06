'use strict';

/**
 * 状态分组（Phase 1/3 使用）
 *
 * 与 dsh-purge 的补丁状态对齐：
 *   applied / already / skipped / failed
 * 这里不执行任何宿主补丁，只把插件自己的组件（persona/rules/skills/tools）
 * 归一成同一套展示状态。
 */

const STATUS = {
  APPLIED: 'applied',
  ALREADY: 'already',
  SKIPPED: 'skipped',
  FAILED: 'failed',
};

function normalizeStatus(value) {
  return Object.values(STATUS).includes(value) ? value : STATUS.SKIPPED;
}

/**
 * @param {Array<{id:string,label?:string,group?:string,status:string,detail?:string}>} items
 */
function buildStatus(items) {
  const groups = new Map();
  for (const item of items || []) {
    const group = item.group || 'general';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({
      id: item.id,
      label: item.label || item.id,
      status: normalizeStatus(item.status),
      detail: item.detail || '',
    });
  }
  const rows = Array.from(groups.entries()).map(([group, entries]) => ({
    group,
    entries,
    counts: entries.reduce((acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    }, {}),
  }));
  const totals = rows.reduce((acc, row) => {
    for (const [k, v] of Object.entries(row.counts)) acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {});
  return { rows, totals };
}

module.exports = { STATUS, buildStatus, normalizeStatus };
