'use strict';

/**
 * Drill 授权状态（Phase 2 使用）
 *
 * 纯本地、纯数据：记录"用户已读声明 + 勾选 + 时间"。
 * 不涉及任何绕过宿主安全策略的行为；Drill 页只是清单与环境检查。
 */

const GRANT_VERSION = 1;

function createGrant({ version = GRANT_VERSION, acceptedAt = new Date().toISOString() } = {}) {
  return { version, acceptedAt };
}

function isGrantValid(grant, { version = GRANT_VERSION, maxAgeDays = 365, now = Date.now() } = {}) {
  if (!grant || typeof grant !== 'object') return false;
  if (grant.version !== version) return false;
  const at = Date.parse(grant.acceptedAt);
  if (!Number.isFinite(at)) return false;
  return now - at <= maxAgeDays * 24 * 60 * 60 * 1000;
}

module.exports = { GRANT_VERSION, createGrant, isGrantValid };
