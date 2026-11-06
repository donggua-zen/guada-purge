'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GuadaPurgePlugin = require('../index');

function makeApi(dataDir) {
  const calls = {
    nls: [],
    slots: [],
    sections: [],
    skills: [],
    tools: [],
    rpcs: {},
  };
  const api = {
    calls,
    getDataDir: () => dataDir,
    getPluginDir: () => path.join(__dirname, '..'),
    registerNls: (locale) => calls.nls.push(locale),
    registerSlot: (reg) => calls.slots.push(reg),
    registerPromptSection: (def) => calls.sections.push(def),
    registerSkill: (def) => calls.skills.push(def),
    registerTool: (def) => calls.tools.push(def),
    registerRpc: (methods) => Object.assign(calls.rpcs, methods),
  };
  return api;
}

test('onLoad registers prompt sections, skills, tools and rpc', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-purge-plugin-'));
  try {
    const plugin = new GuadaPurgePlugin();
    const api = makeApi(dataDir);
    await plugin.onLoad(api);

    assert.deepEqual(api.calls.nls.sort(), ['en', 'zh']);
    assert.equal(api.calls.slots.length, 1);
    assert.equal(api.calls.slots[0].name, 'settings');
    assert.equal(api.calls.sections.length, 2);
    assert.ok(api.calls.sections.find((s) => s.name === 'guada-purge.persona'));
    assert.ok(api.calls.sections.find((s) => s.name === 'guada-purge.rules'));
    assert.equal(api.calls.skills.length, 6);
    assert.deepEqual(
      api.calls.tools.map((t) => t.name).sort(),
      ['purge_apply', 'purge_revert', 'purge_status'],
    );
    for (const m of ['get_state', 'save_persona', 'save_prompt', 'list_rules', 'set_rule']) {
      assert.equal(typeof api.calls.rpcs[m], 'function', `rpc ${m}`);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('persona precedence and rule matching flow through prompt sections', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-purge-plugin-'));
  try {
    const plugin = new GuadaPurgePlugin();
    const api = makeApi(dataDir);
    await plugin.onLoad(api);

    const persona = api.calls.sections.find((s) => s.name === 'guada-purge.persona');
    const rules = api.calls.sections.find((s) => s.name === 'guada-purge.rules');
    const ctx = { session: { workspacePath: 'D:/work/frontend/app' } };

    assert.equal(persona.text(ctx), '');

    await api.calls.rpcs.save_persona({ persona: 'P1' });
    assert.equal(persona.text(ctx), 'P1');

    await api.calls.rpcs.save_prompt({ text: 'P2' });
    assert.equal(persona.text(ctx), 'P2');

    const text = rules.text(ctx);
    assert.match(text, /前端工作约定/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('tools apply and revert update revision and snapshots', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-purge-plugin-'));
  try {
    const plugin = new GuadaPurgePlugin();
    const api = makeApi(dataDir);
    await plugin.onLoad(api);

    const apply = api.calls.tools.find((t) => t.name === 'purge_apply');
    const revert = api.calls.tools.find((t) => t.name === 'purge_revert');

    const applied = await apply.execute({ persona: 'X' });
    assert.match(applied.content, /revision=1/);

    const reverted = await revert.execute({});
    assert.match(reverted.content, /回滚/);
    assert.equal((await api.calls.rpcs.get_state()).state.active.persona, '');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
