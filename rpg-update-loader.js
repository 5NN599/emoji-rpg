/* Emoji RPG preflight updater v1
 * Loaded near the start of index.html so future builds can check for an update
 * before the main game starts. This is intentionally tiny and independent of
 * the game updater UI.
 */
(function(){
  'use strict';
  if(window.__RPG_PREFLIGHT_LOADER_V1__) return;
  window.__RPG_PREFLIGHT_LOADER_V1__=true;

  const UPDATE_QUERY='_rpg_update';
  const CHECK_QUERY='_rpg_boot_check';
  const num=v=>{
    const m=String(v??'').match(/\d+(?:\.\d+)*/);
    return m?parseFloat(m[0]):0;
  };

  const localVersion=()=>{
    const m=document.querySelector('meta[name="rpg-build-version"]');
    const a=m?String(m.getAttribute('content')||''):'0';
    const b=String(window.__RPG_BUILD_VERSION__||'0');
    return Math.max(num(a),num(b));
  };

  function baseIndex(){
    const u=new URL(location.href);
    u.hash='';
    u.search='';
    if(u.pathname.endsWith('/'))u.pathname+='index.html';
    return u;
  }

  function bust(url){
    const u=new URL(url,location.href);
    u.searchParams.set(
      CHECK_QUERY,
      Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9)
    );
    return u.toString();
  }

  async function remoteVersion(){
    try{
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

      if(!r.ok) throw new Error('index HTTP '+r.status);

      const h=await r.text();

      const m=
        h.match(/<meta[^>]+name=["']rpg-build-version["'][^>]+content=["']([^"']+)["'][^>]*>/i)
        ||
        h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']rpg-build-version["'][^>]*>/i);

      if(!m) throw new Error('build marker missing');

      return String(m[1]);

    }catch(_e){
      try{
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

        if(!r.ok) throw new Error('version.json HTTP '+r.status);

        const x=await r.json();
        return String(x.version);

      }catch(_e2){
        return '0';
      }
    }
  }

  function ensureStyle(){
    if(document.getElementById('rpgPreflightStyleV1'))return;

    const st=document.createElement('style');
    st.id='rpgPreflightStyleV1';

    st.textContent=`
      #rpgPreflightV1{
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

      #rpgPreflightV1.show{
        display:flex
      }

      #rpgPreflightV1 .card{
        width:min(430px,100%);
        background:#fff;
        color:#17233b;
        border:2px solid #2d69d7;
        border-radius:18px;
        box-shadow:0 20px 60px rgba(0,0,0,.28);
        padding:20px;
        display:flex;
        gap:12px;
        align-items:flex-start
      }

      #rpgPreflightV1 .icon{
        font-size:30px;
        line-height:1
      }

      #rpgPreflightV1 .body{
        flex:1;
        min-width:0
      }

      #rpgPreflightV1 b{
        font-size:16px
      }

      #rpgPreflightV1 .txt{
        margin-top:6px;
        color:#53627a;
        font-size:13px;
        line-height:1.5
      }

      #rpgPreflightV1 .actions{
        display:flex;
        gap:8px;
        margin-top:13px
      }

      #rpgPreflightV1 button{
        border:0;
        border-radius:9px;
        padding:9px 12px;
        font-weight:800;
        cursor:pointer
      }

      #rpgPreflightV1 .now{
        background:#2d69d7;
        color:#fff
      }

      #rpgPreflightV1 .later{
        background:#eef2f7;
        color:#31405a
      }

      @media(max-width:560px){
        #rpgPreflightV1{
          padding:12px
        }
      }
    `;

    document.head.appendChild(st);
  }

  function show(remote){
    ensureStyle();

    let el=document.getElementById('rpgPreflightV1');

    if(!el){
      el=document.createElement('div');
      el.id='rpgPreflightV1';

      el.innerHTML=
        '<div class="card">'+
          '<div class="icon">🔄</div>'+
          '<div class="body">'+
            '<b>새 게임 업데이트가 있어!</b>'+
            '<div class="txt">'+
              '현재 버전보다 최신 버전이 있어. 최신 버전으로 업데이트할 수 있어.'+
            '</div>'+
            '<div class="actions">'+
              '<button class="now">지금 업데이트</button>'+
              '<button class="later">나중에</button>'+
            '</div>'+
          '</div>'+
        '</div>';

      document.body.appendChild(el);

      el.querySelector('.now').onclick=()=>{
        const u=baseIndex();
        u.searchParams.set(
          UPDATE_QUERY,
          String(Date.now())
        );
        location.replace(u.toString());
      };

      el.querySelector('.later').onclick=()=>{
        el.classList.remove('show');
        window.__RPG_PREFLIGHT_UPDATE__=false;
      };
    }

    el.classList.add('show');

    window.__RPG_PREFLIGHT_UPDATE__=true;
    window.__RPG_PREFLIGHT_REMOTE_VERSION__=String(remote);
  }

  async function boot(){
    try{
      const local=localVersion();
      const remote=await remoteVersion();

      if(num(remote)>local){
        show(remote);
      }
    }catch(_e){}
  }

  if(
    new URL(location.href)
      .searchParams
      .has(UPDATE_QUERY)
  ) return;

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
