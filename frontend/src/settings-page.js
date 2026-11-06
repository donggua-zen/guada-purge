/* GuaDa Purge — Settings page (render-function component, no build needed).
 *
 * Contract: IIFE, registers through window.__GuaDaModuleLoader__.
 * Vue is shared from window.__GuaDaShared__.vue; RPC goes through
 * window.__GuaDaShared__.pluginApi.call('guada-purge', method, args).
 */
(function () {
  'use strict';

  var shared = window.__GuaDaShared__;
  if (!shared || !shared.vue || !shared.pluginApi) {
    console.error('[guada-purge] shared runtime is missing');
    return;
  }

  var h = shared.vue.h;
  var ref = shared.vue.ref;
  var reactive = shared.vue.reactive;
  var onMounted = shared.vue.onMounted;
  var computed = shared.vue.computed;

  var PLUGIN_ID = 'guada-purge';

  var S = {
    root: { padding: '16px 20px', fontSize: '13px', lineHeight: '1.65', color: 'var(--gd-color-text)' },
    title: { fontSize: '16px', fontWeight: 600, margin: '0 0 4px' },
    desc: { margin: '0 0 14px', opacity: 0.7 },
    tabs: { display: 'flex', gap: '6px', marginBottom: '14px', borderBottom: '1px solid var(--gd-color-border, rgba(127,127,127,.25))', paddingBottom: '8px' },
    tab: { padding: '5px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'inherit', fontSize: '13px' },
    tabActive: { background: 'var(--gd-color-sidebar-bg-hover, rgba(127,127,127,.18))', fontWeight: 600 },
    card: { border: '1px solid var(--gd-color-border, rgba(127,127,127,.25))', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px' },
    label: { display: 'block', fontWeight: 600, marginBottom: '6px' },
    hint: { opacity: 0.65, fontSize: '12px', margin: '4px 0 8px' },
    textarea: { width: '100%', minHeight: '110px', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--gd-color-border, rgba(127,127,127,.35))', background: 'var(--gd-color-secondary-surface, transparent)', color: 'inherit', fontFamily: 'inherit', fontSize: '13px', resize: 'vertical' },
    input: { width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: '8px', border: '1px solid var(--gd-color-border, rgba(127,127,127,.35))', background: 'var(--gd-color-secondary-surface, transparent)', color: 'inherit', fontFamily: 'inherit', fontSize: '13px' },
    row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' },
    btn: { padding: '5px 12px', borderRadius: '8px', border: '1px solid var(--gd-color-border, rgba(127,127,127,.35))', background: 'var(--gd-color-secondary-surface, transparent)', color: 'inherit', cursor: 'pointer', fontSize: '13px' },
    btnPrimary: { padding: '5px 12px', borderRadius: '8px', border: '1px solid transparent', background: 'var(--gd-color-primary, #2563eb)', color: '#fff', cursor: 'pointer', fontSize: '13px' },
    btnDanger: { padding: '5px 12px', borderRadius: '8px', border: '1px solid transparent', background: 'transparent', color: 'var(--gd-color-danger, #dc2626)', cursor: 'pointer', fontSize: '13px' },
    statusRow: { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '5px 0', borderBottom: '1px dashed var(--gd-color-border, rgba(127,127,127,.2))' },
    badge: function (status) {
      var color = status === 'applied' ? '#16a34a' : status === 'failed' ? '#dc2626' : '#9ca3af';
      return { color: color, fontWeight: 600 };
    },
    err: { color: 'var(--gd-color-danger, #dc2626)', marginBottom: '10px' },
    muted: { opacity: 0.65 },
  };

  var SettingsPage = {
    name: 'GuadaPurgeSettingsPage',
    setup: function () {
      var tab = ref('status');
      var loading = ref(true);
      var error = ref('');
      var snapshot = ref(null);
      var status = ref(null);
      var ruleData = ref({ rules: [], selected: null });
      var personaDraft = ref('');
      var promptDraft = ref('');
      var newRule = reactive({ id: '', name: '', paths: '', content: '' });
      var saving = ref(false);

      function call(method, args) {
        return shared.pluginApi.call(PLUGIN_ID, method, args);
      }

      function refresh() {
        loading.value = true;
        error.value = '';
        return Promise.all([
          call('get_state'),
          call('get_status'),
          call('list_rules'),
        ])
          .then(function (res) {
            snapshot.value = res[0];
            status.value = res[1];
            ruleData.value = res[2] || { rules: [], selected: null };
            personaDraft.value = (res[0] && res[0].state && res[0].state.active.persona) || '';
            promptDraft.value = (res[0] && res[0].promptInject) || '';
          })
          .catch(function (e) {
            error.value = String((e && e.message) || e);
          })
          .then(function () {
            loading.value = false;
          });
      }

      function savePersona() {
        saving.value = true;
        call('save_persona', { persona: personaDraft.value })
          .then(refresh)
          .catch(function (e) { error.value = String((e && e.message) || e); })
          .then(function () { saving.value = false; });
      }

      function savePrompt() {
        saving.value = true;
        call('save_prompt', { text: promptDraft.value })
          .then(refresh)
          .catch(function (e) { error.value = String((e && e.message) || e); })
          .then(function () { saving.value = false; });
      }

      function selectRule(id) {
        call('set_rule', { id: id || '' }).then(refresh).catch(function (e) {
          error.value = String((e && e.message) || e);
        });
      }

      function createRule() {
        saving.value = true;
        call('create_rule', {
          id: newRule.id,
          name: newRule.name || newRule.id,
          paths: newRule.paths,
          content: newRule.content,
        })
          .then(function () {
            newRule.id = '';
            newRule.name = '';
            newRule.paths = '';
            newRule.content = '';
            return refresh();
          })
          .catch(function (e) { error.value = String((e && e.message) || e); })
          .then(function () { saving.value = false; });
      }

      function deleteRule(id) {
        call('delete_rule', { id: id }).then(refresh).catch(function (e) {
          error.value = String((e && e.message) || e);
        });
      }

      function revisionLabel() {
        if (!status.value) return '';
        return 'revision=' + status.value.revision + ' · snapshots=' + status.value.snapshots;
      }

      onMounted(refresh);

      return function () {
        var tabs = [
          ['status', '状态'],
          ['prompt', '提示词'],
          ['rules', '规则集'],
        ];

        var children = [
          h('h2', { style: S.title }, 'GuaDa Purge'),
          h('p', { style: S.desc }, '人格 / 规则集 / 技能库控制台。提示词与规则在下一轮对话生效。'),
        ];

        if (error.value) children.push(h('div', { style: S.err }, error.value));

        children.push(
          h(
            'div',
            { style: S.tabs },
            tabs.map(function (t) {
              return h(
                'button',
                {
                  key: t[0],
                  style: Object.assign({}, S.tab, tab.value === t[0] ? S.tabActive : {}),
                  onClick: function () { tab.value = t[0]; },
                },
                t[1],
              );
            }),
          ),
        );

        if (loading.value) {
          children.push(h('div', { style: S.muted }, 'Loading…'));
        } else if (tab.value === 'status') {
          children.push(
            h('div', { style: S.card }, [
              h('div', { style: S.row }, [
                h('strong', null, '运行状态'),
                h('span', { style: S.muted }, revisionLabel()),
              ]),
              status.value && status.value.rows
                ? status.value.rows.map(function (row) {
                    return h('div', { key: row.group }, [
                      h('div', { style: { marginTop: '8px', fontWeight: 600, opacity: 0.8 } }, row.group),
                      row.entries.map(function (e) {
                        return h('div', { key: e.id, style: S.statusRow }, [
                          h('span', null, e.label),
                          h('span', null, [
                            h('span', { style: S.badge(e.status) }, e.status),
                            e.detail ? h('span', { style: Object.assign({}, S.muted, { marginLeft: '8px' }) }, e.detail) : null,
                          ]),
                        ]);
                      }),
                    ]);
                  })
                : null,
            ]),
          );
        } else if (tab.value === 'prompt') {
          children.push(
            h('div', { style: S.card }, [
              h('label', { style: S.label }, '人格 / 提示词（persona）'),
              h('div', { style: S.hint }, '写入插件数据目录的 state 快照；适合放长期稳定的角色设定。'),
              h('textarea', {
                style: S.textarea,
                value: personaDraft.value,
                onInput: function (e) { personaDraft.value = e.target.value; },
              }),
              h('div', { style: S.row }, [
                h('button', { style: S.btnPrimary, disabled: saving.value, onClick: savePersona }, '保存人格'),
              ]),
            ]),
            h('div', { style: S.card }, [
              h('label', { style: S.label }, 'prompt-inject.md（优先级最高）'),
              h('div', { style: S.hint }, '非空时覆盖上方人格文本；适合临时指令/实验。清空即回退到人格文本。'),
              h('textarea', {
                style: S.textarea,
                value: promptDraft.value,
                onInput: function (e) { promptDraft.value = e.target.value; },
              }),
              h('div', { style: S.row }, [
                h('button', { style: S.btnPrimary, disabled: saving.value, onClick: savePrompt }, '保存注入文件'),
              ]),
            ]),
          );
        } else {
          children.push(
            h('div', { style: S.card }, [
              h('label', { style: S.label }, '规则集'),
              h('div', { style: S.hint }, '不选 = 按当前工作目录自动匹配 paths；选中 = 只注入该文件。'),
              h('div', { style: S.row }, [
                h('button', { style: S.btn, onClick: function () { selectRule(''); } }, '自动匹配'),
              ]),
              (ruleData.value.rules || []).map(function (r) {
                var active = ruleData.value.selected === r.id;
                return h('div', { key: r.id, style: S.statusRow }, [
                  h('span', null, [
                    h('strong', null, r.name + ' '),
                    h('span', { style: S.muted }, '(' + r.id + (r.paths && r.paths.length ? ' · ' + r.paths.join(', ') : ' · 全局') + ')'),
                  ]),
                  h('span', null, [
                    h('button', { style: S.btnPrimary, onClick: function () { selectRule(r.id); } }, active ? '已启用' : '启用'),
                    h('button', { style: S.btnDanger, onClick: function () { deleteRule(r.id); } }, '删除'),
                  ]),
                ]);
              }),
            ]),
            h('div', { style: S.card }, [
              h('label', { style: S.label }, '新建规则'),
              h('div', { style: S.row }, [
                h('input', { style: S.input, placeholder: 'id（文件名，如 api）', value: newRule.id, onInput: function (e) { newRule.id = e.target.value; } }),
                h('input', { style: S.input, placeholder: '名称', value: newRule.name, onInput: function (e) { newRule.name = e.target.value; } }),
              ]),
              h('div', { style: S.row }, [
                h('input', { style: S.input, placeholder: 'paths（逗号分隔，留空=全局）', value: newRule.paths, onInput: function (e) { newRule.paths = e.target.value; } }),
              ]),
              h('textarea', {
                style: Object.assign({}, S.textarea, { marginTop: '8px' }),
                placeholder: '规则正文……',
                value: newRule.content,
                onInput: function (e) { newRule.content = e.target.value; },
              }),
              h('div', { style: S.row }, [
                h('button', { style: S.btnPrimary, disabled: saving.value, onClick: createRule }, '创建'),
              ]),
            ]),
          );
        }

        return h('div', { style: S.root }, children);
      };
    },
  };

  if (!window.__GuaDaModuleLoader__) {
    console.error('[guada-purge] __GuaDaModuleLoader__ is missing');
    return;
  }
  window.__GuaDaModuleLoader__.register('guada-purge:SettingsPage', { default: SettingsPage });
})();
