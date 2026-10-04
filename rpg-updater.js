/* Emoji RPG automatic updater v5
 * - Does not depend on version.json when index.html has rpg-build-version.
 * - HTML build marker is authoritative.
 * - Cache-busts every check.
 * - Works on older game versions too, as long as this file is loaded.
 */
(function(){
  'use strict';

  if(window.__RPG_AUTO_UPDATER_V5__) return;
  window.__RPG_AUTO_UPDATER_V5__=true;

  const CHECK_MS=30000;
  const START_DELAY=1500;
  const UPDATE_QUERY='_rpg_update';

  let localVersion='0';
  let remoteVersion='0';
  let busy=false;
  let notice=null;

  const num=v=>{
    const m=String(v??'').match(/\d+(?:\.\d+)*/);
    return m?parseFloat(m[0]):0;
  };

  function baseIndex(){
    const u=new URL(location.href);
    u.hash='';
    u.search='';

    if(u.pathname.endsWith('/')){
      u.pathname+='index.html';
    }

    return u;
  }

  function bust(input){
    const u=new URL(input,location.href);

    u.searchParams.set(
      '_rpg_check',
      Date.now().toString(36)+'_'+
      Math.random().toString(36).slice(2,9)
    );

    return u.toString();
  }

  function readLocal(){
    const m=document.querySelector(
      'meta[name="rpg-build-version"]'
    );

    const a=m
      ? String(m.getAttribute('content')||'')
      : '0';

    const b=String(
      window.__RPG_BUILD_VERSION__||'0'
    );

    localVersion=String(
      Math.max(
        num(a),
        num(b)
      )||0
    );
  }

  async function fetchRemoteHtml(){
    const r=await fetch(
      bust(baseIndex()),
      {
        cache:'no-store',
        credentials:'same-origin',
        headers:{
          'Cache-Control':'no-cache, no-store, max-age=0'
        }
      }
    );

    if(!r.ok){
      throw new Error(
        'index HTTP '+r.status
      );
    }

    const h=await r.text();

    const m=
      h.match(
        /<meta[^>]+name=["']rpg-build-version["'][^>]+content=["']([^"']+)["'][^>]*>/i
      )
      ||
      h.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']rpg-build-version["'][^>]*>/i
      );

    if(!m){
      throw new Error(
        'build marker missing'
      );
    }

    return String(m[1]);
  }

  async function fetchRemote(){
    try{
      return await fetchRemoteHtml();
    }catch(_e){}

    const r=await fetch(
      bust('./version.json'),
      {
        cache:'no-store',
        credentials:'same-origin',
        headers:{
          'Cache-Control':'no-cache, no-store, max-age=0'
        }
      }
    );

    if(!r.ok){
      throw new Error(
        'version.json HTTP '+r.status
      );
    }

    const x=await r.json();

    if(!x || x.version==null){
      throw new Error(
        'version missing'
      );
    }

    return String(x.version);
  }

  function style(){
    if(
      document.getElementById(
        'rpgUpdateStyleV5'
      )
    ) return;

    const st=document.createElement('style');
    st.id='rpgUpdateStyleV5';

    st.textContent=`
      #rpgUpdateNoticeV5{
        position:fixed;
        inset:0;
        z-index:2147483647;
        display:none;
        align-items:center;
        justify-content:center;
        padding:18px;
        background:rgba(8,14,28,.34);
        backdrop-filter:blur(3px);
        font-family:system-ui,-apple-system,Segoe UI,sans-serif
      }

      #rpgUpdateNoticeV5.show{
        display:flex
      }

      #rpgUpdateNoticeV5 .card{
        background:#fff;
        border:2px solid #2d69d7;
        border-radius:18px;
        box-shadow:0 20px 60px rgba(0,0,0,.28);
        padding:18px;
        width:min(430px,100%);
        display:flex;
        gap:12px;
        align-items:flex-start;
        color:#17233b
      }

      #rpgUpdateNoticeV5 .icon{
        font-size:26px;
        line-height:1
      }

      #rpgUpdateNoticeV5 .body{
        flex:1;
        min-width:0
      }

      .rpgV5Txt{
        margin-top:5px;
        color:#53627a;
        font-size:12px;
        line-height:1.45
      }

      #rpgUpdateNoticeV5 .actions{
        display:flex;
        gap:7px;
        margin-top:10px
      }

      #rpgUpdateNoticeV5 button{
        border:0;
        border-radius:9px;
        padding:8px 11px;
        font-weight:800;
        cursor:pointer
      }

      #rpgUpdateNoticeV5 .now{
        background:#2d69d7;
        color:#fff
      }

      .rpgV5Later{
        background:#eef2f7;
        color:#31405a
      }

      @media(max-width:560px){
        #rpgUpdateNoticeV5{
          padding:12px
        }
      }
    `;

    document.head.appendChild(st);
  }

  function ensure(){
    if(
      notice &&
      notice.isConnected
    ){
      return notice;
    }

    notice=document.createElement('div');
    notice.id='rpgUpdateNoticeV5';

    notice.innerHTML=
      '<div class="card">'+
        '<div class="icon">🔄</div>'+
        '<div class="body">'+
          '<b>새 게임 업데이트가 있어!</b>'+
          '<div class="rpgV5Txt" id="rpgUpdateTextV5"></div>'+
          '<div class="actions">'+
            '<button class="now" id="rpgUpdateNowV5">'+
              '지금 업데이트'+
            '</button>'+
            '<button class="rpgV5Later" id="rpgUpdateLaterV5">'+
              '나중에'+
            '</button>'+
          '</div>'+
        '</div>'+
      '</div>';

    document.body.appendChild(notice);

    notice.querySelector(
      '#rpgUpdateNowV5'
    ).onclick=reload;

    notice.querySelector(
      '#rpgUpdateLaterV5'
    ).onclick=()=>{
      notice.classList.remove('show');
    };

    return notice;
  }

  function show(){
    if(window.__RPG_PREFLIGHT_UPDATE__){
      return;
    }

    const el=ensure();
    const t=el.querySelector(
      '#rpgUpdateTextV5'
    );

    if(t){
      t.textContent=
        `현재 v${localVersion} → 최신 v${remoteVersion}. 최신 버전으로 업데이트할 수 있어.`;
    }

    el.classList.add('show');
  }

  function reload(){
    const u=baseIndex();

    u.searchParams.set(
      UPDATE_QUERY,
      String(Date.now())
    );

    location.replace(
      u.toString()
    );
  }

  async function check(){
    if(busy){
      return false;
    }

    busy=true;

    try{
      readLocal();

      remoteVersion=
        await fetchRemote();

      if(
        num(remoteVersion)>
        num(localVersion)
      ){
        show();
        return true;
      }

      return false;

    }catch(_e){
      return false;

    }finally{
      busy=false;
    }
  }

  function boot(){
    readLocal();
    style();

    setTimeout(
      check,
      START_DELAY
    );

    setInterval(
      check,
      CHECK_MS
    );

    window.RPGUpdater={
      check,
      update:reload,
      getVersions:()=>({
        local:localVersion,
        remote:remoteVersion,
        pending:
          num(remoteVersion)>
          num(localVersion)
      })
    };
  }

  if(document.readyState==='loading'){
    document.addEventListener(
      'DOMContentLoaded',
      boot,
      {once:true}
    );
  }else{
    boot();
  }
})();
