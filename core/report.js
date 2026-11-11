'use strict';

/**
 * 演练报告生成（Markdown）
 *
 * 只收录**有证据/已拿分**的成果（与 dsh-purge 的 score_report 口径一致）：
 * - 得分项：来自 scores（链步骤带 pointCode+evidence 时自动记分）
 * - 漏洞：只收 confirmed / exploited 状态
 * - 入口（WebShell/隧道/凭据）：全部列，但标注是否已核实
 * - 未决事项：未核实证据、缺 tool/result 的链步骤、未解决的未知资产
 */

/** 内置得分点（可被 redteam_score_point_save 覆盖） */
const DEFAULT_POINTS = {
  rce: { name: '远程代码执行', points: 50 },
  webshell: { name: '获取 WebShell', points: 30 },
  boundary: { name: '边界突破（隧道）', points: 40 },
  'internal-pivot': { name: '内网突破', points: 40 },
  'web-account-admin': { name: '管理员账号', points: 20 },
  'web-account-user': { name: '普通账号', points: 10 },
  'db-access': { name: '数据库权限', points: 20 },
  'sensitive-data': { name: '敏感数据', points: 20 },
  'core-system': { name: '靶标系统权限', points: 60 },
};

const STAGE_LABEL = {
  recon: '信息收集',
  internet: '互联网资产权限',
  boundary: '边界突破',
  internal: '内网资产权限',
  target: '靶标系统权限',
  other: '其他',
};

const LEVEL_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const REPORT_STATUSES = new Set(['confirmed', 'exploited']);

function resolvePoints(db, eng) {
  const table = { ...DEFAULT_POINTS };
  for (const custom of db.listScorePoints(eng)) {
    table[custom.code] = { name: custom.name || custom.code, points: Number(custom.points) || 0 };
  }
  return table;
}

function fmtList(items, mapper) {
  if (!items.length) return '（无）';
  return items.map(mapper).join('\n');
}

