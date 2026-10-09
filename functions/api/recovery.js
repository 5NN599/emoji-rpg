const LEGACY_V69_KEY =
  'emoji|rpg|recovery|v69|integrity|key|7f2c|a91d|c4e8|31b7|5d06|ef49';

const te = new TextEncoder();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    }
  });
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), b =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', te.encode(String(text))));
}

function b64UrlDecode(text) {
  const raw = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = raw.length % 4 ? '='.repeat(4 - raw.length % 4) : '';
  const bin = atob(raw + pad);
  const bytes = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

function makeShortToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let acc = 0;
  let bits = 0;
  let out = '';

  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
      acc &= (1 << bits) - 1;
    }
  }

  if (out.length !== 16) {
    throw new Error('짧은 복구 키를 만들지 못했어.');
  }

  return out;
}

function quickHash(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const str = String(text);

  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ ((c << 1) | 1), 2246822519);
  }

  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36))
    .toUpperCase().padStart(13, '0').slice(0, 13);
}

function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');

  if (a.length !== b.length) return false;

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

function validCompactPayload(payload, allowV3 = false) {
  return Array.isArray(payload) &&
    (payload[0] === 4 || (allowV3 && payload[0] === 3)) &&
    Array.isArray(payload[3]) &&
    Array.isArray(payload[4]) &&
    payload[4].length >= 18 &&
    JSON.stringify(payload).length <= 24000;
}

async function verifyLegacyV69(code) {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  if (!/^ERPG2-/i.test(raw)) return null;

  const body = raw.slice(6);
  const cut = body.lastIndexOf('.');
  if (cut < 0) return null;

  const packed = body.slice(0, cut).replace(/\./g, '');
  const supplied = body.slice(cut + 1).toLowerCase();

  if (!packed.startsWith('C3') || !/^[0-9a-f]{20}$/i.test(supplied)) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(LEGACY_V69_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const expected = hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      te.encode('ERPG2-' + packed)
    )
  ).slice(0, 20);

  if (!safeEqual(expected, supplied)) {
    throw new Error('구형 복구 키의 서명을 확인할 수 없어.');
  }

  const payload = JSON.parse(b64UrlDecode(packed.slice(2)));

  if (!validCompactPayload(payload, true)) {
    throw new Error('구형 복구 데이터가 올바르지 않아.');
  }

  return { kind: 'compact', payload, legacy: true };
}

async function decodeLegacyQuickHash(code) {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  if (!/^ERPG[12]-/i.test(raw)) return null;

  const parts = raw.split('-');
  const checksum = String(parts.pop() || '').toUpperCase();

  parts.shift();
  const packed = parts.join('-');

  if (!packed || quickHash(packed) !== checksum) {
    throw new Error('구형 복구 키 검증에 실패했어.');
  }

  const payload = JSON.parse(b64UrlDecode(packed));

  if (!payload || !payload.data || ![1, 2].includes(Number(payload.v))) {
    throw new Error('구형 복구 데이터가 올바르지 않아.');
  }

  if (JSON.stringify(payload).length > 24000) {
    throw new Error('복구 데이터가 너무 커.');
  }

  return { kind: 'object', payload, legacy: true };
}

async function rateLimit(request, env, action, max) {
  const now = Date.now();
  const windowStart = Math.floor(now / 600000) * 600000;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucketKey = await sha256Hex(
    'rpg-rate|' + action + '|' + ip + '|' + windowStart
  );

  await env.RPG_DB.prepare(
    'DELETE FROM rpg_recovery_rate WHERE window_start < ?'
  ).bind(now - 3600000).run();

  await env.RPG_DB.prepare(`
    INSERT INTO rpg_recovery_rate
      (bucket_key, window_start, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket_key)
    DO UPDATE SET request_count = request_count + 1
  `).bind(bucketKey, windowStart).run();

  const row = await env.RPG_DB.prepare(
    'SELECT request_count FROM rpg_recovery_rate WHERE bucket_key = ?'
  ).bind(bucketKey).first();

  return Number(row && row.request_count || 0) <= max;
}

