'use strict';

/**
 * 红队资产库（JSON 版）
 *
 * 对齐 dsh-purge 的 redteam_* 语义，但存储换成单文件 JSON：
 * - 外部插件零依赖（不用 better-sqlite3 / node:sqlite，避免 ABI 与版本问题）
 * - 单演练几百条量级足够，且可直接用编辑器核对
 * - 原子写（tmp + rename），损坏时备份 .bad 后重置，不阻塞开工
 *
 * 数据形状：
 * {
 *   seq: { asset: n, vuln: n, evidence: n, webshell: n, tunnel: n, cred: n, score: n },
 *   engagements: { <id>: { id, name, scope, sessionId, createdAt } },
 *   assets:      { <id>: { id, eng, kind, value, ip, port, title, priority, potential, reason, surface, source, createdAt } },
 *   vulns:       { <id>: { id, eng, assetId, title, level, status, request, response, createdAt } },
 *   evidence:    { <id>: { id, eng, kind, assetId, summary, confidence, verifiedResult, createdAt } },
 *   webshells:   { <id>: { id, eng, assetId, url, type, verified, createdAt } },
 *   tunnels:     { <id>: { id, eng, entryKind, listen, reachable, verified, createdAt } },
 *   credentials: { <id>: { id, eng, assetId, username, secretMasked, loginVerified, createdAt } },
 *   scores:      [ { id, eng, point, note, createdAt } ]
 * }
 */

const fs = require('node:fs');
const path = require('node:path');

const EMPTY = () => ({
  seq: { asset: 0, vuln: 0, evidence: 0, webshell: 0, tunnel: 0, cred: 0, score: 0 },
  engagements: {},
  assets: {},
  vulns: {},
  evidence: {},
  webshells: {},
  tunnels: {},
  credentials: {},
  scores: [],
  /** 派活占位（并发闸门）：{ eng, role, sessionId, acquiredAt } */
  slots: [],
  /** 攻击链步骤：{ id, eng, seq, stage, stageCode, title, detail, tool, result, assetId, vulnId, accessId, pointCode, evidence, selfCreated, createdAt } */
  chains: [],
  /** 自定义得分点（覆盖内置默认）：{ eng|null, code, name, points } */
  scorePoints: [],
  /** 攻击文件/产出：{ id, eng, name, kind, path, note, createdAt } */
  attackFiles: [],
  /** 未知资产（看到了但说不清）：{ id, eng, value, note, status, resolvedAs, createdAt } */
  unknowns: [],
  /** 资产关系：{ eng, from, to, kind, note, createdAt } */
  links: [],
  /** 截图/证据文件：{ id, eng, assetId, vulnId, path, note, createdAt } */
  shots: [],
  /** 访问会话（横向移动起点）：{ id, eng, host, method, username, privilege, assetId, sessionRef, note, createdAt } */
  accesses: [],
  /** PoC/EXP 知识库：{ id, eng, code, title, kind, category, cve, component, versions, language, source, sourceUrl, content, tags, verified, verifiedNote, hitCount, createdAt, updatedAt } */
  pocs: [],
});

