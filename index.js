'use strict';

/**
 * GuaDa Purge v2 —— 红队模式（PluginApi v4）
 *
 * 形态：能力包 + 专属智能体（指挥官 + 5 个隐藏执行角色）。
 *
 *   能力包 `redteam`（visibleTo: ["self"]）
 *     ├─ 资产库/作战工具（engagement / asset / vuln / evidence / webshell / tunnel /
 *     │   credential / score / chain / report / poc …）
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
const { buildReport, buildTargets } = require('./core/report');
const { probe } = require('./core/probe');
const store = require('./core/store');

const PLUGIN_ID = 'guada-purge';
const VERSION = '2.5.0';

const KIT_ID = 'redteam';
const AGENT_ID = 'leader';
const AGENT_NAME = '红队指挥官';

/** 派活并发上限（同一靶标最多 3 个执行智能体） */
const SLOT_MAX = 3;
/** 占位租约：超时自动回收，避免子代理崩溃后名额不释放 */
const SLOT_TTL_MS = 30 * 60 * 1000;

/**
 * 执行角色（hidden：不出现在智能体列表/新建面板/@ 提及，只能被指挥官派活）。
 * skills 只列各自用得上的，省 token；工具不强裁剪（靠人设约束分工）。
 */
const ROLES = [
  {
    id: 'recon',
    name: '信息收集',
    description: '只收集资产并落库，不碰漏洞检测；重点边缘与未备案资产。',
    skills: [
      'recon-pipeline',
      'fofa-recon',
      'passive-recon',
      'web-fingerprint',
      'active-scan',
      'asset-correlation',
      'redteam-authorization',
    ],
  },
  {
    id: 'assess',
    name: '资产梳理',
    description: '逐条评估资产易打性（priority/potential/reason），产出"先打谁"的排序。',
    skills: ['asset-correlation', 'web-fingerprint', 'redteam-authorization'],
  },
  {
    id: 'vuln-scan',
    name: '漏洞发现',
    description: '先查库去重，Nday/1day 优先，再探接口未授权；每条漏洞附原始请求。',
    skills: ['nuclei-scan', 'recon-pipeline', 'dir-bruteforce', 'unauth-exploit', 'web-fingerprint'],
  },
  {
    id: 'exploit',
    name: '漏洞利用',
    description: '拿服务器权限并实测 WebShell 可连，建隧道并实测内网可达。',
    skills: [
      'webshell-toolkit',
      'credential-attack',
      'unauth-exploit',
      'shell-handler',
      'browser-automation',
      'suo5-tunnel',
      'chisel-tunnel',
      'frp-tunnel',
      'vps-reverse-shell',
      'redteam-authorization',
    ],
  },
  {
    id: 'internal',
    name: '内网渗透',
    description: '走既有隧道做 gogo 铺面 + fscan 打点，迭代挖出所有网段。',
    skills: ['fscan-intranet', 'gogo-intranet', 'lateral-movement', 'redteam-setup'],
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

    // ── 攻击链 ──

    tool({
      name: 'redteam_chain_add',
      description:
        '记录一个攻击链步骤。报告里「这一步怎么来的」完全靠这条记录：' +
        'tool 写实际命令原文、result 写实际回显、detail 写依据。' +
        '带 pointCode + evidence 时会自动记一次分。',
      parameters: {
        type: 'object',
        properties: {
          stageCode: {
            type: 'string',
            enum: ['recon', 'internet', 'boundary', 'internal', 'target'],
            description: '作战阶段：信息收集/互联网权限/边界突破/内网权限/靶标系统',
          },
          stage: {
            type: 'string',
            enum: ['recon', 'vuln', 'exploit', 'access', 'pivot', 'data', 'other'],
            description: '动作类型（兼容字段，阶段归属优先用 stageCode）',
          },
          title: { type: 'string', description: '一句话说明这一步做了什么' },
          detail: { type: 'string', description: '为什么这么做、线索从哪来' },
          tool: { type: 'string', description: '实际执行的命令原文（报告复现的关键）' },
          result: { type: 'string', description: '实际回显/结果摘要（报告复现的关键）' },
          assetId: { type: 'string', description: '关联资产 id' },
          vulnId: { type: 'string', description: '关联漏洞 id' },
          accessId: { type: 'string', description: '关联入口 id（webshell/tunnel）' },
          pointCode: { type: 'string', description: '拿了分才填：得分点 code（如 rce/webshell/boundary）' },
          evidence: { type: 'string', description: '配合 pointCode：这一分拿到了什么（不填不记分）' },
          selfCreated: { type: 'boolean', description: '账号/权限是自己注册或自建的吗' },
        },
        required: ['title'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        const current = eng(ctx);
        return json(plugin.db.addChain({ ...args, eng: current.id }));
      },
    });

    tool({
      name: 'redteam_attack_chain',
      description: '列出攻击链步骤（按 seq 排序，可按阶段过滤）。',
      parameters: {
        type: 'object',
        properties: {
          stageCode: { type: 'string', description: '只看某个阶段' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => json(plugin.db.listChains(eng(ctx).id, args || {})),
    });

    tool({
      name: 'redteam_attack_path',
      description: '按资产看攻击路径：该资产上走过的链步骤 + 关联漏洞 + 得分点。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string', description: '资产 id；省略则返回全部资产的分组概览' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => {
        const current = eng(ctx);
        const chains = plugin.db.listChains(current.id);
        const vulns = plugin.db.queryVulns(current.id);
        if (args?.assetId) {
          const id = String(args.assetId);
          return json({
            assetId: id,
            chains: chains.filter((c) => c.assetId === id),
            vulns: vulns.filter((v) => v.assetId === id),
          });
        }
        const ids = new Set([...chains.map((c) => c.assetId), ...vulns.map((v) => v.assetId)].filter(Boolean));
        return json(
          Array.from(ids).map((id) => ({
            assetId: id,
            chains: chains.filter((c) => c.assetId === id).length,
            vulns: vulns.filter((v) => v.assetId === id).length,
            points: chains.filter((c) => c.assetId === id && c.pointCode).map((c) => c.pointCode),
          })),
        );
      },
    });

    tool({
      name: 'redteam_chain',
      description: '（兼容别名）同 redteam_attack_chain。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.listChains(eng(ctx).id)),
    });

    tool({
      name: 'redteam_attack_file_add',
      description: '登记一个攻击文件/产出（报告、脚本、导出、dump）。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件名/标题' },
          kind: { type: 'string', enum: ['report', 'script', 'dump', 'screenshot', 'other'] },
          path: { type: 'string', description: '路径或引用' },
          note: { type: 'string', description: '说明' },
        },
        required: ['name'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.addAttackFile({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_attack_file_list',
      description: '列出攻击文件/产出。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.listAttackFiles(eng(ctx).id)),
    });

    // ── 报告 ──

    tool({
      name: 'redteam_score_point_save',
      description: '自定义得分点分值（覆盖内置表）。内置：rce 50 / webshell 30 / boundary 40 / internal-pivot 40 / web-account-admin 20 / web-account-user 10 / db-access 20 / sensitive-data 20 / core-system 60。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '得分点 code' },
          name: { type: 'string', description: '显示名' },
          points: { type: 'number', description: '分值' },
        },
        required: ['code'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) =>
        json(plugin.db.saveScorePoint({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_score_report',
      description:
        '生成演练报告（Markdown）。只收录有证据/已拿分的成果；' +
        '含概览、得分明细、攻击链、成果漏洞（附原始请求）、入口与凭据、内网、未决事项、修复建议。',
      parameters: {
        type: 'object',
        properties: {
          markdown: { type: 'boolean', description: 'true（默认）= 返回 markdown 全文；false = 只返回摘要' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => {
        const current = eng(ctx);
        const result = buildReport(plugin.db, current);
        if (args?.markdown === false) {
          return json({ ok: true, engagement: current.id, summary: result.summary });
        }
        return json({ ok: true, engagement: current.id, summary: result.summary, markdown: result.markdown });
      },
    });

    tool({
      name: 'redteam_report',
      description: '（已弃用，改用 redteam_score_report）生成成果报告，等价于 score_report。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => {
        const current = eng(ctx);
        const result = buildReport(plugin.db, current);
        return json({ ok: true, engagement: current.id, deprecated: true, summary: result.summary, markdown: result.markdown });
      },
    });

    tool({
      name: 'redteam_report_targets',
      description: '按资产汇总成果（漏洞数/链步骤数/等级分布），用于看"哪个目标还缺什么"。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(buildTargets(plugin.db, eng(ctx))),
    });

    // ── 未知资产 ──

    tool({
      name: 'redteam_unknown_record',
      description: '登记一条"看到了但说不清是什么"的资产，先挂着不丢，后续再解决。',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string', description: '看到了什么（URL/IP/指纹/报错）' },
          note: { type: 'string', description: '为什么拿不准' },
        },
        required: ['value'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.recordUnknown({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_unknown_list',
      description: '列出未知资产（默认只看未解决的）。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'resolved'], description: '默认 open' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) =>
        json(plugin.db.listUnknowns(eng(ctx).id, { status: args?.status || 'open' })),
    });

    tool({
      name: 'redteam_unknown_resolve',
      description: '解决一条未知资产：说明它最终被判定为什么。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '未知资产 id（U...）' },
          resolvedAs: { type: 'string', description: '最终结论（是哪个系统的什么）' },
        },
        required: ['id'],
      },
      dangerLevel: 'normal',
      handler: async (args) => json(plugin.db.resolveUnknown(args?.id, args?.resolvedAs)),
    });

    // ── 资产深挖（P3-2） ──

    tool({
      name: 'redteam_asset_get',
      description: '单资产详情：本体 + 关联漏洞/证据/链步骤/入口/凭据/关系。',
      parameters: {
        type: 'object',
        properties: { assetId: { type: 'string', description: '资产 id（A1/A2…）' } },
        required: ['assetId'],
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => {
        const detail = plugin.db.assetDetail(eng(ctx).id, String(args?.assetId));
        if (!detail) throw new Error(`资产不存在: ${args?.assetId}`);
        return json(detail);
      },
    });

    tool({
      name: 'redteam_asset_link',
      description: '建立资产关系（父域→子域、主机→服务、资产→跳板等），用于图谱与报告。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '源资产 id' },
          to: { type: 'string', description: '目标资产 id' },
          kind: {
            type: 'string',
            description: '关系类型：subdomain / resolves-to / hosts / pivot / related',
          },
          note: { type: 'string', description: '说明' },
        },
        required: ['from', 'to'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) =>
        json(plugin.db.linkAssets({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_asset_graph',
      description: '资产图谱：节点（资产）+ 边（关系）。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => {
        const current = eng(ctx);
        const assets = plugin.db.listAssets(current.id);
        return json({
          nodes: assets.map((a) => ({
            id: a.id,
            label: a.value,
            kind: a.kind,
            priority: a.priority,
          })),
          edges: plugin.db.listLinks(current.id),
        });
      },
    });

    tool({
      name: 'redteam_asset_timeline',
      description: '资产/漏洞/证据/链步骤的时间线（按时间正序），可限定单个资产。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string', description: '只看某个资产；省略则看全部' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) =>
        json(plugin.db.timeline(eng(ctx).id, args?.assetId || null)),
    });

    tool({
      name: 'redteam_asset_test',
      description:
        '连通性探测：对资产发一次 HEAD（失败回退 GET），返回状态码/标题/指纹/耗时。' +
        '用于确认"这个资产还活着吗"。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string', description: '资产 id；与 target 二选一' },
          target: { type: 'string', description: '直接给 URL 或 host:port' },
          timeoutMs: { type: 'number', description: '超时毫秒，默认 5000' },
          capture: { type: 'boolean', description: 'true = 把探测到的指纹写回资产的 surface' },
        },
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        const current = eng(ctx);
        let target = args?.target;
        if (!target && args?.assetId) {
          const detail = plugin.db.assetDetail(current.id, String(args.assetId));
          if (!detail) throw new Error(`资产不存在: ${args.assetId}`);
          const a = detail.asset;
          target = a.ip && a.port ? `${a.ip}:${a.port}` : a.value;
        }
        if (!target) throw new Error('需要 assetId 或 target');

        const result = await probe(target, { timeoutMs: args?.timeoutMs });
        if (args?.capture && args?.assetId && result.ok) {
          const surface = [result.server, result.title].filter(Boolean).join(' ');
          if (surface) plugin.db.assessAsset(String(args.assetId), { reason: `指纹：${surface}` });
        }
        return json(result);
      },
    });

    // ── 状态流转（P3-2） ──

    tool({
      name: 'redteam_vuln_update',
      description: '更新漏洞：状态流转（found → confirmed → exploited / false-positive）、等级、标题、原始请求。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '漏洞 id（V1…）' },
          status: {
            type: 'string',
            enum: ['found', 'confirmed', 'exploited', 'false-positive', 'needs-auth', 'blocked'],
          },
          level: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          title: { type: 'string' },
          request: { type: 'string' },
          response: { type: 'string' },
        },
        required: ['id'],
      },
      dangerLevel: 'normal',
      handler: async (args) => {
        const { id, ...patch } = args || {};
        return json(plugin.db.updateVuln(String(id), patch));
      },
    });

    tool({
      name: 'redteam_webshell_update',
      description: '更新 WebShell：标记是否已实测连通、改地址或类型。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          url: { type: 'string' },
          type: { type: 'string' },
          verified: { type: 'boolean', description: 'true = 已实测能执行命令' },
        },
        required: ['id'],
      },
      dangerLevel: 'normal',
      handler: async (args) => {
        const { id, ...patch } = args || {};
        return json(plugin.db.updateWebshell(String(id), patch));
      },
    });

    tool({
      name: 'redteam_tunnel_update',
      description: '更新隧道：标记是否已实测可达、改监听地址/入口类型/可达网段。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          listen: { type: 'string' },
          reachable: { type: 'string' },
          entryKind: { type: 'string' },
          verified: { type: 'boolean' },
        },
        required: ['id'],
      },
      dangerLevel: 'normal',
      handler: async (args) => {
        const { id, ...patch } = args || {};
        return json(plugin.db.updateTunnel(String(id), patch));
      },
    });

    // ── 证据补充（P3-2） ──

    tool({
      name: 'redteam_evidence_verify',
      description:
        '复现/核实一条证据：给出 URL 时实际发请求比对，把证据升级为 observed 并记录核实方式。',
      parameters: {
        type: 'object',
        properties: {
          evidenceId: { type: 'string', description: '证据 id（E1…）' },
          url: { type: 'string', description: '要复现的目标（省略则用证据里记录的 url）' },
          method: { type: 'string', description: '核实方式说明（如 curl 实测登录）' },
        },
        required: ['evidenceId'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => {
        const current = eng(ctx);
        const rows = plugin.db.listEvidence(current.id);
        const ev = rows.find((e) => e.id === String(args?.evidenceId));
        if (!ev) throw new Error(`证据不存在: ${args?.evidenceId}`);

        const target = args?.url || ev.url;
        const detail = args?.method ? String(args.method) : '人工核实';

        if (!target) {
          return json(plugin.db.upgradeEvidence(ev.id, detail));
        }
        const result = await probe(target, { timeoutMs: 5000 });
        const summary = result.ok
          ? `${detail}｜复现 ${target} → ${result.status}${result.title ? `「${result.title}」` : ''}`
          : `${detail}｜复现失败 ${target}：${result.error}`;
        return json({
          probe: result,
          evidence: result.ok ? plugin.db.upgradeEvidence(ev.id, summary) : ev,
        });
      },
    });

    tool({
      name: 'redteam_http_evidence_add',
      description: '归档一条原始 HTTP 报文（请求+响应），作为漏洞复现证据（直接记为 observed）。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '请求地址' },
          request: { type: 'string', description: '原始请求' },
          response: { type: 'string', description: '关键响应' },
          assetId: { type: 'string', description: '关联资产' },
          vulnId: { type: 'string', description: '关联漏洞' },
          summary: { type: 'string', description: '一句话说明' },
        },
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) =>
        json(plugin.db.addHttpEvidence({ ...args, eng: eng(ctx).id })),
    });

    // ── 截图（P3-2） ──

    tool({
      name: 'redteam_shot_add',
      description: '登记一张截图（路径 + 关联资产/漏洞），报告引用时用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '截图路径或引用' },
          assetId: { type: 'string' },
          vulnId: { type: 'string' },
          note: { type: 'string', description: '截图内容说明' },
        },
        required: ['path'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.addShot({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_shot_list',
      description: '列出已登记的截图。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.listShots(eng(ctx).id)),
    });

    tool({
      name: 'redteam_shot_delete',
      description: '删除一条截图登记（不删磁盘文件）。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      dangerLevel: 'normal',
      handler: async (args) => json(plugin.db.deleteShot(String(args?.id))),
    });

    // ── 访问会话 / 索引（P3-4） ──

    tool({
      name: 'redteam_access_add',
      description:
        '记录一次成功获得的访问会话（横向移动起点）：host + method（rdp/ssh/web-shell/db/vnc）+ 权限级别。',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: '目标主机' },
          method: { type: 'string', description: '获得访问的方式：rdp/ssh/web-shell/db/vnc/web-account' },
          username: { type: 'string' },
          privilege: { type: 'string', description: 'admin/user/system/root' },
          assetId: { type: 'string' },
          sessionRef: { type: 'string', description: '会话/证据引用（文件或链接）' },
          note: { type: 'string' },
        },
        required: ['host', 'method'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.addAccess({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_access_list',
      description: '列出已获得的访问会话。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.listAccesses(eng(ctx).id)),
    });

    tool({
      name: 'redteam_sessions',
      description: '列出全部演练（跨会话视图）：目标、绑定会话、资产/漏洞/链步骤/得分数量。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async () => json(plugin.db.listEngagements()),
    });

    tool({
      name: 'redteam_session_check',
      description: '检查当前会话的靶标绑定状态：直接绑定 / 从父会话继承 / 未绑定。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => {
        const sessionId = ctx?.session?.sessionId || null;
        const parentId = ctx?.session?.parentSessionId || null;
        const direct = plugin.db.engagementOfSession(sessionId);
        const inherited = parentId ? plugin.db.engagementOfSession(parentId) : null;
        return json({
          sessionId,
          parentSessionId: parentId,
          sessionType: ctx?.session?.sessionType || 'unknown',
          agentId: ctx?.session?.agentId || null,
          bound: direct || inherited || null,
          source: direct ? 'direct' : inherited ? 'inherited' : 'none',
        });
      },
    });

    tool({
      name: 'redteam_web_list',
      description: '列出 Web 资产（URL / web 端口服务），做 Web 渗透前先看这里。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: '最多返回条数' } },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args, ctx) => json(plugin.db.listWeb(eng(ctx).id, args?.limit)),
    });

    tool({
      name: 'redteam_domain_index',
      description: '按主域聚合资产：每个主域关联了哪些子域与 IP。',
      parameters: { type: 'object', properties: {} },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (_args, ctx) => json(plugin.db.domainIndex(eng(ctx).id)),
    });

    // ── PoC 知识库（P3-3） ──

    tool({
      name: 'redteam_poc_add',
      description:
        '把验证有效的 PoC/EXP 存进知识库（code 唯一）。' +
        'kind=request（HTTP 报文）/ script（脚本）/ nuclei（模板路径）；带 component+cve 便于下次检索。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '唯一短码，如 thinkphp-5-rce' },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['request', 'script', 'nuclei'] },
          category: { type: 'string', description: '分类，如 rce / unauth / lfi / sqli' },
          cve: { type: 'string' },
          component: { type: 'string', description: '受影响组件，如 ThinkPHP 5.0.x' },
          versions: { type: 'string' },
          language: { type: 'string', description: '脚本语言（script 类型时）' },
          source: { type: 'string', description: '来源：manual/exploitdb/github' },
          sourceUrl: { type: 'string' },
          content: { type: 'string', description: '正文：原始请求 / 脚本 / 模板路径' },
          tags: { type: 'string', description: '逗号分隔' },
          verified: { type: 'boolean', description: '是否已实战验证' },
          verifiedNote: { type: 'string', description: '验证说明（在哪个靶标/资产上成功）' },
        },
        required: ['code'],
      },
      dangerLevel: 'normal',
      handler: async (args, ctx) => json(plugin.db.addPoc({ ...args, eng: eng(ctx).id })),
    });

    tool({
      name: 'redteam_poc_list',
      description: '列出 PoC 知识库（不含正文，按复用次数排序）。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'request/script/nuclei' },
          category: { type: 'string' },
          component: { type: 'string', description: '组件名包含' },
          cve: { type: 'string', description: 'CVE 包含' },
          verifiedOnly: { type: 'boolean' },
        },
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args) => json(plugin.db.listPocs(args || {})),
    });

    tool({
      name: 'redteam_poc_search',
      description: '按关键字搜索 PoC（标题/组件/CVE/标签/正文）。',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string' } },
        required: ['keyword'],
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args) => json(plugin.db.searchPocs(args?.keyword)),
    });

    tool({
      name: 'redteam_poc_get',
      description: '取 PoC 全文（按 id 或 code）。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'PoC id（POC-…）或 code' } },
        required: ['id'],
      },
      dangerLevel: 'safe',
      readOnly: true,
      handler: async (args) => {
        const row = plugin.db.getPoc(args?.id);
        if (!row) throw new Error(`PoC 不存在: ${args?.id}`);
        return json(row);
      },
    });

    tool({
      name: 'redteam_poc_update',
      description: '更新 PoC（改正文/组件/验证状态等）。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'PoC id 或 code' },
          title: { type: 'string' },
          content: { type: 'string' },
          component: { type: 'string' },
          cve: { type: 'string' },
          verified: { type: 'boolean' },
          verifiedNote: { type: 'string' },
          tags: { type: 'string' },
        },
        required: ['id'],
      },
      dangerLevel: 'normal',
      handler: async (args) => {
        const { id, ...patch } = args || {};
        return json(plugin.db.updatePoc(String(id), patch));
      },
    });

    tool({
      name: 'redteam_poc_use',
      description: '记一次 PoC 复用（命中次数 +1），高复用条目会排在列表前面。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'PoC id 或 code' },
          note: { type: 'string', description: '用在哪（靶标/资产/结果）' },
        },
        required: ['id'],
      },
      dangerLevel: 'normal',
      handler: async (args) => json(plugin.db.usePoc(String(args?.id), args?.note)),
    });
  }
}

module.exports = GuadaPurgePlugin;
module.exports.default = GuadaPurgePlugin;
