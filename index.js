'use strict';

/**
 * GuaDa Purge v1 —— 安全研究工作模式（PluginApi v4）
 *
 * 形态：**专属智能体 + 专属能力**，不污染其他智能体。
 *
 *   能力包 `purge`（toolkit，visibleTo: ["self"]）
 *     ├─ 工具 purge_status / purge_rules（均只读）
 *     └─ 技能 skills/*.md（随包门控显隐）
 *   提示词段 `guada-purge.rules`（visibleTo: ["self"]，按工作目录匹配规则集）
 *   专属智能体 `plugin-guada-purge-research`「安全研究助手」
 *
 * 约束：
 * - 零依赖 CommonJS，只用 onLoad(api) 的公开 PluginApi；
 * - 不修改宿主源码、不绕过安全策略/审批/沙箱；
 * - 不做全局注入：所有能力都带 visibleTo，其他智能体完全无感。
 */

const path = require('node:path');
const os = require('node:os');

const { parseRule, selectRules, renderRules } = require('./core/rules');
const { loadSkills } = require('./core/skills');
const { buildStatus, STATUS } = require('./core/status');
const store = require('./core/store');

const PLUGIN_ID = 'guada-purge';
const VERSION = '1.0.0';

/** 能力包 id（智能体的 toolkits 白名单引用它） */
const KIT_ID = 'purge';
/** 智能体 id：宿主导航为 plugin-guada-purge-research */
const AGENT_ID = 'research';
const AGENT_NAME = '安全研究助手';
/** 规则集提示词段名 */
const RULES_SECTION = `${PLUGIN_ID}.rules`;

const FALLBACK_PERSONA =
  '你是一名资深安全研究工程师，协助在已获授权的环境中做代码审计与漏洞验证。' +
  '先确认边界与授权范围，最小影响优先，结论附可复核证据，区分事实与推测。';

class GuadaPurgePlugin {
  constructor() {
    this.manifest = {
      id: PLUGIN_ID,
      name: 'GuaDa Purge',
      version: VERSION,
      description: '安全研究工作模式 —— 专属智能体 + 规则集 + 技能库',
      author: 'donggua-zen',
      category: 'user',
      icon: 'assets/icon.svg',
    };

    this.api = null;
    this.pluginDir = null;
    this.dataDir = null;

    /** 人设正文（presets/persona.md） */
    this.persona = '';
    /** 解析后的规则集 */
    this.rules = [];
    /** 随包技能 */
    this.skills = [];
  }

  // ── 生命周期 ──

  async onLoad(api) {
    this.api = api;
    this.pluginDir =
      typeof api.getPluginDir === 'function' ? api.getPluginDir() : undefined;
    this.dataDir =
      typeof api.getDataDir === 'function'
        ? api.getDataDir()
        : path.join(os.tmpdir(), PLUGIN_ID);

    store.ensureDir(this.dataDir);
    // 首次运行把 presets/rules/*.md 复制到数据目录（不覆盖用户已改过的文件）
    store.seedRules(this.pluginDir, this.dataDir);
    this.reloadAll();

    this.registerCapabilityPack(api);
    this.registerRulesSection(api);
    this.registerAgent(api);
  }

  async onStart() {
    // 用户可能手工改过 rules/*.md，启用时重读一次
    this.reloadAll();
  }

  async onStop() {}

  async onUnload() {
    // 外部插件拿不到宿主的 SkillRegistry 实例；残留技能由宿主
    // `isPluginEnabled` 判定自然不可见（见 skill-orchestrator 的可见性检查），
    // 不需要也无法在这里手动清理。
  }

  // ── 数据加载 ──

  reloadAll() {
    this.persona = this.loadPersona();
    this.rules = store
      .listRuleFiles(this.dataDir)
      .map((file) => file.replace(/\.md$/, ''))
      .map((id) => parseRule(id, store.readRuleFile(this.dataDir, id)))
      .filter((rule) => rule.body);
    this.skills = loadSkills(path.join(this.pluginDir || '', 'skills'));
  }

  loadPersona() {
    const text = store.readText(
      path.join(this.pluginDir || '', 'presets', 'persona.md'),
      '',
    );
    return String(text || '').trim() || FALLBACK_PERSONA;
  }

  /** 当前工作目录下命中的规则集 */
  activeRules(workspacePath) {
    return selectRules(this.rules, workspacePath || '');
  }

  // ── 能力包：工具 + 技能（整包 visibleTo: self） ──

  registerCapabilityPack(api) {
    if (typeof api.registerToolKit !== 'function') return;

    const plugin = this;

    api.registerToolKit({
      id: KIT_ID,
      name: '安全研究',
      description: '安全研究专用工具与技能（仅本插件注册的智能体可用）',
      loadMode: 'eager',
      // 作用域收口：只有 plugin-guada-purge-* 的智能体看得到整包
      visibleTo: ['self'],
      onLoad(toolkit) {
        plugin.registerTools(toolkit);
        plugin.registerSkills(toolkit);
      },
    });
  }

