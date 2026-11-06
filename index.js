'use strict';

/**
 * GuaDa Purge — 三方插件（Phase 1 MVP）
 *
 * 能力：
 * - 提示词段：persona（prompt-inject.md 优先）+ 规则集
 * - 技能库：随包 skills/*.md → registerSkill
 * - 模型工具：purge_status / purge_apply / purge_revert
 * - 设置页：状态 / 提示词 / 规则集（RPC 读写插件数据目录）
 *
 * 约束：
 * - 零依赖 CommonJS；只使用 onLoad(api) 的公开 PluginApi；
 * - 不修改宿主源码、不绕过安全策略/审批/沙箱。
 */

const path = require('node:path');
const os = require('node:os');

const { createState, applyPatch, revertTo } = require('./core/state');
const { resolveInjectText } = require('./core/prompt');
const { parseRule, selectRules, renderRules } = require('./core/rules');
const { loadSkills } = require('./core/skills');
const { buildStatus, STATUS } = require('./core/status');
const store = require('./core/store');

const PLUGIN_ID = 'guada-purge';
const PLUGIN_NAME = 'GuaDa Purge';
const VERSION = '0.2.0';

const NLS_ZH = {
  'settings.title': 'GuaDa Purge',
  'settings.desc': '人格、规则与技能控制台',
};
const NLS_EN = {
  'settings.title': 'GuaDa Purge',
  'settings.desc': 'Persona, rules and skills console',
};

class GuadaPurgePlugin {
  constructor() {
    this.manifest = {
      id: PLUGIN_ID,
      name: PLUGIN_NAME,
      version: VERSION,
      description: '人格、规则与技能控制台 —— GuaDa 三方插件参考实现',
      author: 'donggua-zen',
      category: 'user',
      icon: 'assets/icon.svg',
    };
    this.api = null;
    this.dataDir = null;
    this.pluginDir = null;
    this.state = createState();
    this.promptInject = '';
    this.rules = [];
    this.skills = [];
  }

  async onLoad(api) {
    this.api = api;
    this.pluginDir = typeof api.getPluginDir === 'function' ? api.getPluginDir() : undefined;
    this.dataDir =
      typeof api.getDataDir === 'function'
        ? api.getDataDir()
        : path.join(os.tmpdir(), PLUGIN_ID);

    store.ensureDir(this.dataDir);
    store.seedRules(this.pluginDir, this.dataDir);
    this.reloadAll();

    this.registerNls(api);
    this.registerSlots(api);
    this.registerPromptSections(api);
    this.registerSkills(api);
    this.registerTools(api);
    this.registerRpc(api);
  }

  async onStart() {
    // 数据目录可能被外部修改（用户手工编辑），启动时重读一次。
    this.reloadAll();
  }

  async onStop() {}

  async onUnload() {}

  // ── 数据加载 ──

  reloadAll() {
    this.state = store.loadState(this.dataDir);
    this.promptInject = store.loadPromptInject(this.dataDir);
    this.rules = store
      .listRuleFiles(this.dataDir)
      .map((f) => f.replace(/\.md$/, ''))
      .map((id) => parseRule(id, store.readRuleFile(this.dataDir, id)));
    this.skills = loadSkills(path.join(this.pluginDir || '', 'skills'));
  }

  persist(nextState) {
    this.state = store.saveState(this.dataDir, nextState);
    this.reloadAll();
    return this.state;
  }

  // ── 提示词 ──

  personaText() {
    return resolveInjectText({
      promptInject: this.promptInject,
      fallback: this.state.active.persona,
    }).text;
  }

  rulesText(context) {
    const selected = this.state.active.ruleSet;
    const active = selected
      ? this.rules.filter((r) => r.id === selected)
      : selectRules(this.rules, context?.session?.workspacePath || '');
    return renderRules(active);
  }

  registerPromptSections(api) {
    if (typeof api.registerPromptSection !== 'function') return;
    api.registerPromptSection({
      name: `${PLUGIN_ID}.persona`,
      order: -100,
      text: () => this.personaText(),
      description: 'GuaDa Purge persona / prompt-inject.md',
    });
    api.registerPromptSection({
      name: `${PLUGIN_ID}.rules`,
      order: 100,
      text: (ctx) => this.rulesText(ctx),
      description: 'GuaDa Purge rule sets',
    });
  }

  registerSkills(api) {
    if (typeof api.registerSkill !== 'function') return;
    for (const skill of this.skills) {
      api.registerSkill({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        version: VERSION,
        author: 'donggua-zen',
        tags: skill.tags,
      });
    }
  }

  // ── 工具 ──

  registerTools(api) {
    if (typeof api.registerTool !== 'function') return;

    api.registerTool({
      name: 'purge_status',
      description: '查看 GuaDa Purge 的当前状态（提示词/规则集/技能）。只读。',
      parameters: {},
      readOnly: true,
      dangerLevel: 'safe',
      execute: async () => ({ content: this.statusText() }),
    });

    api.registerTool({
      name: 'purge_apply',
      description:
        '应用一次配置变更（人格文本/规则集）。会先保存当前状态为快照，可回滚。',
      parameters: {
        persona: { type: 'string', required: false, description: '人格/提示词文本' },
        ruleSet: { type: 'string', required: false, description: '规则集 id；空字符串表示按工作目录自动匹配' },
      },
      dangerLevel: 'normal',
      execute: async (args) => {
        const patch = {};
        if (typeof args?.persona === 'string') patch.persona = args.persona;
        if (typeof args?.ruleSet === 'string') patch.ruleSet = args.ruleSet || null;
        const next = this.persist(applyPatch(this.state, patch, 'tool:apply'));
        return { content: `已应用（revision=${next.revision}）。\n${this.statusText()}` };
      },
    });

    api.registerTool({
      name: 'purge_revert',
      description: '回滚 GuaDa Purge 到上一个快照或指定 revision。',
      parameters: {
        revision: { type: 'number', required: false, description: '目标 revision；缺省回滚到上一个快照' },
      },
      dangerLevel: 'normal',
      execute: async (args) => {
        const target =
          typeof args?.revision === 'number'
            ? args.revision
            : this.state.snapshots.length
              ? this.state.snapshots[this.state.snapshots.length - 1].revision
              : 0;
        const next = this.persist(revertTo(this.state, target));
        return { content: `已回滚到 revision=${target}（当前 revision=${next.revision}）。` };
      },
    });
  }

