'use strict';

/**
 * GuaDa Purge v2 —— 红队模式（PluginApi v4）
 *
 * 对齐 dsh-purge 的能力面（P1 阶段：单兵闭环）。
 *
 *   能力包 `redteam`（visibleTo: ["self"]）
 *     ├─ 资产库工具（engagement / asset / vuln / evidence / webshell / tunnel / credential / score）
 *     └─ 技能 skills/*.md（红队方法论）
 *   专属智能体「红队指挥官」（plugin-guada-purge-leader）
 *
 * 存储：dataDir/redteam.json（零依赖 JSON 资产库，见 core/redteam-db.js）。
 * 边界：不修改宿主、不绕过安全策略；沙箱档位由用户自行切换。
 */

const path = require('node:path');
const os = require('node:os');

const { RedteamDb } = require('./core/redteam-db');
const { loadSkills } = require('./core/skills');
const { runPreflight } = require('./core/preflight');
const store = require('./core/store');

const PLUGIN_ID = 'guada-purge';
const VERSION = '2.1.0';

const KIT_ID = 'redteam';
const AGENT_ID = 'leader';
const AGENT_NAME = '红队指挥官';

/** 派活并发上限（对齐 dsh-purge 的"同一靶标最多 3 个执行智能体"） */
const SLOT_MAX = 3;
/** 占位租约：超时自动回收，避免子代理崩溃后名额不释放 */
const SLOT_TTL_MS = 30 * 60 * 1000;

/**
 * 执行角色（hidden：不出现在智能体列表/新建面板/@ 提及，只能被指挥官派活）。
 * skills 只列各自用得上的，省 token；工具不裁剪（对齐 dsh-purge：靠人设约束）。
 */
const ROLES = [
  {
    id: 'recon',
    name: '信息收集',
    description: '只收集资产并落库，不碰漏洞检测；重点边缘与未备案资产。',
    skills: ['recon-pipeline', 'fofa-recon', 'redteam-authorization'],
  },
  {
    id: 'assess',
    name: '资产梳理',
    description: '逐条评估资产易打性（priority/potential/reason），产出"先打谁"的排序。',
    skills: ['redteam-authorization'],
  },
  {
    id: 'vuln-scan',
    name: '漏洞发现',
    description: '先查库去重，Nday/1day 优先，再探接口未授权；每条漏洞附原始请求。',
    skills: ['nuclei-scan', 'recon-pipeline'],
  },
  {
    id: 'exploit',
    name: '漏洞利用',
    description: '拿服务器权限并实测 WebShell 可连，建隧道并实测内网可达。',
    skills: ['webshell-toolkit', 'credential-attack', 'redteam-authorization'],
  },
  {
    id: 'internal',
    name: '内网渗透',
    description: '走既有隧道做 gogo 铺面 + fscan 打点，迭代挖出所有网段。',
    skills: ['fscan-intranet'],
  },
];

const FALLBACK_PERSONA =
  '你是一名红队操作员，在已获授权的攻防演练中执行渗透任务。' +
  '开工前先预检环境（redteam_preflight），按信息收集 → 资产梳理 → 漏洞发现 → 漏洞利用 → 内网渗透推进；' +
  '所有资产/漏洞/证据必须落库，未核实的结论标记为 claimed。';

class GuadaPurgePlugin {
  constructor() {
    this.manifest = {
      id: PLUGIN_ID,
      name: 'GuaDa Purge',
      version: VERSION,
      description: '红队模式 —— 专属智能体 + 资产库 + 方法论技能（不修改宿主、不绕过安全策略）',
      author: 'donggua-zen',
      category: 'user',
      icon: 'assets/icon.svg',
    };

    this.api = null;
    this.pluginDir = null;
    this.dataDir = null;
    this.db = null;
    this.persona = '';
    this.skills = [];
    /** 角色 id → systemPrompt（presets/roles/<id>.md） */
    this.rolePrompts = {};
  }

  async onLoad(api) {
    this.api = api;
    this.pluginDir =
      typeof api.getPluginDir === 'function' ? api.getPluginDir() : undefined;
    this.dataDir =
      typeof api.getDataDir === 'function'
        ? api.getDataDir()
        : path.join(os.tmpdir(), PLUGIN_ID);

    store.ensureDir(this.dataDir);
    this.db = new RedteamDb(this.dataDir);
    this.reloadAll();

    this.registerCapabilityPack(api);
    this.registerAgent(api);
  }

  async onStart() {
    this.reloadAll();
    if (this.db) this.db.invalidate();
  }

  async onStop() {}

  async onUnload() {}

  reloadAll() {
    this.persona = this.loadPersona();
    this.skills = loadSkills(path.join(this.pluginDir || '', 'skills'));
    this.rolePrompts = {};
    for (const role of ROLES) {
      this.rolePrompts[role.id] = store.readText(
        path.join(this.pluginDir || '', 'presets', 'roles', `${role.id}.md`),
        '',
      );
    }
  }

