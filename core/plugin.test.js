'use strict';

/**
 * 注册结构与红队契约测试
 *
 * 钉死的不是覆盖率，而是：
 * - 能力整包收口（visibleTo: self），不污染其它智能体
 * - 工具全集齐备且命名与 dsh-purge 对齐
 * - 所有写操作都要求先开靶（未绑定时给出可执行提示）
 * - 证据链 claimed → observed 只能单向升级
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GuadaPurgePlugin = require('../index');

function makeApi(dataDir) {
  const calls = { kits: [], agents: [], sections: [], globals: [] };
  const handle = {
    id: null,
    name: null,
    tools: [],
    skills: [],
    registerRawTool(def) {
      this.tools.push(def);
    },
    registerSkill(def) {
      this.skills.push(def);
    },
  };

  const api = {
    calls,
    handle,
    getDataDir: () => dataDir,
    getPluginDir: () => path.join(__dirname, '..'),
    registerToolKit(def) {
      calls.kits.push(def);
      handle.id = def.id;
      handle.name = def.name;
      if (typeof def.onLoad === 'function') def.onLoad(handle);
      return handle;
    },
    registerAgent(def) {
      calls.agents.push(def);
    },
    registerPromptSection(def) {
      calls.sections.push(def);
    },
    // v2 起不应再出现的全局注册
    registerTool(def) {
      calls.globals.push(['registerTool', def]);
    },
    registerSkill(def) {
      calls.globals.push(['registerSkill', def]);
    },
    registerSlot(def) {
      calls.globals.push(['registerSlot', def]);
    },
    registerRpc(def) {
      calls.globals.push(['registerRpc', def]);
    },
    registerNls(locale) {
      calls.globals.push(['registerNls', locale]);
    },
  };
  return api;
}

async function withPlugin(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-purge-rt-'));
  try {
    const plugin = new GuadaPurgePlugin();
    const api = makeApi(dataDir);
    await plugin.onLoad(api);
    return await fn({ plugin, api, dataDir });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const ctx = () => ({ session: { sessionId: 'session-test' } });
const toolNamed = (api, name) => api.handle.tools.find((t) => t.name === name);

test('只注册一个能力包 + 1 个指挥官 + 5 个隐藏角色，无全局注册', async () => {
  await withPlugin(async ({ api }) => {
    assert.equal(api.calls.kits.length, 1);
    assert.equal(api.calls.agents.length, 6);
    assert.deepEqual(api.calls.globals, []);
    assert.deepEqual(api.calls.kits[0].visibleTo, ['self']);
    assert.equal(api.calls.kits[0].id, 'redteam');
    assert.equal(api.calls.kits[0].loadMode, 'eager');

    const leader = api.calls.agents.find((a) => a.id === 'leader');
    const roles = api.calls.agents.filter((a) => a.id !== 'leader');
    assert.ok(leader);
    assert.notEqual(leader.hidden, true, '指挥官必须可见');
    assert.deepEqual(
      roles.map((r) => r.id).sort(),
      ['assess', 'exploit', 'internal', 'recon', 'vuln-scan'],
    );
    for (const role of roles) {
      assert.equal(role.hidden, true, `${role.id} 必须是 hidden`);
      // 叶子节点：不声明 agents（不能派活）
      assert.equal(role.agents, undefined, `${role.id} 不应能派活`);
    }
  });
});

test('工具全集与 dsh-purge 命名对齐', async () => {
  await withPlugin(async ({ api }) => {
    const names = api.handle.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'redteam_agent_slot',
      'redteam_asset_add',
      'redteam_asset_assess',
      'redteam_asset_get',
      'redteam_asset_graph',
      'redteam_asset_link',
      'redteam_asset_query',
      'redteam_asset_stats',
      'redteam_asset_test',
      'redteam_asset_timeline',
      'redteam_attack_chain',
      'redteam_attack_file_add',
      'redteam_attack_file_list',
      'redteam_attack_path',
      'redteam_chain',
      'redteam_chain_add',
      'redteam_credential_add',
      'redteam_credential_list',
      'redteam_engagement_open',
      'redteam_evidence_list',
      'redteam_evidence_record',
      'redteam_evidence_upgrade',
      'redteam_evidence_verify',
      'redteam_http_evidence_add',
      'redteam_preflight',
      'redteam_report',
      'redteam_report_targets',
      'redteam_score_hit',
      'redteam_score_list',
      'redteam_score_point_save',
      'redteam_score_report',
      'redteam_session_bind',
      'redteam_session_info',
      'redteam_shot_add',
      'redteam_shot_delete',
      'redteam_shot_list',
      'redteam_tunnel_add',
      'redteam_tunnel_list',
      'redteam_tunnel_update',
      'redteam_unknown_list',
      'redteam_unknown_record',
      'redteam_unknown_resolve',
      'redteam_unverified_count',
      'redteam_vuln_add',
      'redteam_vuln_query',
      'redteam_vuln_update',
      'redteam_webshell_add',
      'redteam_webshell_list',
      'redteam_webshell_update',
    ]);
  });
});

test('只读工具声明 readOnly，写工具不声明', async () => {
  await withPlugin(async ({ api }) => {
    const readOnly = ['redteam_preflight', 'redteam_asset_query', 'redteam_vuln_query', 'redteam_score_list'];
    for (const name of readOnly) {
      assert.equal(toolNamed(api, name).readOnly, true, `${name} 应只读`);
    }
    assert.notEqual(toolNamed(api, 'redteam_asset_add').readOnly, true);
  });
});

test('未开靶时写操作给出可执行提示', async () => {
  await withPlugin(async ({ api }) => {
    const tool = toolNamed(api, 'redteam_asset_add');
    await assert.rejects(
      () => Promise.resolve(tool.handler({ value: '1.1.1.1' }, ctx())),
      /先调用 redteam_engagement_open/,
    );
  });
});

test('开靶 → 资产 → 漏洞 → 证据 → 评分 全链路', async () => {
  await withPlugin(async ({ api }) => {
    const open = await toolNamed(api, 'redteam_engagement_open').handler(
      { name: '演示靶标', scope: 'example.com' },
      ctx(),
    );
    const eng = JSON.parse(open.content);
    assert.match(eng.id, /^ENG-/);
    assert.equal(eng.sessionId, 'session-test');

    const assetRaw = await toolNamed(api, 'redteam_asset_add').handler(
      { kind: 'domain', value: 'admin.example.com', surface: 'nginx/1.20 ThinkPHP' },
      ctx(),
    );
    const asset = JSON.parse(assetRaw.content);
    assert.match(asset.id, /^A\d+/);
    assert.equal(asset.eng, eng.id);

    const assessed = JSON.parse(
      (
        await toolNamed(api, 'redteam_asset_assess').handler(
          { assetId: asset.id, priority: 'high', potential: 85, reason: 'Nday 版本' },
          ctx(),
        )
      ).content,
    );
    assert.equal(assessed.priority, 'high');

    const vuln = JSON.parse(
      (
        await toolNamed(api, 'redteam_vuln_add').handler(
          { assetId: asset.id, title: 'ThinkPHP RCE', level: 'critical', request: 'GET /index.php?s=...' },
          ctx(),
        )
      ).content,
    );
    assert.match(vuln.id, /^V\d+/);

    const ev = JSON.parse(
      (
        await toolNamed(api, 'redteam_evidence_record').handler(
          { summary: '疑似 RCE 回显', assetId: asset.id },
          ctx(),
        )
      ).content,
    );
    assert.equal(ev.confidence, 'claimed');

    const before = JSON.parse(
      (await toolNamed(api, 'redteam_unverified_count').handler({}, ctx())).content,
    );
    assert.equal(before.unverified, 1);

    const upgraded = JSON.parse(
      (
        await toolNamed(api, 'redteam_evidence_upgrade').handler(
          { evidenceId: ev.id, verifiedResult: 'curl 返回 uid=0' },
          ctx(),
        )
      ).content,
    );
    assert.equal(upgraded.confidence, 'observed');

    const after = JSON.parse(
      (await toolNamed(api, 'redteam_unverified_count').handler({}, ctx())).content,
    );
    assert.equal(after.unverified, 0);

    const score = JSON.parse(
      (
        await toolNamed(api, 'redteam_score_hit').handler(
          { point: '边界突破', note: 'ThinkPHP RCE 拿 shell' },
          ctx(),
        )
      ).content,
    );
    assert.match(score.id, /^S\d+/);

    // 统计口径
    const stats = JSON.parse(
      (await toolNamed(api, 'redteam_asset_stats').handler({}, ctx())).content,
    );
    assert.equal(stats.total, 1);
    assert.equal(stats.byPriority.high, 1);

    const info = JSON.parse(
      (await toolNamed(api, 'redteam_session_info').handler({}, ctx())).content,
    );
    assert.equal(info.vulns, 1);
    assert.equal(info.scores, 1);
    assert.equal(info.evidence.unverified, 0);
  });
});

test('资产库落盘，重新加载后仍在（跨重启）', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-purge-rt-'));
  try {
    const plugin1 = new GuadaPurgePlugin();
    const api1 = makeApi(dataDir);
    await plugin1.onLoad(api1);
    await toolNamed(api1, 'redteam_engagement_open').handler({ name: 'T1' }, ctx());
    await toolNamed(api1, 'redteam_asset_add').handler({ value: 'a.example.com' }, ctx());

    const file = path.join(dataDir, 'redteam.json');
    assert.equal(fs.existsSync(file), true);

    // 模拟重启：新实例读同一 dataDir
    const plugin2 = new GuadaPurgePlugin();
    const api2 = makeApi(dataDir);
    await plugin2.onLoad(api2);
    const stats = JSON.parse(
      (await toolNamed(api2, 'redteam_asset_stats').handler({}, ctx())).content,
    );
    assert.equal(stats.total, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('不同会话的靶标互不干扰', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-purge-rt-'));
  try {
    const plugin = new GuadaPurgePlugin();
    const api = makeApi(dataDir);
    await plugin.onLoad(api);

    const ctxA = { session: { sessionId: 'sess-A' } };
    const ctxB = { session: { sessionId: 'sess-B' } };

    await toolNamed(api, 'redteam_engagement_open').handler({ name: 'A 靶标' }, ctxA);
    await toolNamed(api, 'redteam_engagement_open').handler({ name: 'B 靶标' }, ctxB);
    await toolNamed(api, 'redteam_asset_add').handler({ value: 'a.example.com' }, ctxA);

    const statsA = JSON.parse(
      (await toolNamed(api, 'redteam_asset_stats').handler({}, ctxA)).content,
    );
    const statsB = JSON.parse(
      (await toolNamed(api, 'redteam_asset_stats').handler({}, ctxB)).content,
    );
    assert.equal(statsA.total, 1);
    assert.equal(statsB.total, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('指挥官声明能力白名单与可派角色，人设来自 presets/persona.md', async () => {
  await withPlugin(async ({ api }) => {
    const agent = api.calls.agents.find((a) => a.id === 'leader');
    assert.equal(agent.name, '红队指挥官');
    // 工具包：自己的 redteam + sub_agent（派活）
    assert.deepEqual(agent.toolkits, ['redteam', 'sub_agent:subagent']);
    // 可派角色
    assert.deepEqual(agent.agents, ['recon', 'assess', 'vuln-scan', 'exploit', 'internal']);
    assert.ok(agent.skills.length >= 6);
    for (const name of agent.skills) {
      assert.equal(name, name.toLowerCase());
    }
    assert.ok(agent.systemPrompt.length > 200);
    assert.match(agent.systemPrompt, /红队/);
  });
});

test('执行角色各有独立人设与技能白名单', async () => {
  await withPlugin(async ({ api }) => {
    const byId = new Map(api.calls.agents.map((a) => [a.id, a]));
    assert.deepEqual(byId.get('recon').skills, [
      'recon-pipeline',
      'fofa-recon',
      'redteam-authorization',
    ]);
    assert.deepEqual(byId.get('internal').skills, ['fscan-intranet']);
    assert.ok(byId.get('exploit').skills.includes('webshell-toolkit'));
    for (const id of ['recon', 'assess', 'vuln-scan', 'exploit', 'internal']) {
      const role = byId.get(id);
      assert.ok(role.systemPrompt.length > 200, `${id} 人设过短`);
      assert.deepEqual(role.toolkits, ['redteam'], `${id} 应共享 redteam 包`);
    }
  });
});

test('并发闸门：3 个占位后第 4 个被拒，release 后可再占', async () => {
  await withPlugin(async ({ api }) => {
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '闸门靶标' }, ctx());
    const slot = toolNamed(api, 'redteam_agent_slot');

    for (const role of ['recon', 'assess', 'vuln-scan']) {
      const res = JSON.parse(
        (await slot.handler({ action: 'acquire', role }, ctx())).content,
      );
      assert.equal(res.ok, true, `${role} 应占位成功`);
    }

    const fourth = JSON.parse(
      (await slot.handler({ action: 'acquire', role: 'exploit' }, ctx())).content,
    );
    assert.equal(fourth.ok, false);
    assert.equal(fourth.reason, 'full');

    const status = JSON.parse((await slot.handler({ action: 'status' }, ctx())).content);
    assert.equal(status.used, 3);
    assert.equal(status.max, 3);

    const released = JSON.parse(
      (await slot.handler({ action: 'release', role: 'recon' }, ctx())).content,
    );
    assert.equal(released.released, 1);

    const retry = JSON.parse(
      (await slot.handler({ action: 'acquire', role: 'exploit' }, ctx())).content,
    );
    assert.equal(retry.ok, true);
  });
});

test('超时占位被自动回收', async () => {
  await withPlugin(async ({ api, plugin }) => {
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '租约靶标' }, ctx());
    const slot = toolNamed(api, 'redteam_agent_slot');
    await slot.handler({ action: 'acquire', role: 'recon' }, ctx());

    // 把占位时间改成 31 分钟前（超过 30 分钟租约）
    const data = plugin.db.load();
    data.slots[0].acquiredAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    plugin.db.save();

    const status = JSON.parse((await slot.handler({ action: 'status' }, ctx())).content);
    assert.equal(status.used, 0);
  });
});

test('靶标继承：子会话按 parentSessionId 落到父会话的演练', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-purge-rt-'));
  try {
    const plugin = new GuadaPurgePlugin();
    const api = makeApi(dataDir);
    await plugin.onLoad(api);

    const parentCtx = { session: { sessionId: 'sess-parent' } };
    const childCtx = {
      session: { sessionId: 'sess-child', parentSessionId: 'sess-parent' },
    };

    const engInfo = JSON.parse(
      (await toolNamed(api, 'redteam_engagement_open').handler(
        { name: '继承靶标' },
        parentCtx,
      )).content,
    );

    // 子会话自己没绑定 → 继承父会话
    const asset = JSON.parse(
      (await toolNamed(api, 'redteam_asset_add').handler(
        { value: 'inner.example.com' },
        childCtx,
      )).content,
    );
    assert.equal(asset.eng, engInfo.id);

    // 父会话统计里能看到
    const stats = JSON.parse(
      (await toolNamed(api, 'redteam_asset_stats').handler({}, parentCtx)).content,
    );
    assert.equal(stats.total, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('技能随能力包注册且内容非空', async () => {
  await withPlugin(async ({ api }) => {
    const names = api.handle.skills.map((s) => s.name).sort();
    for (const expected of [
      'credential-attack',
      'fofa-recon',
      'fscan-intranet',
      'nuclei-scan',
      'recon-pipeline',
      'redteam-authorization',
      'webshell-toolkit',
    ]) {
      assert.ok(names.includes(expected), `缺少技能 ${expected}`);
    }
    for (const skill of api.handle.skills) {
      assert.ok(skill.content.length > 200, `${skill.name} 内容过短`);
    }
  });
});

test('preflight 返回环境与工具检查结果', async () => {
  await withPlugin(async ({ api }) => {
    const result = JSON.parse(
      (await toolNamed(api, 'redteam_preflight').handler({}, ctx())).content,
    );
    assert.ok(Array.isArray(result.env));
    assert.ok(Array.isArray(result.tools));
    assert.ok(result.env.some((item) => item.key === 'FOFA_KEY'));
    assert.equal(typeof result.ready, 'boolean');
  });
});

test('攻击链 + 报告：链步骤自动记分，报告含关键段落', async () => {
  await withPlugin(async ({ api }) => {
    const c = ctx();
    await toolNamed(api, 'redteam_engagement_open').handler(
      { name: '报告靶标', scope: 'example.com' },
      c,
    );

    const asset = JSON.parse(
      (
        await toolNamed(api, 'redteam_asset_add').handler(
          { kind: 'host', value: '1.2.3.4', surface: 'nginx/1.20 ThinkPHP' },
          c,
        )
      ).content,
    );

    const vuln = JSON.parse(
      (
        await toolNamed(api, 'redteam_vuln_add').handler(
          {
            assetId: asset.id,
            title: 'ThinkPHP RCE',
            level: 'critical',
            status: 'confirmed',
            request: 'GET /index.php?s=/index/\\think\\app/invokefunction&function=phpinfo',
          },
          c,
        )
      ).content,
    );

    const chain = JSON.parse(
      (
        await toolNamed(api, 'redteam_chain_add').handler(
          {
            stageCode: 'boundary',
            title: '上传冰蝎马拿到 shell',
            detail: '后台模板上传点可写 jsp',
            tool: 'curl -X POST http://1.2.3.4/upload -F file=@shell.jsp',
            result: 'uid=0(root) gid=0(root)',
            assetId: asset.id,
            vulnId: vuln.id,
            pointCode: 'webshell',
            evidence: 'A1 上拿到 www-data webshell，curl 实测可执行命令',
          },
          c,
        )
      ).content,
    );

    assert.equal(chain.seq, 1);
    assert.ok(chain.score, '带 pointCode + evidence 应自动记分');

    const report = JSON.parse(
      (await toolNamed(api, 'redteam_score_report').handler({}, c)).content,
    );
    assert.equal(report.summary.totalPoints, 30);
    assert.equal(report.summary.chainSteps, 1);
    assert.match(report.markdown, /# 报告靶标 · 红队演练报告/);
    assert.match(report.markdown, /## 二、得分明细/);
    assert.match(report.markdown, /## 三、攻击链/);
    assert.match(report.markdown, /边界突破/);
    assert.match(report.markdown, /ThinkPHP RCE/);
    assert.match(report.markdown, /## 九、修复建议/);

    // 只要摘要
    const brief = JSON.parse(
      (await toolNamed(api, 'redteam_score_report').handler({ markdown: false }, c)).content,
    );
    assert.equal(brief.markdown, undefined);
    assert.equal(brief.summary.assets, 1);

    // 按资产看路径
    const path = JSON.parse(
      (await toolNamed(api, 'redteam_attack_path').handler({ assetId: asset.id }, c)).content,
    );
    assert.equal(path.chains.length, 1);
    assert.equal(path.vulns.length, 1);
  });
});

test('自定义得分点覆盖内置分值', async () => {
  await withPlugin(async ({ api }) => {
    const c = ctx();
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '评分靶标' }, c);
    await toolNamed(api, 'redteam_score_point_save').handler(
      { code: 'webshell', name: '拿马', points: 99 },
      c,
    );
    await toolNamed(api, 'redteam_score_hit').handler(
      { point: 'webshell', note: '测试分值覆盖' },
      c,
    );
    const brief = JSON.parse(
      (await toolNamed(api, 'redteam_score_report').handler({ markdown: false }, c)).content,
    );
    assert.equal(brief.summary.totalPoints, 99);
  });
});

test('未知资产：登记 → 未解决列表 → 解决', async () => {
  await withPlugin(async ({ api }) => {
    const c = ctx();
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '未知靶标' }, c);

    const u = JSON.parse(
      (
        await toolNamed(api, 'redteam_unknown_record').handler(
          { value: '10.0.0.5:8888 返回 500', note: '像是内部管理台' },
          c,
        )
      ).content,
    );

    let open = JSON.parse(
      (await toolNamed(api, 'redteam_unknown_list').handler({}, c)).content,
    );
    assert.equal(open.length, 1);

    await toolNamed(api, 'redteam_unknown_resolve').handler(
      { id: u.id, resolvedAs: '内网 Jenkins' },
      c,
    );

    open = JSON.parse((await toolNamed(api, 'redteam_unknown_list').handler({}, c)).content);
    assert.equal(open.length, 0);

    const resolved = JSON.parse(
      (await toolNamed(api, 'redteam_unknown_list').handler({ status: 'resolved' }, c)).content,
    );
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].resolvedAs, '内网 Jenkins');
  });
});

test('report_targets 按资产汇总成果', async () => {
  await withPlugin(async ({ api }) => {
    const c = ctx();
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '汇总靶标' }, c);
    const a = JSON.parse(
      (await toolNamed(api, 'redteam_asset_add').handler({ value: 'a.example.com' }, c)).content,
    );
    await toolNamed(api, 'redteam_vuln_add').handler(
      { assetId: a.id, title: 'v1', level: 'high' },
      c,
    );
    await toolNamed(api, 'redteam_chain_add').handler(
      { title: '探测', assetId: a.id, tool: 'curl', result: '200' },
      c,
    );

    const targets = JSON.parse(
      (await toolNamed(api, 'redteam_report_targets').handler({}, c)).content,
    );
    assert.equal(targets.totals.targets, 1);
    assert.equal(targets.totals.vulns, 1);
    assert.equal(targets.targets[0].vulns, 1);
    assert.equal(targets.targets[0].chains, 1);
  });
});

test('资产深挖：详情 / 关系 / 图谱 / 时间线', async () => {
  await withPlugin(async ({ api }) => {
    const c = ctx();
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '深挖靶标' }, c);

    const parent = JSON.parse(
      (await toolNamed(api, 'redteam_asset_add').handler(
        { kind: 'domain', value: 'example.com' },
        c,
      )).content,
    );
    const child = JSON.parse(
      (await toolNamed(api, 'redteam_asset_add').handler(
        { kind: 'host', value: 'admin.example.com', ip: '1.2.3.4', port: 8443 },
        c,
      )).content,
    );

    await toolNamed(api, 'redteam_asset_link').handler(
      { from: parent.id, to: child.id, kind: 'subdomain' },
      c,
    );
    const vuln = JSON.parse(
      (await toolNamed(api, 'redteam_vuln_add').handler(
        { assetId: child.id, title: '后台弱口令', level: 'high' },
        c,
      )).content,
    );
    await toolNamed(api, 'redteam_chain_add').handler(
      { title: '发现后台', assetId: child.id, tool: 'httpx', result: '200' },
      c,
    );

    const detail = JSON.parse(
      (await toolNamed(api, 'redteam_asset_get').handler({ assetId: child.id }, c)).content,
    );
    assert.equal(detail.asset.value, 'admin.example.com');
    assert.equal(detail.vulns.length, 1);
    assert.equal(detail.chains.length, 1);
    assert.equal(detail.links.length, 1);

    const graph = JSON.parse(
      (await toolNamed(api, 'redteam_asset_graph').handler({}, c)).content,
    );
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].kind, 'subdomain');

    const timeline = JSON.parse(
      (await toolNamed(api, 'redteam_asset_timeline').handler({ assetId: child.id }, c)).content,
    );
    assert.ok(timeline.length >= 3, '资产/漏洞/链步骤都应进时间线');
    assert.deepEqual(
      timeline.map((e) => e.type).sort(),
      ['asset', 'chain', 'vuln'],
    );

    // 漏洞关联校验
    assert.equal(vuln.assetId, child.id);
  });
});

test('漏洞状态流转后进入报告', async () => {
  await withPlugin(async ({ api }) => {
    const c = ctx();
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '流转靶标' }, c);
    const asset = JSON.parse(
      (await toolNamed(api, 'redteam_asset_add').handler({ value: 'a.com' }, c)).content,
    );
    const vuln = JSON.parse(
      (await toolNamed(api, 'redteam_vuln_add').handler(
        { assetId: asset.id, title: 'SQL 注入', level: 'high' },
        c,
      )).content,
    );

    // found 状态不进报告
    let report = JSON.parse(
      (await toolNamed(api, 'redteam_score_report').handler({ markdown: false }, c)).content,
    );
    assert.equal(report.summary.vulns.reported, 0);

    // 置为 confirmed 后进入报告
    const updated = JSON.parse(
      (await toolNamed(api, 'redteam_vuln_update').handler(
        { id: vuln.id, status: 'confirmed', request: 'GET /?id=1%27' },
        c,
      )).content,
    );
    assert.equal(updated.status, 'confirmed');

    report = JSON.parse(
      (await toolNamed(api, 'redteam_score_report').handler({}, c)).content,
    );
    assert.equal(report.summary.vulns.reported, 1);
    assert.match(report.markdown, /SQL 注入/);
  });
});

test('HTTP 证据归档 + 截图生命周期', async () => {
  await withPlugin(async ({ api }) => {
    const c = ctx();
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '证据靶标' }, c);

    const ev = JSON.parse(
      (await toolNamed(api, 'redteam_http_evidence_add').handler(
        {
          url: 'http://a.com/api/user?id=1',
          request: 'GET /api/user?id=1 HTTP/1.1\\nHost: a.com',
          response: 'HTTP/1.1 200 OK\\n\\n{"name":"admin"}',
          summary: '未授权访问用户信息',
        },
        c,
      )).content,
    );
    assert.equal(ev.confidence, 'observed');
    assert.equal(ev.kind, 'http');

    // 无 url 的核实：直接标记
    const plain = JSON.parse(
      (await toolNamed(api, 'redteam_evidence_record').handler(
        { summary: '目录存在 403', confidence: 'claimed' },
        c,
      )).content,
    );
    const verified = JSON.parse(
      (await toolNamed(api, 'redteam_evidence_verify').handler(
        { evidenceId: plain.id, method: '人工确认' },
        c,
      )).content,
    );
    assert.equal(verified.confidence, 'observed');

    // 截图
    const shot = JSON.parse(
      (await toolNamed(api, 'redteam_shot_add').handler(
        { path: 'runs/shot-1.png', note: '后台首页' },
        c,
      )).content,
    );
    assert.match(shot.id, /^P/);
    let shots = JSON.parse((await toolNamed(api, 'redteam_shot_list').handler({}, c)).content);
    assert.equal(shots.length, 1);
    await toolNamed(api, 'redteam_shot_delete').handler({ id: shot.id }, c);
    shots = JSON.parse((await toolNamed(api, 'redteam_shot_list').handler({}, c)).content);
    assert.equal(shots.length, 0);
  });
});

test('资产连通性探测：不可达时返回 ok=false 而不是抛错', async () => {
  await withPlugin(async ({ api }) => {
    const c = ctx();
    await toolNamed(api, 'redteam_engagement_open').handler({ name: '探测靶标' }, c);
    // 端口 1 基本不会有人监听，应快速拒绝
    const result = JSON.parse(
      (await toolNamed(api, 'redteam_asset_test').handler(
        { target: '127.0.0.1:1', timeoutMs: 1500 },
        c,
      )).content,
    );
    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(result.url, 'http://127.0.0.1:1');
  });
});