class RedteamDb {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'redteam.json');
    this.data = null;
  }

  // ── 读写 ──

  load() {
    if (this.data) return this.data;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...EMPTY(), ...parsed };
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        // 坏文件：留档后重置，避免每次开工都崩
        try {
          fs.renameSync(this.file, `${this.file}.bad`);
        } catch {
          /* ignore */
        }
      }
      this.data = EMPTY();
    }
    return this.data;
  }

  save() {
    const data = this.data || EMPTY();
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
    return data;
  }

  /** 丢弃内存缓存（多进程/手工编辑后重读） */
  invalidate() {
    this.data = null;
  }

  nextId(kind) {
    const data = this.load();
    const n = (data.seq[kind] || 0) + 1;
    data.seq[kind] = n;
    const prefix = { asset: 'A', vuln: 'V', evidence: 'E', webshell: 'W', tunnel: 'T', cred: 'C', score: 'S' }[kind] || 'X';
    return `${prefix}${n}`;
  }

  // ── 演练（目标绑定） ──

  openEngagement({ name, scope, sessionId }) {
    const data = this.load();
    const id = `ENG-${Date.now().toString(36)}`;
    data.engagements[id] = {
      id,
      name: String(name || '').trim() || '未命名目标',
      scope: String(scope || '').trim(),
      sessionId: sessionId || null,
      createdAt: new Date().toISOString(),
    };
    this.save();
    return data.engagements[id];
  }

  /** 会话 → 当前演练（dsh-purge 的"靶标继承"语义） */
  engagementOfSession(sessionId) {
    if (!sessionId) return null;
    const data = this.load();
    const list = Object.values(data.engagements).filter((e) => e.sessionId === sessionId);
    if (list.length === 0) return null;
    return list[list.length - 1];
  }

  bindSession(engagementId, sessionId) {
    const data = this.load();
    const eng = data.engagements[engagementId];
    if (!eng) throw new Error(`演练不存在: ${engagementId}`);
    eng.sessionId = sessionId || null;
    this.save();
    return eng;
  }

  // ── 资产 ──

  addAsset(input) {
    const data = this.load();
    const id = this.nextId('asset');
    const asset = {
      id,
      eng: input.eng,
      kind: input.kind || 'host',
      value: String(input.value || ''),
      ip: input.ip || '',
      port: input.port == null ? null : Number(input.port),
      title: input.title || '',
      priority: input.priority || 'unknown',
      potential: input.potential == null ? null : Number(input.potential),
      reason: input.reason || '',
      surface: input.surface || '',
      source: input.source || 'tool',
      createdAt: new Date().toISOString(),
    };
    data.assets[id] = asset;
    this.save();
    return asset;
  }

  listAssets(eng, filter = {}) {
    const data = this.load();
    let rows = Object.values(data.assets).filter((a) => !eng || a.eng === eng);
    if (filter.kind) rows = rows.filter((a) => a.kind === filter.kind);
    if (filter.priority) rows = rows.filter((a) => a.priority === filter.priority);
    if (filter.contains) {
      const q = String(filter.contains).toLowerCase();
      rows = rows.filter(
        (a) =>
          String(a.value).toLowerCase().includes(q) ||
          String(a.title).toLowerCase().includes(q) ||
          String(a.ip).includes(q),
      );
    }
    if (filter.limit) rows = rows.slice(0, Number(filter.limit));
    return rows;
  }

  assessAsset(id, { priority, potential, reason }) {
    const data = this.load();
    const asset = data.assets[id];
    if (!asset) throw new Error(`资产不存在: ${id}`);
    if (priority) asset.priority = priority;
    if (potential != null) asset.potential = Number(potential);
    if (reason) asset.reason = reason;
    this.save();
    return asset;
  }

  assetStats(eng) {
    const rows = this.listAssets(eng);
    const by = (key) => {
      const out = {};
      for (const row of rows) out[row[key]] = (out[row[key]] || 0) + 1;
      return out;
    };
    return { total: rows.length, byKind: by('kind'), byPriority: by('priority') };
  }

  // ── 漏洞 ──

  addVuln(input) {
    const data = this.load();
    const id = this.nextId('vuln');
    const vuln = {
      id,
      eng: input.eng,
      assetId: input.assetId || '',
      title: String(input.title || '').trim() || '未命名漏洞',
      level: input.level || 'medium',
      status: input.status || 'found',
      request: input.request || '',
      response: input.response || '',
      createdAt: new Date().toISOString(),
    };
    data.vulns[id] = vuln;
    this.save();
    return vuln;
  }

  queryVulns(eng, filter = {}) {
    const data = this.load();
    let rows = Object.values(data.vulns).filter((v) => !eng || v.eng === eng);
    if (filter.assetId) rows = rows.filter((v) => v.assetId === filter.assetId);
    if (filter.level) rows = rows.filter((v) => v.level === filter.level);
    if (filter.status) rows = rows.filter((v) => v.status === filter.status);
    if (filter.limit) rows = rows.slice(0, Number(filter.limit));
    return rows;
  }

  // ── 证据（claimed → observed 的审计链） ──

  recordEvidence(input) {
    const data = this.load();
    const id = this.nextId('evidence');
    const ev = {
      id,
      eng: input.eng,
      kind: input.kind || 'fact',
      assetId: input.assetId || '',
      summary: String(input.summary || '').trim(),
      confidence: input.confidence || 'claimed',
      verifiedResult: '',
      createdAt: new Date().toISOString(),
    };
    data.evidence[id] = ev;
    this.save();
    return ev;
  }

  listEvidence(eng, filter = {}) {
    const data = this.load();
    let rows = Object.values(data.evidence).filter((e) => !eng || e.eng === eng);
    if (filter.confidence) rows = rows.filter((e) => e.confidence === filter.confidence);
    if (filter.assetId) rows = rows.filter((e) => e.assetId === filter.assetId);
    return rows;
  }

  upgradeEvidence(id, verifiedResult) {
    const data = this.load();
    const ev = data.evidence[id];
    if (!ev) throw new Error(`证据不存在: ${id}`);
    if (ev.confidence === 'observed') return ev;
    ev.confidence = 'observed';
    ev.verifiedResult = String(verifiedResult || '');
    ev.verifiedAt = new Date().toISOString();
    this.save();
    return ev;
  }

  unverifiedCount(eng) {
    return this.listEvidence(eng, { confidence: 'claimed' }).length;
  }

  // ── 入口 / 凭据（"只有凭据不算拿到账号"） ──

  addWebshell(input) {
    const data = this.load();
    const id = this.nextId('webshell');
    data.webshells[id] = {
      id,
      eng: input.eng,
      assetId: input.assetId || '',
      url: String(input.url || ''),
      type: input.type || 'behinder',
      verified: false,
      createdAt: new Date().toISOString(),
    };
    this.save();
    return data.webshells[id];
  }

  listWebshells(eng) {
    const data = this.load();
    return Object.values(data.webshells).filter((w) => !eng || w.eng === eng);
  }

  addTunnel(input) {
    const data = this.load();
    const id = this.nextId('tunnel');
    data.tunnels[id] = {
      id,
      eng: input.eng,
      entryKind: input.entryKind || 'unknown',
      listen: String(input.listen || ''),
      reachable: input.reachable || '',
      verified: false,
      createdAt: new Date().toISOString(),
    };
    this.save();
    return data.tunnels[id];
  }

  listTunnels(eng) {
    const data = this.load();
    return Object.values(data.tunnels).filter((t) => !eng || t.eng === eng);
  }

  addCredential(input) {
    const data = this.load();
    const id = this.nextId('cred');
    data.credentials[id] = {
      id,
      eng: input.eng,
      assetId: input.assetId || '',
      username: String(input.username || ''),
      secretMasked: String(input.secretMasked || ''),
      loginVerified: false,
      createdAt: new Date().toISOString(),
    };
    this.save();
    return data.credentials[id];
  }

  listCredentials(eng) {
    const data = this.load();
    return Object.values(data.credentials).filter((c) => !eng || c.eng === eng);
  }

  // ── 评分 ──

  hitScore(input) {
    const data = this.load();
    const id = this.nextId('score');
    const row = {
      id,
      eng: input.eng,
      point: String(input.point || '').trim() || '未命名得分点',
      note: input.note || '',
      chainId: input.chainId || '',
      selfCreated: input.selfCreated === true,
      createdAt: new Date().toISOString(),
    };
    data.scores.push(row);
    this.save();
    return row;
  }

  listScores(eng) {
    const data = this.load();
    return data.scores.filter((s) => !eng || s.eng === eng);
  }

  // ── 派活占位（并发闸门，对齐 dsh-purge 的 redteam_agent_slot） ──

  /** 回收超出租约的占位（子代理崩溃时不会永久占名额） */
  pruneExpiredSlots(ttlMs) {
    const data = this.load();
    const now = Date.now();
    const before = data.slots.length;
    data.slots = data.slots.filter((s) => {
      const at = Date.parse(s.acquiredAt || '');
      if (!Number.isFinite(at)) return false;
      return now - at < ttlMs;
    });
    if (data.slots.length !== before) this.save();
    return before - data.slots.length;
  }

  listSlots(eng, ttlMs) {
    if (ttlMs) this.pruneExpiredSlots(ttlMs);
    const data = this.load();
    return data.slots.filter((s) => !eng || s.eng === eng);
  }

  /**
   * 占位。满了返回 { ok:false, reason:'full' }，不抛错（模型据此决定等待）。
   */
  acquireSlot({ eng, role, sessionId, max, ttlMs }) {
    if (ttlMs) this.pruneExpiredSlots(ttlMs);
    const data = this.load();
    const used = data.slots.filter((s) => s.eng === eng);
    const limit = Number(max) > 0 ? Number(max) : 3;

    // 同一 role + 同一会话重复 acquire → 幂等返回已占的
    const existing = used.find((s) => s.role === role && s.sessionId === sessionId);
    if (existing) return { ok: true, slot: existing, used: used.length, max: limit };

    if (used.length >= limit) {
      return { ok: false, reason: 'full', used: used.length, max: limit, slots: used };
    }

    const slot = {
      eng,
      role: String(role || 'unknown'),
      sessionId: sessionId || null,
      acquiredAt: new Date().toISOString(),
    };
    data.slots.push(slot);
    this.save();
    return { ok: true, slot, used: data.slots.filter((s) => s.eng === eng).length, max: limit };
  }

  /** 释放：按 role 或 sessionId 移除；都不给则清空该演练全部 */
  releaseSlot({ eng, role, sessionId }) {
    const data = this.load();
    const before = data.slots.length;
    data.slots = data.slots.filter((s) => {
      if (s.eng !== eng) return true;
      if (role && s.role !== role) return true;
      if (sessionId && s.sessionId !== sessionId) return true;
      return false;
    });
    const released = before - data.slots.length;
    if (released > 0) this.save();
    return { released, remaining: data.slots.filter((s) => s.eng === eng).length };
  }

  // ── 攻击链 ──

  /**
   * 记录一个攻击链步骤。
   *
   * `tool`（实际命令原文）与 `result`（实际回显）是报告能复现的关键，
   * 落库时不做校验（模型可能先占位后补），由报告生成时提示缺失项。
   */
  addChain(input) {
    const data = this.load();
    const seq = (data.chains.filter((c) => c.eng === input.eng).length || 0) + 1;
    const row = {
      id: `C${Date.now().toString(36)}${seq}`,
      eng: input.eng,
      seq,
      stage: input.stage || 'other',
      stageCode: input.stageCode || '',
      title: String(input.title || '').trim() || '未命名步骤',
      detail: input.detail || '',
      tool: input.tool || '',
      result: input.result || '',
      assetId: input.assetId || '',
      vulnId: input.vulnId || '',
      accessId: input.accessId || '',
      pointCode: input.pointCode || '',
      evidence: input.evidence || '',
      selfCreated: input.selfCreated === true,
      recordedBy: input.recordedBy || '',
      createdAt: new Date().toISOString(),
    };
    data.chains.push(row);
    this.save();

    // 带得分点 + 证据 → 顺带记一次分（与 dsh 的"步骤与得分互挂"一致）
    let score = null;
    if (row.pointCode && row.evidence) {
      score = this.hitScore({
        eng: row.eng,
        point: row.pointCode,
        note: row.evidence,
        chainId: row.id,
        selfCreated: row.selfCreated,
      });
    }
    return { ...row, score };
  }

  listChains(eng, filter = {}) {
    const data = this.load();
    let rows = data.chains.filter((c) => !eng || c.eng === eng);
    if (filter.stageCode) rows = rows.filter((c) => c.stageCode === filter.stageCode);
    return rows.slice().sort((a, b) => a.seq - b.seq);
  }

  // ── 得分点定义（覆盖内置默认） ──

  saveScorePoint({ eng, code, name, points }) {
    const data = this.load();
    const key = String(code || '').trim();
    if (!key) throw new Error('score point code is required');
    const existing = data.scorePoints.find(
      (p) => p.code === key && (p.eng || null) === (eng || null),
    );
    const row = {
      eng: eng || null,
      code: key,
      name: String(name || key),
      points: Number(points) || 0,
    };
    if (existing) Object.assign(existing, row);
    else data.scorePoints.push(row);
    this.save();
    return row;
  }

  listScorePoints(eng) {
    const data = this.load();
    return data.scorePoints.filter((p) => !p.eng || p.eng === eng);
  }

  // ── 攻击文件（报告/脚本/导出物） ──

  addAttackFile(input) {
    const data = this.load();
    const id = `F${Date.now().toString(36)}`;
    const row = {
      id,
      eng: input.eng,
      name: String(input.name || '').trim() || '未命名文件',
      kind: input.kind || 'other',
      path: input.path || '',
      note: input.note || '',
      createdAt: new Date().toISOString(),
    };
    data.attackFiles.push(row);
    this.save();
    return row;
  }

  listAttackFiles(eng) {
    const data = this.load();
    return data.attackFiles.filter((f) => !eng || f.eng === eng);
  }

  // ── 未知资产 ──

  recordUnknown(input) {
    const data = this.load();
    const id = `U${Date.now().toString(36)}`;
    const row = {
      id,
      eng: input.eng,
      value: String(input.value || '').trim(),
      note: input.note || '',
      status: 'open',
      resolvedAs: '',
      createdAt: new Date().toISOString(),
    };
    data.unknowns.push(row);
    this.save();
    return row;
  }

  listUnknowns(eng, filter = {}) {
    const data = this.load();
    let rows = data.unknowns.filter((u) => !eng || u.eng === eng);
    if (filter.status) rows = rows.filter((u) => u.status === filter.status);
    return rows;
  }

  resolveUnknown(id, resolvedAs) {
    const data = this.load();
    const row = data.unknowns.find((u) => u.id === id);
    if (!row) throw new Error(`未知资产不存在: ${id}`);
    row.status = 'resolved';
    row.resolvedAs = String(resolvedAs || '');
    this.save();
    return row;
  }

  // ── 资产关系与时间线 ──

  linkAssets({ eng, from, to, kind, note }) {
    const data = this.load();
    if (!from || !to) throw new Error('link 需要 from 与 to');
    const row = {
      eng,
      from: String(from),
      to: String(to),
      kind: kind || 'related',
      note: note || '',
      createdAt: new Date().toISOString(),
    };
    const exists = data.links.find(
      (l) => l.eng === eng && l.from === row.from && l.to === row.to && l.kind === row.kind,
    );
    if (exists) return exists;
    data.links.push(row);
    this.save();
    return row;
  }

  listLinks(eng) {
    const data = this.load();
    return data.links.filter((l) => !eng || l.eng === eng);
  }

  /** 单资产详情：资产本体 + 关联漏洞/证据/链步骤/入口/关系 */
  assetDetail(eng, assetId) {
    const data = this.load();
    const asset = data.assets[assetId];
    if (!asset || asset.eng !== eng) return null;
    const links = data.links.filter((l) => l.eng === eng && (l.from === assetId || l.to === assetId));
    return {
      asset,
      vulns: Object.values(data.vulns).filter((v) => v.eng === eng && v.assetId === assetId),
      evidence: Object.values(data.evidence).filter((e) => e.eng === eng && e.assetId === assetId),
      chains: data.chains.filter((c) => c.eng === eng && c.assetId === assetId),
      webshells: Object.values(data.webshells).filter((w) => w.eng === eng && w.assetId === assetId),
      credentials: Object.values(data.credentials).filter((c) => c.eng === eng && c.assetId === assetId),
      links,
    };
  }

  /** 时间线：把资产/漏洞/证据/链步骤/入口按时间排序 */
  timeline(eng, assetId) {
    const data = this.load();
    // 资产自身用 id 匹配（其他记录用 assetId）
    const assets = Object.values(data.assets)
      .filter((a) => a.eng === eng && (!assetId || a.id === assetId))
      .map((a) => ({ at: a.createdAt, type: 'asset', id: a.id, label: `${a.value} 入库` }));

    const pick = (arr, type, label) =>
      arr
        .filter((x) => x.eng === eng && (!assetId || x.assetId === assetId))
        .map((x) => ({ at: x.createdAt, type, id: x.id, label: label(x) }));

    const events = [
      ...assets,
      ...pick(Object.values(data.vulns), 'vuln', (v) => `${v.title}（${v.level}）`),
      ...pick(Object.values(data.evidence), 'evidence', (e) => e.summary),
      ...pick(data.chains, 'chain', (c) => c.title),
      ...pick(Object.values(data.webshells), 'webshell', (w) => w.url),
      ...pick(Object.values(data.credentials), 'credential', (c) => c.username),
    ];
    return events
      .filter((e) => e.at)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  // ── 更新类（状态流转） ──

  updateVuln(id, patch) {
    const data = this.load();
    const row = data.vulns[id];
    if (!row) throw new Error(`漏洞不存在: ${id}`);
    for (const key of ['title', 'level', 'status', 'request', 'response']) {
      if (patch?.[key] !== undefined) row[key] = patch[key];
    }
    row.updatedAt = new Date().toISOString();
    this.save();
    return row;
  }

  updateWebshell(id, patch) {
    const data = this.load();
    const row = data.webshells[id];
    if (!row) throw new Error(`WebShell 不存在: ${id}`);
    if (patch?.url !== undefined) row.url = patch.url;
    if (patch?.type !== undefined) row.type = patch.type;
    if (patch?.verified !== undefined) row.verified = patch.verified === true;
    row.updatedAt = new Date().toISOString();
    this.save();
    return row;
  }

  updateTunnel(id, patch) {
    const data = this.load();
    const row = data.tunnels[id];
    if (!row) throw new Error(`隧道不存在: ${id}`);
    if (patch?.listen !== undefined) row.listen = patch.listen;
    if (patch?.reachable !== undefined) row.reachable = patch.reachable;
    if (patch?.entryKind !== undefined) row.entryKind = patch.entryKind;
    if (patch?.verified !== undefined) row.verified = patch.verified === true;
    row.updatedAt = new Date().toISOString();
    this.save();
    return row;
  }

  // ── HTTP 证据与截图 ──

  addHttpEvidence(input) {
    const data = this.load();
    const id = this.nextId('evidence');
    const row = {
      id,
      eng: input.eng,
      kind: 'http',
      assetId: input.assetId || '',
      vulnId: input.vulnId || '',
      summary: String(input.summary || input.url || '').trim() || 'HTTP 证据',
      confidence: 'observed',
      url: input.url || '',
      request: input.request || '',
      response: input.response || '',
      verifiedResult: '原始报文已归档',
      createdAt: new Date().toISOString(),
    };
    data.evidence[id] = row;
    this.save();
    return row;
  }

  addShot(input) {
    const data = this.load();
    const id = `P${Date.now().toString(36)}`;
    const row = {
      id,
      eng: input.eng,
      assetId: input.assetId || '',
      vulnId: input.vulnId || '',
      path: String(input.path || '').trim(),
      note: input.note || '',
      createdAt: new Date().toISOString(),
    };
    data.shots.push(row);
    this.save();
    return row;
  }

  listShots(eng) {
    const data = this.load();
    return data.shots.filter((s) => !eng || s.eng === eng);
  }

  deleteShot(id) {
    const data = this.load();
    const before = data.shots.length;
    data.shots = data.shots.filter((s) => s.id !== id);
    const removed = before - data.shots.length;
    if (removed > 0) this.save();
    return { removed };
  }

  // ── 访问会话（P3-4） ──

  addAccess(input) {
    const data = this.load();
    const id = `K${Date.now().toString(36)}`;
    const row = {
      id,
      eng: input.eng,
      host: String(input.host || '').trim(),
      method: String(input.method || 'unknown'),
      username: input.username || '',
      privilege: input.privilege || '',
      assetId: input.assetId || '',
      sessionRef: input.sessionRef || '',
      note: input.note || '',
      foundBy: input.foundBy || '',
      createdAt: new Date().toISOString(),
    };
    data.accesses.push(row);
    this.save();
    return row;
  }

  listAccesses(eng) {
    const data = this.load();
    return data.accesses.filter((a) => !eng || a.eng === eng);
  }

  /** 列出全部演练（跨会话视图） */
  listEngagements() {
    const data = this.load();
    return Object.values(data.engagements).map((e) => ({
      ...e,
      stats: {
        assets: Object.values(data.assets).filter((a) => a.eng === e.id).length,
        vulns: Object.values(data.vulns).filter((v) => v.eng === e.id).length,
        chains: data.chains.filter((c) => c.eng === e.id).length,
        scores: data.scores.filter((s) => s.eng === e.id).length,
      },
    }));
  }

  /** Web 资产（可直接访问的 URL / 带 http 的值） */
  listWeb(eng, limit) {
    const data = this.load();
    const rows = Object.values(data.assets)
      .filter((a) => a.eng === eng)
      .filter(
        (a) =>
          a.kind === 'url' ||
          a.kind === 'service' ||
          /^https?:\/\//i.test(a.value) ||
          (a.port === 80 || a.port === 443 || a.port === 8080 || a.port === 8443),
      );
    return limit ? rows.slice(0, Number(limit)) : rows;
  }

  /** 按域名聚合：主域 → 子域/资产 */
  domainIndex(eng) {
    const data = this.load();
    const assets = Object.values(data.assets).filter((a) => a.eng === eng);
    const map = new Map();
    const baseOf = (value) => {
      const host = String(value || '')
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .split(':')[0];
      const parts = host.split('.');
      if (parts.length <= 2) return host;
      return parts.slice(-2).join('.');
    };
    for (const a of assets) {
      const host = String(a.value || '').replace(/^https?:\/\//i, '').split('/')[0];
      if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
      const base = baseOf(host);
      if (!map.has(base)) map.set(base, { domain: base, hosts: [], ips: new Set() });
      const row = map.get(base);
      if (!row.hosts.includes(host)) row.hosts.push(host);
      if (a.ip) row.ips.add(a.ip);
    }
    return Array.from(map.values()).map((row) => ({
      domain: row.domain,
      hosts: row.hosts,
      ips: Array.from(row.ips),
      count: row.hosts.length,
    }));
  }

  // ── PoC 知识库（P3-3） ──

  addPoc(input) {
    const data = this.load();
    const code = String(input.code || '').trim();
    if (!code) throw new Error('poc code is required');
    if (data.pocs.some((p) => p.code === code)) {
      throw new Error(`PoC code 已存在: ${code}（用 redteam_poc_update 修改）`);
    }
    const row = {
      id: `POC-${Date.now().toString(36)}`,
      eng: input.eng || null,
      code,
      title: String(input.title || code),
      kind: input.kind || 'request',
      category: input.category || '',
      cve: input.cve || '',
      component: input.component || '',
      versions: input.versions || '',
      language: input.language || '',
      source: input.source || 'manual',
      sourceUrl: input.sourceUrl || '',
      content: input.content || '',
      tags: Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
      verified: input.verified === true,
      verifiedNote: input.verifiedNote || '',
      hitCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.pocs.push(row);
    this.save();
    return row;
  }

  /** 列表（默认不含正文，省 token） */
  listPocs(filter = {}) {
    const data = this.load();
    let rows = data.pocs.slice();
    if (filter.kind) rows = rows.filter((p) => p.kind === filter.kind);
    if (filter.category) rows = rows.filter((p) => p.category === filter.category);
    if (filter.cve) rows = rows.filter((p) => p.cve.toLowerCase().includes(String(filter.cve).toLowerCase()));
    if (filter.component) {
      const q = String(filter.component).toLowerCase();
      rows = rows.filter((p) => p.component.toLowerCase().includes(q));
    }
    if (filter.verifiedOnly) rows = rows.filter((p) => p.verified);
    rows.sort((a, b) => b.hitCount - a.hitCount || String(b.createdAt).localeCompare(String(a.createdAt)));
    return rows.map((p) => {
      const { content, ...rest } = p;
      return { ...rest, hasContent: Boolean(content) };
    });
  }

  searchPocs(keyword) {
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return this.listPocs({});
    const data = this.load();
    return data.pocs
      .filter((p) =>
        [p.code, p.title, p.category, p.cve, p.component, p.content, (p.tags || []).join(',')]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
      .map(({ content, ...rest }) => ({ ...rest, hasContent: Boolean(content) }));
  }

  getPoc(idOrCode) {
    const data = this.load();
    const key = String(idOrCode || '').trim();
    return data.pocs.find((p) => p.id === key || p.code === key) || null;
  }

  updatePoc(idOrCode, patch) {
    const data = this.load();
    const row = this.getPoc(idOrCode);
    if (!row) throw new Error(`PoC 不存在: ${idOrCode}`);
    for (const key of [
      'title',
      'kind',
      'category',
      'cve',
      'component',
      'versions',
      'language',
      'source',
      'sourceUrl',
      'content',
      'verifiedNote',
    ]) {
      if (patch?.[key] !== undefined) row[key] = patch[key];
    }
    if (patch?.tags !== undefined) {
      row.tags = Array.isArray(patch.tags)
        ? patch.tags
        : String(patch.tags).split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (patch?.verified !== undefined) row.verified = patch.verified === true;
    row.updatedAt = new Date().toISOString();
    this.save();
    return row;
  }

  /** 记一次复用（hitCount++），高复用条目排前面 */
  usePoc(idOrCode, note) {
    const row = this.getPoc(idOrCode);
    if (!row) throw new Error(`PoC 不存在: ${idOrCode}`);
    row.hitCount = (row.hitCount || 0) + 1;
    row.lastUsedAt = new Date().toISOString();
    if (note) row.lastUsedNote = String(note);
    this.save();
    return row;
  }
}

module.exports = { RedteamDb, EMPTY };