function buildReport(db, engagement) {
  const eng = engagement.id;
  const assets = db.listAssets(eng);
  const vulns = db.queryVulns(eng);
  const evidence = db.listEvidence(eng);
  const scores = db.listScores(eng);
  const chains = db.listChains(eng);
  const webshells = db.listWebshells(eng);
  const tunnels = db.listTunnels(eng);
  const credentials = db.listCredentials(eng);
  const attackFiles = db.listAttackFiles(eng);
  const unknowns = db.listUnknowns(eng);

  const points = resolvePoints(db, eng);
  const total = scores.reduce((sum, s) => sum + (points[s.point]?.points || 0), 0);

  const reportVulns = vulns
    .filter((v) => REPORT_STATUSES.has(v.status))
    .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));

  const unverified = evidence.filter((e) => e.confidence === 'claimed');
  const incompleteChains = chains.filter((c) => !c.tool || !c.result);
  const openUnknowns = unknowns.filter((u) => u.status === 'open');

  const lines = [];
  const push = (line = '') => lines.push(line);

  push(`# ${engagement.name} · 红队演练报告`);
  push();
  push(`- 演练 id：\`${engagement.id}\``);
  push(`- 授权范围：${engagement.scope || '（未填写）'}`);
  push(`- 生成时间：${new Date().toISOString()}`);
  push();

  // ── 概览 ──
  push('## 一、执行摘要');
  push();
  push('| 指标 | 数量 |');
  push('|---|---|');
  push(`| 资产 | ${assets.length} |`);
  push(`| 漏洞（已确认/已利用） | ${reportVulns.length} / 共发现 ${vulns.length} |`);
  push(`| WebShell 入口 | ${webshells.length} |`);
  push(`| 隧道 | ${tunnels.length} |`);
  push(`| 凭据 | ${credentials.length} |`);
  push(`| 攻击链步骤 | ${chains.length} |`);
  push(`| 得分 | **${total}**（${scores.length} 项） |`);
  push();

  // ── 评分 ──
  push('## 二、得分明细');
  push();
  if (!scores.length) {
    push('（尚无得分记录）');
  } else {
    push('| 得分点 | 分值 | 说明 |');
    push('|---|---|---|');
    for (const s of scores) {
      const def = points[s.point];
      const name = def?.name || s.point;
      const pts = def?.points ?? 0;
      const flag = s.selfCreated ? '（自建，通常不计分）' : '';
      push(`| ${name} \`${s.point}\` | ${pts} | ${escapeCell(s.note || '')}${flag} |`);
    }
    push();
    push(`**合计：${total} 分**`);
  }
  push();

  // ── 攻击链 ──
  push('## 三、攻击链');
  push();
  if (!chains.length) {
    push('（尚无攻击链记录）');
  } else {
    const byStage = new Map();
    for (const c of chains) {
      const key = c.stageCode || 'other';
      if (!byStage.has(key)) byStage.set(key, []);
      byStage.get(key).push(c);
    }
    for (const [stage, rows] of byStage) {
      push(`### ${STAGE_LABEL[stage] || stage}`);
      push();
      rows
        .sort((a, b) => a.seq - b.seq)
        .forEach((c, idx) => {
          push(`${idx + 1}. **${c.title}**`);
          if (c.detail) push(`   - 依据：${c.detail}`);
          if (c.tool) push(`   - 命令：\`${c.tool}\``);
          if (c.result) push(`   - 结果：${c.result}`);
          if (c.assetId) push(`   - 资产：${c.assetId}`);
          if (c.pointCode) push(`   - 得分点：\`${c.pointCode}\``);
        });
      push();
    }
  }

  // ── 漏洞 ──
  push('## 四、成果漏洞');
  push();
  if (!reportVulns.length) {
    push('（没有已确认/已利用的漏洞；待验证与误报不进入报告）');
  } else {
    for (const v of reportVulns) {
      push(`### ${v.id} ${v.title}（${v.level}）`);
      push();
      push(`- 资产：${v.assetId || '（未关联）'}`);
      push(`- 状态：${v.status}`);
      if (v.request) {
        push('- 原始请求：');
        push('```http');
        push(v.request.trim());
        push('```');
      }
      if (v.response) {
        push('- 关键响应：');
        push('```');
        push(v.response.trim().slice(0, 2000));
        push('```');
      }
      push();
    }
  }

  // ── 入口与凭据 ──
  push('## 五、入口与凭据');
  push();
  push('### WebShell');
  push(fmtList(webshells, (w) => `- ${w.id} \`${w.type}\` ${w.url}（资产 ${w.assetId || '-'}）`));
  push();
  push('### 隧道');
  push(
    fmtList(
      tunnels,
      (t) =>
        `- ${t.id} 入口类型 \`${t.entryKind}\` 监听 \`${t.listen}\`` +
        (t.reachable ? `，可达 ${t.reachable}` : '') +
        (t.entryKind === 'self-only' ? '（**未跨靶标边界，不计突破**）' : ''),
    ),
  );
  push();
  push('### 凭据');
  push(
    fmtList(
      credentials,
      (c) =>
        `- ${c.id} 用户 \`${c.username}\` 口令 \`${c.secretMasked || '****'}\`` +
        `（资产 ${c.assetId || '-'}，${c.loginVerified ? '已实测登录' : '**未实测登录**'}）`,
    ),
  );
  push();

  // ── 内网 ──
  const internalAssets = assets.filter((a) => a.kind === 'segment' || /gogo|fscan/.test(a.source || ''));
  push('## 六、内网资产');
  push();
  push(
    fmtList(
      internalAssets,
      (a) =>
        `- ${a.id} \`${a.value}\`` +
        (a.surface ? ` — ${a.surface}` : '') +
        (a.kind === 'segment' ? '（网段）' : ''),
    ),
  );
  push();

  // ── 攻击文件 ──
  if (attackFiles.length) {
    push('## 七、产出文件');
    push();
    push(fmtList(attackFiles, (f) => `- ${f.name}（${f.kind}）${f.path ? ` \`${f.path}\`` : ''}${f.note ? ` — ${f.note}` : ''}`));
    push();
  }

  // ── 未决 ──
  push('## 八、未决事项');
  push();
  push(`- 未核实证据：${unverified.length} 条${unverified.length ? '（报告结论以此为准前需复核）' : ''}`);
  push(`- 攻击链缺命令/回显的步骤：${incompleteChains.length} 条${incompleteChains.length ? `（${incompleteChains.map((c) => c.title).slice(0, 5).join('、')}）` : ''}`);
  push(`- 未解决的未知资产：${openUnknowns.length} 条${openUnknowns.length ? `（${openUnknowns.map((u) => u.value).slice(0, 5).join('、')}）` : ''}`);
  push(`- 待验证漏洞：${vulns.filter((v) => v.status === 'found').length} 条`);
  push();

  // ── 修复建议 ──
  push('## 九、修复建议');
  push();
  if (!reportVulns.length) {
    push('（无已确认漏洞，暂不给出修复项）');
  } else {
    for (const level of LEVEL_ORDER) {
      const rows = reportVulns.filter((v) => v.level === level);
      if (!rows.length) continue;
      push(`### ${level.toUpperCase()}`);
      push();
      for (const v of rows) {
        push(`- **${v.title}**（${v.assetId || '未关联资产'}）— 优先修复，附带原始请求可复现`);
      }
      push();
    }
  }

  const markdown = lines.join('\n');
  return {
    markdown,
    summary: {
      engagement: engagement.id,
      name: engagement.name,
      totalScores: scores.length,
      totalPoints: total,
      assets: assets.length,
      vulns: { reported: reportVulns.length, found: vulns.length },
      chainSteps: chains.length,
      webshells: webshells.length,
      tunnels: tunnels.length,
      credentials: credentials.length,
      warnings: {
        unverifiedEvidence: unverified.length,
        incompleteChains: incompleteChains.length,
        openUnknowns: openUnknowns.length,
      },
    },
  };
}

/** 按目标（资产）汇总成果，供 report_targets */
function buildTargets(db, engagement) {
  const eng = engagement.id;
  const assets = db.listAssets(eng);
  const vulns = db.queryVulns(eng);
  const chains = db.listChains(eng);

  const map = new Map();
  const touch = (key) => {
    if (!map.has(key)) {
      map.set(key, { key, label: key, assets: 0, vulns: 0, chains: 0, levels: {} });
    }
    return map.get(key);
  };

  for (const a of assets) {
    const key = a.id;
    const row = touch(key);
    row.assets += 1;
    row.label = a.value || a.id;
  }
  for (const v of vulns) {
    const row = touch(v.assetId || `vuln:${v.id}`);
    row.vulns += 1;
    row.levels[v.level] = (row.levels[v.level] || 0) + 1;
  }
  for (const c of chains) {
    if (!c.assetId) continue;
    touch(c.assetId).chains += 1;
  }

  return {
    engagement: eng,
    generatedAt: new Date().toISOString(),
    totals: {
      assets: assets.length,
      vulns: vulns.length,
      chains: chains.length,
      targets: map.size,
    },
    targets: Array.from(map.values()).sort((a, b) => b.vulns - a.vulns || b.chains - a.chains),
  };
}

function escapeCell(text) {
  return String(text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

module.exports = { buildReport, buildTargets, DEFAULT_POINTS, STAGE_LABEL };