  loadPersona() {
    const text = store.readText(
      path.join(this.pluginDir || '', 'presets', 'persona.md'),
      '',
    );
    return String(text || '').trim() || FALLBACK_PERSONA;
  }

  // ── 能力包 ──

  registerCapabilityPack(api) {
    if (typeof api.registerToolKit !== 'function') return;
    const plugin = this;
    api.registerToolKit({
      id: KIT_ID,
      name: '红队',
      description: '红队资产库与作战工具（仅本插件注册的智能体可用）',
      loadMode: 'eager',
      visibleTo: ['self'],
      onLoad(toolkit) {
        plugin.registerTools(toolkit);
        plugin.registerSkills(toolkit);
      },
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

  registerAgent(api) {
    if (typeof api.registerAgent !== 'function') return;

    // 指挥官：能派活（sub_agent 包 + 角色白名单），工具全量保留（靠人设约束只做读操作）
    api.registerAgent({
      id: AGENT_ID,
      name: AGENT_NAME,
      description:
        '攻防演练红队指挥官：计划任务、派活给执行角色、核对回报、向用户汇报。',
      avatar: 'assets/icon.svg',
      systemPrompt: this.persona,
      toolkits: [KIT_ID, 'sub_agent:subagent'],
      skills: this.skills.map((skill) => String(skill.name).toLowerCase()),
      agents: ROLES.map((role) => role.id),
      settings: { memory: { summaryMode: 'memory_sync' } },
    });

    // 执行角色：hidden（不出现在列表），只能被指挥官派活；不声明 agents（叶子节点）
    for (const role of ROLES) {
      const prompt =
        this.rolePrompts[role.id] ||
        `# 你的角色：${role.name}\n\n${role.description}\n\n你是叶子节点，不要再往下委派。所有产出必须落库。`;
      api.registerAgent({
        id: role.id,
        name: role.name,
        description: role.description,
        avatar: 'assets/icon.svg',
        systemPrompt: prompt,
        toolkits: [KIT_ID],
        skills: role.skills,
        hidden: true,
        settings: { memory: { summaryMode: 'memory_sync' } },
      });
    }
  }

  // ── 工具 ──

  registerTools(toolkit) {
    if (typeof toolkit.registerRawTool !== 'function') return;
    const plugin = this;
    const tool = (def) => toolkit.registerRawTool(def);

    /**
     * 当前会话绑定的演练
     *
     * 子代理由主会话派出（sessionType=sub_agent），派过去的执行角色拿不到
     * 自己的靶标绑定 → 回溯 parentSessionId，实现「靶标继承」。
     */
    const eng = (ctx) => {
      const sessionId = ctx?.session?.sessionId || null;
      const direct = plugin.db.engagementOfSession(sessionId);
      if (direct) return direct;

      const parentId = ctx?.session?.parentSessionId || null;
      if (parentId) {
        const inherited = plugin.db.engagementOfSession(parentId);
        if (inherited) return inherited;
      }

      throw new Error(
        '当前会话还没有绑定靶标。指挥官先调用 redteam_engagement_open({ name, scope }) 开靶；' +
          '执行角色无需自己开靶，会自动继承父会话的靶标。',
      );
    };
    const json = (value) => ({ content: JSON.stringify(value, null, 2) });

    // ── 演练 ──

    tool({
      name: 'redteam_engagement_open',
      description:
        '开靶：为当前会话登记本次演练的目标与授权范围，并绑定到本会话（不影响其它会话）。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '靶标单位/项目名称' },
          scope: { type: 'string', description: '授权范围（域名/IP/C 段/时间窗/禁止动作）' },
        },
        required: ['name'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        // 执行角色（子会话）不许自行开靶：靶标从父会话继承，避免同一个靶被拆成多个演练
        const parentId = ctx?.session?.parentSessionId || null;
        if (parentId) {
          const inherited = plugin.db.engagementOfSession(parentId);
          if (inherited) {
            return json({
              ...inherited,
              inherited: true,
              note: '执行角色自动继承父会话靶标，未新建演练',
            });
          }
          throw new Error(
            '执行角色不能自行开靶：请让指挥官先用 redteam_engagement_open 绑定靶标，再派活。',
          );
        }

        const row = plugin.db.openEngagement({
          name: args?.name,
          scope: args?.scope,
          sessionId: ctx?.session?.sessionId || null,
        });
        return json(row);
      },
    });

    tool({
      name: 'redteam_session_bind',
      description: '把已有演练重新绑定到当前会话（切换目标时用）。',
      parameters: {
        type: 'object',
        properties: {
          engagementId: { type: 'string', description: '演练 id（ENG-xxx）' },
        },
        required: ['engagementId'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) =>
        json(plugin.db.bindSession(args?.engagementId, ctx?.session?.sessionId || null)),
    });

    tool({
      name: 'redteam_session_info',
      description: '查看当前会话绑定的是哪个靶标，以及该演练的资产/漏洞/证据统计。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => {
        const current = eng(ctx);
        return json({
          engagement: current,
          assets: plugin.db.assetStats(current.id),
          vulns: plugin.db.queryVulns(current.id).length,
          evidence: {
            total: plugin.db.listEvidence(current.id).length,
            unverified: plugin.db.unverifiedCount(current.id),
          },
          webshells: plugin.db.listWebshells(current.id).length,
          tunnels: plugin.db.listTunnels(current.id).length,
          credentials: plugin.db.listCredentials(current.id).length,
          scores: plugin.db.listScores(current.id).length,
        });
      },
    });

    tool({
      name: 'redteam_preflight',
      description:
        '开工前环境预检：检查 FOFA_KEY / VPS_IP 等环境变量与 fscan/gogo/nuclei/nmap/suo5/frpc 是否可用，返回缺失项与降级建议。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async () => json(runPreflight()),
    });

    tool({
      name: 'redteam_agent_slot',
      description:
        `派活并发闸门（同一靶标最多 ${SLOT_MAX} 个执行角色）。` +
        'status 查看占用；acquire 派活前占位（role 必填，被拒不重试）；release 释放（role 或当前会话）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status', 'acquire', 'release'] },
          role: { type: 'string', description: '执行角色 id：recon/assess/vuln-scan/exploit/internal' },
        },
        required: ['action'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        const current = eng(ctx);
        const action = String(args?.action || 'status');
        const sessionId = ctx?.session?.sessionId || null;

        if (action === 'status') {
          const slots = plugin.db.listSlots(current.id, SLOT_TTL_MS);
          return json({ max: SLOT_MAX, used: slots.length, slots });
        }
        if (action === 'acquire') {
          const result = plugin.db.acquireSlot({
            eng: current.id,
            role: args?.role,
            sessionId,
            max: SLOT_MAX,
            ttlMs: SLOT_TTL_MS,
          });
          return json(result);
        }
        if (action === 'release') {
          return json(
            plugin.db.releaseSlot({
              eng: current.id,
              role: args?.role,
              sessionId: args?.role ? undefined : sessionId,
            }),
          );
        }
        throw new Error(`未知 action: ${action}（只支持 status / acquire / release）`);
      },
    });

