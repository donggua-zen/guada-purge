'use strict';

/**
 * 插件状态与快照（Phase 1 起使用）
 *
 * 语义：
 * - active 是"当前注入到宿主提示词/技能的内容"；
 * - apply 前自动把旧 active 压入 snapshots，便于 revert；
 * - 状态由宿主插件数据目录里的 state.json 持久化（本模块不碰 fs）。
 */

const MAX_SNAPSHOTS = 20;

function createState() {
  return {
    revision: 0,
    active: {
      persona: '',
      ruleSet: null,
      skills: true,
    },
    snapshots: [],
  };
}

/** 容错解析：坏 JSON / 旧结构回退到空状态，由调用方决定是否备份坏文件。 */
function parseState(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { state: createState(), corrupted: true };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { state: createState(), corrupted: true };
  }
  const base = createState();
  return {
    state: {
      revision: Number.isFinite(data.revision) ? data.revision : 0,
      active: {
        persona: typeof data.active?.persona === 'string' ? data.active.persona : base.active.persona,
        ruleSet: typeof data.active?.ruleSet === 'string' ? data.active.ruleSet : null,
        skills: data.active?.skills !== false,
      },
      snapshots: Array.isArray(data.snapshots) ? data.snapshots.slice(-MAX_SNAPSHOTS) : [],
    },
    corrupted: false,
  };
}

function cloneActive(active) {
  return {
    persona: active.persona,
    ruleSet: active.ruleSet,
    skills: active.skills,
  };
}

/**
 * 应用一次变更：旧状态进快照，返回新状态。
 * patch 只接受 active 的字段级合并。
 */
function applyPatch(state, patch, label) {
  const next = {
    revision: state.revision + 1,
    active: { ...cloneActive(state.active), ...patch },
    snapshots: state.snapshots.concat([
      {
        revision: state.revision,
        label: label || 'apply',
        at: new Date().toISOString(),
        active: cloneActive(state.active),
      },
    ]).slice(-MAX_SNAPSHOTS),
  };
  return next;
}

/** 回滚到指定 revision（0 = 初始空状态）。 */
function revertTo(state, revision) {
  const target = Number(revision);
  const snap = state.snapshots.find((s) => s.revision === target);
  const active = snap ? cloneActive(snap.active) : createState().active;
  return {
    revision: state.revision + 1,
    active,
    snapshots: state.snapshots.concat([
      {
        revision: state.revision,
        label: `revert:${target}`,
        at: new Date().toISOString(),
        active: cloneActive(state.active),
      },
    ]).slice(-MAX_SNAPSHOTS),
  };
}

module.exports = { createState, parseState, applyPatch, revertTo, MAX_SNAPSHOTS };
