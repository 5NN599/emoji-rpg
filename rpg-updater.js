/*
 * 이모지 RPG 자동 업데이트 감지기
 *
 * index.html의 </body> 바로 위에:
 *
 * <script src="./rpg-updater.js"></script>
 *
 * 를 추가하면 된다.
 */
(function () {
  'use strict';

  if (window.__RPG_AUTO_UPDATER__) return;
  window.__RPG_AUTO_UPDATER__ = true;

  const CHECK_INTERVAL = 45 * 1000;
  const START_DELAY = 8 * 1000;
  const REQUEST_TIMEOUT = 12000;
  const UPDATE_QUERY = '__rpg_update';

  let baselineSignature = '';
  let updatePending = false;
  let updateInfo = null;
  let checking = false;
  let pollTimer = null;
  let ui = null;
  let reloadInProgress = false;

  function pageUrl() {
    const u = new URL(location.href);
    u.hash = '';
    u.search = '';

    if (u.pathname.endsWith('/')) {
      u.pathname += 'index.html';
    }

    return u;
  }

  function updaterUrl() {
    const scripts = Array.from(document.scripts || []);

    const found = scripts.find(function (s) {
      return /(?:^|\/)rpg-updater\.js(?:[?#]|$)/i.test(s.src);
    });

    if (found && found.src) {
      const u = new URL(found.src, location.href);
      u.hash = '';
      u.search = '';
      return u;
    }

    const u = new URL('./rpg-updater.js', location.href);
    u.hash = '';
    u.search = '';
    return u;
  }

  function cacheBust(u) {
    const x = new URL(u.toString());

    x.searchParams.set(
      '_rpg_check',
      String(Date.now()) + '_' +
      Math.random().toString(36).slice(2, 8)
    );

    return x;
  }

  async function fetchText(url) {
    const controller = new AbortController();

    const timer = setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT);

    try {
      const res = await fetch(cacheBust(url).toString(), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          'Cache-Control': 'no-cache, no-store, max-age=0'
        },
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }

      return await res.text();

    } finally {
      clearTimeout(timer);
    }
  }

  async function digest(text) {
    const input = new TextEncoder().encode(String(text));

    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', input);

      return Array.from(
        new Uint8Array(buf),
        function (b) {
          return b.toString(16).padStart(2, '0');
        }
      ).join('');
    }

    // 구형 브라우저용 fallback
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;

    for (let i = 0; i < input.length; i++) {
      h1 ^= input[i];
      h1 = Math.imul(h1, 16777619);

      h2 ^= input[i] + i;
      h2 = Math.imul(h2, 2246822519);
      h2 = (h2 << 13) | (h2 >>> 19);
    }

    return (
      (h1 >>> 0).toString(16).padStart(8, '0') +
      (h2 >>> 0).toString(16).padStart(8, '0') +
      String(input.length)
    );
  }

  async function makeSignature() {
    const results = await Promise.all([
      fetchText(pageUrl()),
      fetchText(updaterUrl())
    ]);

    const html = results[0];
    const updater = results[1];

    const htmlHash = await digest(html);
    const updaterHash = await digest(updater);

    return {
      value: htmlHash + ':' + updaterHash,
      htmlHash: htmlHash,
      updaterHash: updaterHash,
      checkedAt: Date.now()
    };
  }

  function gameActive() {
    const game = document.getElementById('game');

    return !!(
      game &&
      !game.hidden
    );
  }

  function lobbyVisible() {
    const lobby = document.getElementById('lobby');

    return !!(
      lobby &&
      !lobby.hidden
    );
  }

  function safeToUpdate() {
    return !gameActive() || lobbyVisible();
  }

  function ensureUi() {
    if (ui && ui.isConnected) {
      return ui;
    }

    const box = document.createElement('div');

    box.id = 'rpgAutoUpdateNotice';

    box.innerHTML = [
      '<div class="rpgAutoUpdateCard">',

      '  <div class="rpgAutoUpdateIcon">🔄</div>',

      '  <div class="rpgAutoUpdateMain">',

      '    <div class="rpgAutoUpdateTitle">',
      '      새 게임 업데이트가 있어!',
      '    </div>',

      '    <div class="rpgAutoUpdateText" id="rpgAutoUpdateText"></div>',

      '    <div class="rpgAutoUpdateActions">',
      '      <button type="button" id="rpgAutoUpdateNow">',
      '        지금 업데이트',
      '      </button>',

      '      <button type="button" id="rpgAutoUpdateLater">',
      '        나중에',
      '      </button>',
      '    </div>',

      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(box);

    ui = box;

    box.querySelector('#rpgAutoUpdateNow')
      .addEventListener('click', function () {
        applyUpdate(true);
      });

    box.querySelector('#rpgAutoUpdateLater')
      .addEventListener('click', function () {
        hideUi();
      });

    return box;
  }

  function showUi(text, force) {
    const box = ensureUi();

    const textEl =
      box.querySelector('#rpgAutoUpdateText');

    if (textEl) {
      textEl.textContent = text;
    }

    box.classList.add('show');

    const now =
      box.querySelector('#rpgAutoUpdateNow');

    if (now) {
      now.textContent =
        force
          ? '지금 업데이트'
          : (
              safeToUpdate()
                ? '지금 업데이트'
                : '게임 종료 후 업데이트'
            );
    }
  }

  function hideUi() {
    if (ui) {
      ui.classList.remove('show');
    }
  }

  function showUpdatePending() {
    updatePending = true;

    updateInfo =
      updateInfo ||
      {};

    if (safeToUpdate()) {
      showUi(
        '최신 버전으로 바꿀 준비가 됐어. 업데이트하면 페이지를 한 번만 다시 불러와.',
        false
      );
    } else {
      showUi(
        '지금 게임 중이라 안전하게 대기 중이야. 게임을 나가면 자동으로 최신 버전으로 바뀌어.',
        false
      );
    }
  }

  function showErrorBrief() {
    // 네트워크 오류는 게임을 방해하지 않도록 표시하지 않는다.
  }

  async function initialCheck() {
    try {
      const sig = await makeSignature();

      baselineSignature = sig.value;
      updateInfo = sig;

      return true;

    } catch (_) {
      baselineSignature = '';
      showErrorBrief();

      return false;
    }
  }

  async function checkForUpdate() {
    if (checking || reloadInProgress) {
      return false;
    }

    checking = true;

    try {
      const sig = await makeSignature();

      if (!baselineSignature) {
        baselineSignature = sig.value;
        updateInfo = sig;

        return false;
      }

      if (sig.value !== baselineSignature) {
        updateInfo = sig;

        showUpdatePending();

        return true;
      }

      return false;

    } catch (_) {
      showErrorBrief();

      return false;

    } finally {
      checking = false;
    }
  }

  function cleanUpdateQuery() {
    try {
      const u = new URL(location.href);

      if (u.searchParams.has(UPDATE_QUERY)) {
        u.searchParams.delete(UPDATE_QUERY);

        history.replaceState(
          history.state,
          document.title,
          u.pathname +
          (u.search ? u.search : '') +
          u.hash
        );
      }

    } catch (_) {}
  }

  function updateUrl() {
    const u = pageUrl();

    u.searchParams.set(
      UPDATE_QUERY,
      String(Date.now())
    );

    return u.toString();
  }

  async function applyUpdate(userRequested) {
    if (reloadInProgress) {
      return;
    }

    if (
      gameActive() &&
      !lobbyVisible() &&
      userRequested
    ) {
      const ok = window.confirm(
        '지금 게임을 종료하고 최신 업데이트를 적용할까?\n' +
        '현재 방 연결이 끊길 수 있어.'
      );

      if (!ok) {
        return;
      }

    } else if (
      gameActive() &&
      !lobbyVisible()
    ) {
      return;
    }

    reloadInProgress = true;

    hideUi();

    try {
      // 최신 HTML이 실제로 내려오는지 확인
      await fetchText(pageUrl());
    } catch (_) {
      // 직접 업데이트를 누른 경우에는 계속 새로고침 시도
    }

    location.replace(updateUrl());
  }

  function startPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
    }

    pollTimer = setInterval(
      checkForUpdate,
      CHECK_INTERVAL
    );
  }

  function watchGameVisibility() {
    const game =
      document.getElementById('game');

    if (
      !game ||
      !window.MutationObserver
    ) {
      return;
    }

    const observer =
      new MutationObserver(function () {

        if (
          updatePending &&
          lobbyVisible()
        ) {
          setTimeout(function () {
            applyUpdate(false);
          }, 250);

        } else if (updatePending) {
          showUpdatePending();
        }

      });

    observer.observe(
      game,
      {
        attributes: true,
        attributeFilter: [
          'hidden',
          'style',
          'class'
        ]
      }
    );
  }

  function bindLifecycleHooks() {
    window.addEventListener(
      'online',
      function () {
        checkForUpdate();
      }
    );

    document.addEventListener(
      'visibilitychange',
      function () {
        if (
          document.visibilityState ===
          'visible'
        ) {
          checkForUpdate();
        }
      }
    );

    window.addEventListener(
      'focus',
      function () {
        checkForUpdate();
      }
    );
  }

  function addStyle() {
    if (
      document.getElementById(
        'rpgAutoUpdateStyle'
      )
    ) {
      return;
    }

    const style =
      document.createElement('style');

    style.id = 'rpgAutoUpdateStyle';

    style.textContent = `
      #rpgAutoUpdateNotice{
        position:fixed;
        right:16px;
        top:16px;
        z-index:15000;
        width:min(420px,calc(100vw - 32px));
        display:none;
        pointer-events:none;
      }

      #rpgAutoUpdateNotice.show{
        display:block;
      }

      #rpgAutoUpdateNotice
      .rpgAutoUpdateCard{
        pointer-events:auto;
        display:flex;
        gap:11px;
        align-items:flex-start;
        padding:12px;
        border:1px solid var(--line,#d8deeb);
        border-radius:14px;
        background:color-mix(
          in srgb,
          var(--card,#fff) 96%,
          transparent
        );
        color:var(--fg,#1b2033);
        box-shadow:
          0 14px 36px rgba(0,0,0,.22);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
        font-family:inherit;
      }

      #rpgAutoUpdateNotice
      .rpgAutoUpdateIcon{
        font-size:26px;
        line-height:1;
        padding-top:1px;
      }

      #rpgAutoUpdateNotice
      .rpgAutoUpdateMain{
        min-width:0;
        flex:1;
      }

      #rpgAutoUpdateNotice
      .rpgAutoUpdateTitle{
        font-weight:800;
        font-size:14px;
      }

      #rpgAutoUpdateNotice
      .rpgAutoUpdateText{
        margin-top:3px;
        font-size:12px;
        line-height:1.45;
        color:var(--sub,#65708f);
      }

      #rpgAutoUpdateNotice
      .rpgAutoUpdateActions{
        display:flex;
        gap:6px;
        margin-top:9px;
      }

      #rpgAutoUpdateNotice
      .rpgAutoUpdateActions button{
        min-height:34px;
        padding:6px 9px;
        border-radius:8px;
        border:1px solid var(--line,#d8deeb);
        background:var(--bg,#f5f7fb);
        color:var(--fg,#1b2033);
        font-weight:700;
        cursor:pointer;
      }

      #rpgAutoUpdateNotice
      .rpgAutoUpdateActions
      button:first-child{
        background:var(--acc,#2f68d8);
        color:var(--btnfg,#fff);
        border-color:var(--acc,#2f68d8);
      }

      @media(max-width:560px){
        #rpgAutoUpdateNotice{
          right:10px;
          top:10px;
          width:calc(100vw - 20px);
        }
      }
    `;

    document.head.appendChild(style);
  }

  async function boot() {
    cleanUpdateQuery();

    addStyle();

    await initialCheck();

    watchGameVisibility();

    bindLifecycleHooks();

    startPolling();

    setTimeout(
      checkForUpdate,
      START_DELAY
    );
  }

  window.RPGUpdater = {
    check: checkForUpdate,

    update: function () {
      return applyUpdate(true);
    },

    isPending: function () {
      return updatePending;
    },

    getInfo: function () {
      return updateInfo
        ? { ...updateInfo }
        : null;
    }
  };

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      boot,
      { once: true }
    );
  } else {
    boot();
  }

})();