    // ── 资产 ──

    tool({
      name: 'redteam_asset_add',
      description: '登记一条资产（域名/IP/URL/端口服务）。信息收集阶段的产出都落这里。',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['domain', 'host', 'url', 'service', 'segment'],
            description: '资产类型，默认 host',
          },
          value: { type: 'string', description: '资产值（域名 / URL / IP）' },
          ip: { type: 'string', description: '解析到的 IP（可选）' },
          port: { type: 'number', description: '端口（可选）' },
          title: { type: 'string', description: '资产标题/系统名' },
          surface: { type: 'string', description: '暴露面描述（中间件/框架/指纹）' },
          source: { type: 'string', description: '来源（fofa / crt.sh / 主动探测）' },
        },
        required: ['value'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        const current = eng(ctx);
        return json(plugin.db.addAsset({ ...args, eng: current.id }));
      },
    });

    tool({
      name: 'redteam_asset_query',
      description: '查询资产（可按类型/易打性/关键字过滤）。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'domain/host/url/service/segment' },
          priority: { type: 'string', description: 'high/medium/low/unknown' },
          contains: { type: 'string', description: '值/标题/IP 包含该关键字' },
          limit: { type: 'number', description: '最多返回条数' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => json(plugin.db.listAssets(eng(ctx).id, args || {})),
    });

    tool({
      name: 'redteam_asset_stats',
      description: '资产统计：总数、按类型、按易打性分布。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.assetStats(eng(ctx).id)),
    });

    tool({
      name: 'redteam_asset_assess',
      description: '资产梳理：给资产打易打性（priority/potential/reason），决定先打谁。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string', description: '资产 id（A1/A2…）' },
          priority: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] },
          potential: { type: 'number', description: '易打性打分 0-100' },
          reason: { type: 'string', description: '判断依据（暴露面/版本/弱口令迹象等）' },
        },
        required: ['assetId'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        const current = eng(ctx);
        const row = plugin.db.assessAsset(args?.assetId, args || {});
        if (row.eng !== current.id) throw new Error('该资产不属于当前靶标');
        return json(row);
      },
    });

    // ── 漏洞 ──

    tool({
      name: 'redteam_vuln_add',
      description:
        '登记一条漏洞。必须附原始请求/响应，否则报告无法复现。落库前先 redteam_vuln_query 查重。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string', description: '关联资产 id' },
          title: { type: 'string', description: '漏洞标题' },
          level: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low', 'info'],
            description: '危害等级',
          },
          request: { type: 'string', description: '原始请求（HTTP / 命令）' },
          response: { type: 'string', description: '关键响应片段' },
        },
        required: ['title'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        const current = eng(ctx);
        return json(plugin.db.addVuln({ ...args, eng: current.id }));
      },
    });

    tool({
      name: 'redteam_vuln_query',
      description: '查询漏洞（按资产/等级/状态过滤）。开工前先查库，避免重复劳动。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          level: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => json(plugin.db.queryVulns(eng(ctx).id, args || {})),
    });

    // ── 证据 ──

    tool({
      name: 'redteam_evidence_record',
      description:
        '记录一条证据，confidence 默认 claimed（待核实）。核实后必须用 redteam_evidence_upgrade 升级。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['fact', 'derived', 'inferred'], description: '证据性质' },
          assetId: { type: 'string', description: '关联资产' },
          summary: { type: 'string', description: '一句话结论' },
          confidence: { type: 'string', enum: ['claimed', 'inferred', 'derived'], description: '默认 claimed' },
        },
        required: ['summary'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        const current = eng(ctx);
        return json(plugin.db.recordEvidence({ ...args, eng: current.id }));
      },
    });

    tool({
      name: 'redteam_evidence_list',
      description: '列出证据（可按 confidence/资产过滤）。',
      parameters: {
        type: 'object',
        properties: {
          confidence: { type: 'string', description: 'claimed/inferred/derived/observed' },
          assetId: { type: 'string' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => json(plugin.db.listEvidence(eng(ctx).id, args || {})),
    });

    tool({
      name: 'redteam_evidence_upgrade',
      description:
        '把 claimed 证据升级为 observed（必须已亲自核实：curl 实测 / 浏览器登录 / 原始请求）。',
      parameters: {
        type: 'object',
        properties: {
          evidenceId: { type: 'string', description: '证据 id（E1/E2…）' },
          verifiedResult: { type: 'string', description: '核实方式与结果' },
        },
        required: ['evidenceId', 'verifiedResult'],
      },
      dangerLevel: 'normal',
      handler: async (args) =>
        json(plugin.db.upgradeEvidence(args?.evidenceId, args?.verifiedResult)),
    });

    tool({
      name: 'redteam_unverified_count',
      description: '统计还有多少条 claimed 未核实。>0 时汇报必须提醒用户。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json({ unverified: plugin.db.unverifiedCount(eng(ctx).id) }),
    });

    // ── 入口 ──

    tool({
      name: 'redteam_webshell_add',
      description: '登记 WebShell 入口（必须实测能连上才算入口，登记后仍为未核实）。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          url: { type: 'string', description: 'WebShell 地址（含参数）' },
          type: { type: 'string', description: 'behinder/godzilla/其他' },
        },
        required: ['url'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.addWebshell({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_webshell_list',
      description: '列出已登记的 WebShell。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.listWebshells(eng(ctx).id)),
    });

    tool({
      name: 'redteam_tunnel_add',
      description:
        '登记隧道。必须写清目标侧入口类型（entry_kind）——自己 VPS 上开的代理不算隧道。',
      parameters: {
        type: 'object',
        properties: {
          entryKind: { type: 'string', description: '目标侧入口（webshell/suo5/frp/vpn…）' },
          listen: { type: 'string', description: '本地监听地址，如 socks5://127.0.0.1:1080' },
          reachable: { type: 'string', description: '实测可达的内网网段' },
        },
        required: ['listen'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.addTunnel({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_tunnel_list',
      description: '列出已登记隧道。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.listTunnels(eng(ctx).id)),
    });

    tool({
      name: 'redteam_credential_add',
      description:
        '登记凭据。只有凭据不算账号权限：必须浏览器实测登录成功后再升级（loginVerified）。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          username: { type: 'string' },
          secretMasked: { type: 'string', description: '脱敏后的口令/哈希' },
        },
        required: ['username'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.addCredential({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_credential_list',
      description: '列出已登记凭据（口令已脱敏）。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.listCredentials(eng(ctx).id)),
    });

    // ── 评分 ──

    tool({
      name: 'redteam_score_hit',
      description: '登记一个得分点（拿到分才记；报告只收录拿到分的成果）。',
      parameters: {
        type: 'object',
        properties: {
          point: { type: 'string', description: '得分点名称' },
          note: { type: 'string', description: '怎么拿到的（命令/入口）' },
        },
        required: ['point'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.hitScore({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_score_list',
      description: '列出已拿到的得分点。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.listScores(eng(ctx).id)),
    });
  }
}

module.exports = GuadaPurgePlugin;
module.exports.default = GuadaPurgePlugin;