  // ── RPC ──

  registerRpc(api) {
    if (typeof api.registerRpc !== 'function') return;
    api.registerRpc({
      get_state: () => this.snapshotForUi(),
      get_status: () => this.statusForUi(),
      save_persona: (args) => {
        const persona = typeof args?.persona === 'string' ? args.persona : '';
        this.persist(applyPatch(this.state, { persona }, 'ui:persona'));
        return this.snapshotForUi();
      },
      save_prompt: (args) => {
        store.savePromptInject(this.dataDir, args?.text || '');
        this.reloadAll();
        return this.snapshotForUi();
      },
      list_rules: () => this.rulesForUi(),
      set_rule: (args) => {
        const id = args?.id ? String(args.id) : null;
        this.persist(applyPatch(this.state, { ruleSet: id }, 'ui:rule'));
        return this.snapshotForUi();
      },
      create_rule: (args) => {
        const id = String(args?.id || '').trim();
        if (!id) throw new Error('rule id is required');
        const name = String(args?.name || id);
        const paths = String(args?.paths || '').trim();
        const body = String(args?.content || '');
        const content = `---\nname: ${name}\npaths: ${paths}\n---\n${body}\n`;
        store.writeRuleFile(this.dataDir, id, content);
        this.reloadAll();
        return this.rulesForUi();
      },
      delete_rule: (args) => {
        store.deleteRuleFile(this.dataDir, args?.id);
        if (this.state.active.ruleSet === args?.id) {
          this.persist(applyPatch(this.state, { ruleSet: null }, 'ui:rule-deleted'));
        } else {
          this.reloadAll();
        }
        return this.rulesForUi();
      },
      apply: () => this.statusForUi(),
      revert: (args) => {
        const target =
          typeof args?.revision === 'number'
            ? args.revision
            : this.state.snapshots.length
              ? this.state.snapshots[this.state.snapshots.length - 1].revision
              : 0;
        this.persist(revertTo(this.state, target));
        return this.snapshotForUi();
      },
    });
  }

  // ── UI 数据 ──

  rulesForUi() {
    return {
      rules: this.rules.map((r) => ({
        id: r.id,
        name: r.name,
        paths: r.paths,
        bytes: r.body.length,
      })),
      selected: this.state.active.ruleSet,
    };
  }

  snapshotForUi() {
    return {
      version: VERSION,
      dataDir: this.dataDir,
      state: this.state,
      promptInject: this.promptInject,
      persona: this.personaText(),
      rules: this.rulesForUi(),
      skills: this.skills.map((s) => ({ name: s.name, description: s.description })),
    };
  }

  statusForUi() {
    const persona = this.personaText();
    const selected = this.state.active.ruleSet;
    const activeRules = selected
      ? this.rules.filter((r) => r.id === selected)
      : this.rules;
    const rulesText = renderRules(activeRules);
    const status = buildStatus([
      {
        id: 'persona',
        label: '人格 / 提示词',
        group: 'prompt',
        status: persona ? STATUS.APPLIED : STATUS.SKIPPED,
        detail: persona ? `${persona.length} 字符` : '未设置',
      },
      {
        id: 'rules',
        label: '规则集',
        group: 'prompt',
        status: rulesText ? STATUS.APPLIED : STATUS.SKIPPED,
        detail: selected ? `已选 ${selected}` : `${this.rules.length} 个规则文件（按目录匹配）`,
      },
      {
        id: 'skills',
        label: '技能库',
        group: 'skills',
        status: this.skills.length ? STATUS.APPLIED : STATUS.SKIPPED,
        detail: `${this.skills.length} 条`,
      },
      {
        id: 'tools',
        label: '模型工具',
        group: 'tools',
        status: STATUS.APPLIED,
        detail: 'purge_status / purge_apply / purge_revert',
      },
    ]);
    return { ...status, revision: this.state.revision, snapshots: this.state.snapshots.length };
  }

  statusText() {
    const s = this.statusForUi();
    const lines = [`GuaDa Purge v${VERSION}`, `revision=${s.revision} snapshots=${s.snapshots}`];
    for (const row of s.rows) {
      lines.push(`[${row.group}]`);
      for (const e of row.entries) {
        lines.push(`  - ${e.label}: ${e.status}${e.detail ? ` (${e.detail})` : ''}`);
      }
    }
    return lines.join('\n');
  }

  // ── 注册（槽位/NLS） ──

  registerNls(api) {
    if (typeof api.registerNls !== 'function') return;
    api.registerNls('zh', NLS_ZH);
    api.registerNls('en', NLS_EN);
  }

  registerSlots(api) {
    if (typeof api.registerSlot !== 'function') return;
    api.registerSlot({
      name: 'settings',
      component: 'SettingsPage',
      mode: 'list',
      order: 60,
      meta: { label: '%settings.title%', group: 'plugin' },
    });
  }
}

module.exports = GuadaPurgePlugin;
module.exports.default = GuadaPurgePlugin;
