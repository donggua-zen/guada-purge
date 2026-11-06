/* GuaDa Purge — Phase 0 settings placeholder.
 *
 * Contract: plugin frontend artifacts live at frontend/dist/<Component>.js,
 * are IIFE, and register themselves through window.__GuaDaModuleLoader__.
 * Vue is shared from window.__GuaDaShared__.vue (never bundled).
 */
(function () {
  'use strict';

  var shared = window.__GuaDaShared__;
  if (!shared || !shared.vue) {
    console.error('[guada-purge] __GuaDaShared__.vue is missing');
    return;
  }

  var h = shared.vue.h;

  var SettingsPage = {
    name: 'GuadaPurgeSettingsPage',
    setup: function () {
      return function () {
        return h(
          'div',
          { style: { padding: '16px 20px', fontSize: '13px', lineHeight: '1.7' } },
          [
            h('h2', { style: { fontSize: '16px', fontWeight: 600, marginBottom: '8px' } }, 'GuaDa Purge'),
            h(
              'p',
              { style: { opacity: 0.75 } },
              'Phase 0 skeleton: prompt / rules / skills console will land in Phase 1.',
            ),
          ],
        );
      };
    },
  };

  if (!window.__GuaDaModuleLoader__) {
    console.error('[guada-purge] __GuaDaModuleLoader__ is missing');
    return;
  }
  window.__GuaDaModuleLoader__.register('guada-purge:SettingsPage', { default: SettingsPage });
})();
