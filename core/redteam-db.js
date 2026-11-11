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
}

module.exports = { RedteamDb, EMPTY };