  registerTools(toolkit) {
    if (typeof toolkit.registerRawTool !== 'function') return;

    const plugin = this;

    toolkit.registerRawTool({
      name: 'purge_status',
      description:
        '查看当前安全研究工作模式的状态：插件版本、生效的规则集、技能数量。只读。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => ({
        content: plugin.statusText(ctx?.session?.workspacePath || ''),
      }),
    });

    toolkit.registerRawTool({
      name: 'purge_rules',
      description:
        '列出全部规则集，或读取指定规则集的正文。只读。' +
        '不传 id 时列出清单（标注当前工作目录下哪些生效）；传 id 返回正文。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '规则集 id（清单里的 id 字段）；省略则只列清单',
          },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => ({
        content: plugin.rulesText(
          ctx?.session?.workspacePath || '',
          typeof args?.id === 'string' ? args.id : '',
        ),
      }),
    });
  }

  registerSkills(toolkit) {
    if (typeof toolkit.registerSkill !== 'function') return;
    for (const skill of this.skills) {
      toolkit.registerSkill({
        name: skill.name,
        description: skill.description || skill.name,
        content: skill.content,
        version: VERSION,
        author: 'donggua-zen',
        tags: skill.tags,
      });
    }
  }

  // ── 规则集提示词段（按工作目录动态求值） ──

  registerRulesSection(api) {
    if (typeof api.registerPromptSection !== 'function') return;
    const plugin = this;
    api.registerPromptSection({
      name: RULES_SECTION,
      order: 100,
      // 只有专属智能体会拿到本段
      visibleTo: ['self'],
      description: '按工作目录生效的规则集',
      text: (ctx) =>
        renderRules(plugin.activeRules(ctx?.session?.workspacePath || '')),
    });
  }

  // ── 专属智能体 ──

  registerAgent(api) {
    if (typeof api.registerAgent !== 'function') return;
    api.registerAgent({
      id: AGENT_ID,
      name: AGENT_NAME,
      description:
        '安全研究、代码审计与漏洞验证方法论助手：先确认授权边界，最小影响取证，结论附可复核证据。',
      avatar: 'assets/icon.svg',
      systemPrompt: this.persona,
      // 工具包白名单（缺省会是本插件全部包，这里显式写死，避免将来加包时行为漂移）
      toolkits: [KIT_ID],
      // 技能白名单必须显式列出（缺省会一个都不开），名字一律小写
      skills: this.skills.map((skill) => String(skill.name).toLowerCase()),
      settings: { memory: { summaryMode: 'memory_sync' } },
    });
  }

  // ── 工具/状态文本 ──

  statusText(workspacePath) {
    const active = this.activeRules(workspacePath);
    const status = buildStatus([
      {
        id: 'agent',
        label: '专属智能体',
        group: 'mode',
        status: STATUS.APPLIED,
        detail: `${AGENT_NAME}（plugin-${PLUGIN_ID}-${AGENT_ID}）`,
      },
      {
        id: 'rules',
        label: '规则集',
        group: 'prompt',
        status: active.length ? STATUS.APPLIED : STATUS.SKIPPED,
        detail: active.length
          ? `命中 ${active.map((r) => r.id).join(', ')}`
          : `${this.rules.length} 个可用，当前目录无命中`,
      },
      {
        id: 'skills',
        label: '技能库',
        group: 'capability',
        status: this.skills.length ? STATUS.APPLIED : STATUS.SKIPPED,
        detail: `${this.skills.length} 条`,
      },
      {
        id: 'tools',
        label: '工具',
        group: 'capability',
        status: STATUS.APPLIED,
        detail: 'purge_status / purge_rules',
      },
    ]);

    const lines = [
      `GuaDa Purge v${VERSION}（${PLUGIN_ID}）`,
      `工作目录：${workspacePath || '(未指定)'}`,
    ];
    for (const row of status.rows) {
      lines.push(`[${row.group}]`);
      for (const entry of row.entries) {
        lines.push(
          `  - ${entry.label}: ${entry.status}${entry.detail ? ` (${entry.detail})` : ''}`,
        );
      }
    }
    lines.push('提示：规则集在 plugins-data/guada-purge/rules/*.md，改完重载插件生效。');
    return lines.join('\n');
  }

  rulesText(workspacePath, id) {
    if (id) {
      const rule = this.rules.find((r) => r.id === id);
      if (!rule) {
        return `未找到规则集「${id}」。可用：${this.rules.map((r) => r.id).join(', ') || '(无)'}`;
      }
      return `# ${rule.name}（id=${rule.id}）\npaths: ${rule.paths.join(', ') || '(全部目录)'}\n\n${rule.body}`;
    }

    if (this.rules.length === 0) {
      return '当前没有任何规则集。可在 plugins-data/guada-purge/rules/ 下放置 .md 文件。';
    }

    const activeIds = new Set(this.activeRules(workspacePath).map((r) => r.id));
    const lines = [
      `规则集清单（工作目录：${workspacePath || '(未指定)'}）：`,
    ];
    for (const rule of this.rules) {
      const mark = activeIds.has(rule.id) ? '✔' : ' ';
      lines.push(
        `  ${mark} ${rule.id} — ${rule.name}` +
          `（paths: ${rule.paths.join(', ') || '全部'}，${rule.body.length} 字符）`,
      );
    }
    lines.push('');
    lines.push('用 purge_rules({ id }) 查看正文。');
    return lines.join('\n');
  }
}

module.exports = GuadaPurgePlugin;
module.exports.default = GuadaPurgePlugin;
