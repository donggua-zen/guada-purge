'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createState, parseState, applyPatch, revertTo } = require('./state');

test('createState starts empty', () => {
  const s = createState();
  assert.equal(s.revision, 0);
  assert.deepEqual(s.active, { persona: '', ruleSet: null, skills: true });
  assert.deepEqual(s.snapshots, []);
});

test('parseState tolerates bad json', () => {
  const bad = parseState('{oops');
  assert.equal(bad.corrupted, true);
  assert.equal(bad.state.revision, 0);

  const ok = parseState('{"revision":3,"active":{"persona":"x"},"snapshots":[]}');
  assert.equal(ok.corrupted, false);
  assert.equal(ok.state.active.persona, 'x');
  assert.equal(ok.state.active.skills, true);
});

test('applyPatch snapshots previous active and bumps revision', () => {
  let s = createState();
  s = applyPatch(s, { persona: 'p1' }, 'set-persona');
  assert.equal(s.revision, 1);
  assert.equal(s.active.persona, 'p1');
  assert.equal(s.snapshots.length, 1);
  assert.equal(s.snapshots[0].revision, 0);
  assert.equal(s.snapshots[0].label, 'set-persona');
});

test('revertTo restores a snapshot', () => {
  let s = createState();
  s = applyPatch(s, { persona: 'p1' });
  s = applyPatch(s, { persona: 'p2' });
  s = revertTo(s, 0);
  assert.equal(s.active.persona, '');
  assert.ok(s.snapshots.length >= 3);
});
