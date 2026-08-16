/**
 * Fullscreen overlay helper: injects a floating "exit fullscreen" button into
 * the renderer, so fullscreen can always be exited from the top-right corner.
 * The button clicks through to `window.dshDesktop.setFullscreen(false)`, which
 * the preload bridges to the main process over IPC.
 */

const FULLSCREEN_BTN_ID = '__dsh_fullscreen_exit__';

/**
 * Build the renderer-side script that (re)creates the overlay button and sets
 * its visibility. Safe to call repeatedly — the button is created once and
 * then just shown/hidden.
 *
 * @param {boolean} visible  show (true) or hide (false) the button
 * @param {string}  label    button text (localized by the caller)
 */
function buildOverlayScript(visible, label) {
  return `(function () {
    var id = ${JSON.stringify(FULLSCREEN_BTN_ID)};
    var btn = document.getElementById(id);
    if (!btn) {
      btn = document.createElement('div');
      btn.id = id;
      btn.textContent = ${JSON.stringify(label)};
      btn.setAttribute('style',
        'position:fixed;top:12px;right:12px;z-index:2147483647;' +
        'background:rgba(20,22,28,0.82);color:#fff;padding:8px 16px;' +
        'border-radius:8px;font:13px "Microsoft YaHei","Segoe UI",sans-serif;' +
        'cursor:pointer;display:none;box-shadow:0 2px 10px rgba(0,0,0,0.45);' +
        'border:1px solid rgba(255,255,255,0.18);user-select:none;');
      btn.addEventListener('click', function () {
        if (window.dshDesktop && window.dshDesktop.setFullscreen) {
          window.dshDesktop.setFullscreen(false);
        }
      });
      (document.body || document.documentElement).appendChild(btn);
    }
    btn.style.display = ${visible ? "'block'" : "'none'"};
  })();`;
}

module.exports = { FULLSCREEN_BTN_ID, buildOverlayScript };