async function recoverAnyCode(code, env) {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  const match = raw.match(
    /^ERPG3-([A-HJ-NP-Z2-9]{16}|[0-9A-F]{48})$/i
  );

  if (match) {
    const tokenHash = await sha256Hex(match[1].toUpperCase());

    const row = await env.RPG_DB.prepare(
      'SELECT payload_json FROM rpg_recovery WHERE token_hash = ?'
    ).bind(tokenHash).first();

    if (!row) {
      throw new Error(
        '복구 키를 찾을 수 없어. 코드가 틀렸거나 서버 기록이 없어.'
      );
    }

    const payload = JSON.parse(row.payload_json);

    if (!validCompactPayload(payload)) {
      throw new Error('서버에 저장된 복구 데이터가 손상됐어.');
    }

    return { kind: 'compact', payload, legacy: false };
  }

  const signed = await verifyLegacyV69(raw);
  if (signed) return signed;

  const old = await decodeLegacyQuickHash(raw);
  if (old) return old;

  throw new Error('지원하지 않는 복구 키야.');
}

function validNewPayload(payload) {
  return validCompactPayload(payload, false) && payload[0] === 4;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'POST 요청만 지원해.' }, 405);
  }

  const origin = request.headers.get('Origin');

  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return json({ ok: false, error: '허용되지 않은 출처야.' }, 403);
      }
    } catch (_) {
      return json({ ok: false, error: '요청 출처를 확인할 수 없어.' }, 403);
    }
  }

  if (!env.RPG_DB) {
    return json({
      ok: false,
      error: 'Cloudflare D1 바인딩 RPG_DB가 설정되지 않았어.'
    }, 503);
  }

  let body;

  try {
    const text = await request.text();

    if (text.length > 32000) {
      return json({ ok: false, error: '요청 데이터가 너무 커.' }, 413);
    }

    body = JSON.parse(text);
  } catch (_) {
    return json({ ok: false, error: 'JSON 요청을 읽을 수 없어.' }, 400);
  }

  const action = String(body && body.action || '');
  const limits = { issue: 20, recover: 60, update: 180 };

  if (!(action in limits)) {
    return json({ ok: false, error: '지원하지 않는 작업이야.' }, 400);
  }

  try {
    if (!await rateLimit(request, env, action, limits[action])) {
      return json({
        ok: false,
        error: '요청이 너무 많아. 잠깐 기다린 뒤 다시 시도해 줘.'
      }, 429);
    }

    if (action === 'issue') {
      const payload = body.payload;

      if (!validNewPayload(payload)) {
        return json({
          ok: false,
          error: '새 복구 데이터 형식이 올바르지 않아.'
        }, 400);
      }

      const token = makeShortToken();
      const tokenHash = await sha256Hex(token);
      const friendCode = String(payload[4][2] || '')
        .toUpperCase().slice(0, 8);

      const ownerHash = friendCode
        ? await sha256Hex('owner:' + friendCode)
        : null;

      const now = Date.now();

      await env.RPG_DB.prepare(`
        INSERT INTO rpg_recovery
          (token_hash, owner_hash, payload_json, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(
        tokenHash,
        ownerHash,
        JSON.stringify(payload),
        now
      ).run();

      if (ownerHash) {
        await env.RPG_DB.prepare(`
          DELETE FROM rpg_recovery
          WHERE owner_hash = ?
          AND token_hash NOT IN (
            SELECT token_hash FROM rpg_recovery
            WHERE owner_hash = ?
            ORDER BY created_at DESC
            LIMIT 20
          )
        `).bind(ownerHash, ownerHash).run();
      }

      return json({ ok: true, code: 'ERPG3-' + token });
    }

    if (action === 'update') {
      const code = String(body.code || '').trim().replace(/\s+/g, '');
      const match = code.match(
        /^ERPG3-([A-HJ-NP-Z2-9]{16}|[0-9A-F]{48})$/i
      );

      if (!match) {
        return json({ ok: false, error: '서버 복구 키 형식이 올바르지 않아.' }, 400);
      }

      if (!validNewPayload(body.payload)) {
        return json({ ok: false, error: '백업 데이터 형식이 올바르지 않아.' }, 400);
      }

      const tokenHash = await sha256Hex(match[1].toUpperCase());

      const changed = await env.RPG_DB.prepare(
        'UPDATE rpg_recovery SET payload_json = ? WHERE token_hash = ?'
      ).bind(JSON.stringify(body.payload), tokenHash).run();

      if (!changed.meta || !changed.meta.changes) {
        return json({ ok: false, error: '서버에서 복구 키를 찾을 수 없어.' }, 404);
      }

      return json({ ok: true });
    }

    if (action === 'recover') {
      const result = await recoverAnyCode(body.code, env);
      return json({ ok: true, ...result });
    }
  } catch (error) {
    const message = String(error && error.message || error || '처리 실패');
    return json({ ok: false, error: message.slice(0, 200) }, 400);
  }

  return json({ ok: false, error: '지원하지 않는 작업이야.' }, 400);
}
