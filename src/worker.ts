type RuntimeEnv = Env & {
  ADMIN_BOOTSTRAP_PASSWORD?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  OPENAI_API_KEY?: string;
};

const encoder = new TextEncoder();
const SESSION_COOKIE = "sp_session";
const ADMIN_COOKIE = "sp_admin";
const MAX_BODY = 80_000;

function apiHeaders(extra: HeadersInit = {}) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    ...extra,
  };
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: apiHeaders(headers) });
}

function parseCookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function cookie(name: string, value: string, maxAge = 60 * 60 * 24 * 365) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantEqual(left: string, right: string) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let mismatch = aa.length ^ bb.length;
  for (let index = 0; index < Math.min(aa.length, bb.length); index += 1) mismatch |= aa[index] ^ bb[index];
  return mismatch === 0;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function encryptionKey(env: RuntimeEnv) {
  if (!env.SETTINGS_ENCRYPTION_KEY) throw new Error("SETTINGS_ENCRYPTION_KEY is not configured");
  const raw = base64ToBytes(env.SETTINGS_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(env: RuntimeEnv, plaintext: string) {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

async function decryptSecret(env: RuntimeEnv, encrypted: string) {
  const combined = base64ToBytes(encrypted);
  const key = await encryptionKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
  return new TextDecoder().decode(plaintext);
}

function validateMutation(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function readBody<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as T;
}

async function ensureUser(request: Request, env: RuntimeEnv) {
  const cookies = parseCookies(request);
  const existing = cookies[SESSION_COOKIE];
  const id = existing && /^[a-f0-9-]{36}$/.test(existing) ? existing : crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
  ).bind(id).run();
  return { id, isNew: id !== existing };
}

async function isAdmin(request: Request, env: RuntimeEnv) {
  const token = parseCookies(request)[ADMIN_COOKIE];
  if (!token) return false;
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(
    "SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP",
  ).bind(tokenHash).first();
  return Boolean(session);
}

async function setting(env: RuntimeEnv, key: string, fallback: string) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

async function getAiConfig(env: RuntimeEnv) {
  const row = await env.DB.prepare(
    "SELECT model, encrypted_key, key_hint, enabled FROM ai_settings WHERE id = 1",
  ).first<{ model: string; encrypted_key: string | null; key_hint: string | null; enabled: number }>();
  let apiKey = env.OPENAI_API_KEY ?? "";
  if (row?.encrypted_key) {
    try {
      apiKey = await decryptSecret(env, row.encrypted_key);
    } catch {
      apiKey = "";
    }
  }
  return {
    apiKey,
    model: row?.model || env.OPENAI_MODEL || "gpt-4.1-mini",
    keyHint: row?.key_hint,
    enabled: Boolean(apiKey && (row?.enabled || env.OPENAI_API_KEY)),
  };
}

async function handleState(request: Request, env: RuntimeEnv) {
  const user = await ensureUser(request, env);
  const headers: Record<string, string> = user.isNew ? { "set-cookie": cookie(SESSION_COOKIE, user.id) } : {};
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT state_json FROM user_state WHERE user_id = ?").bind(user.id).first<{ state_json: string }>();
    return json({ state: row ? JSON.parse(row.state_json) : null }, 200, headers);
  }
  if (request.method === "PUT") {
    if (!validateMutation(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
    const body = await readBody<{ state: unknown }>(request);
    const stateJson = JSON.stringify(body.state);
    if (stateJson.length > 60_000) return json({ error: "저장 데이터가 너무 큽니다." }, 413);
    await env.DB.prepare(
      "INSERT INTO user_state (user_id, state_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP",
    ).bind(user.id, stateJson).run();
    return json({ ok: true }, 200, headers);
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleAdminLogin(request: Request, env: RuntimeEnv) {
  if (!validateMutation(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
  const client = request.headers.get("cf-connecting-ip") ?? "unknown";
  const clientHash = await sha256(client);
  const attempts = await env.DB.prepare(
    "SELECT attempts, blocked_until FROM admin_login_attempts WHERE client_hash = ?",
  ).bind(clientHash).first<{ attempts: number; blocked_until: string | null }>();
  if (attempts?.blocked_until && new Date(attempts.blocked_until) > new Date()) {
    return json({ error: "잠시 후 다시 시도하세요." }, 429);
  }
  const body = await readBody<{ password?: string }>(request);
  const expected = env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!expected || !(await constantEqual(body.password ?? "", expected))) {
    const count = (attempts?.attempts ?? 0) + 1;
    const blockedUntil = count >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await env.DB.prepare(
      "INSERT INTO admin_login_attempts (client_hash, attempts, blocked_until) VALUES (?, ?, ?) ON CONFLICT(client_hash) DO UPDATE SET attempts = excluded.attempts, blocked_until = excluded.blocked_until, updated_at = CURRENT_TIMESTAMP",
    ).bind(clientHash, count, blockedUntil).run();
    return json({ error: "인증에 실패했습니다." }, 401);
  }
  await env.DB.prepare("DELETE FROM admin_login_attempts WHERE client_hash = ?").bind(clientHash).run();
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
  await env.DB.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)").bind(tokenHash, expiresAt).run();
  await env.DB.prepare("INSERT INTO admin_audit_logs (id, action) VALUES (?, 'admin_login')").bind(crypto.randomUUID()).run();
  return json({ ok: true }, 200, { "set-cookie": cookie(ADMIN_COOKIE, token, 8 * 60 * 60) });
}

async function handleAdminStatus(request: Request, env: RuntimeEnv) {
  if (!(await isAdmin(request, env))) return json({ authenticated: false });
  const [users, ai, rights, bookPublic, book] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
    getAiConfig(env),
    setting(env, "rights_approved", "false"),
    setting(env, "book_public", "false"),
    env.BOOKS.head(env.BOOK_OBJECT_KEY),
  ]);
  return json({
    authenticated: true,
    users: users?.count ?? 0,
    ai: {
      enabled: true,
      model: ai.enabled ? ai.model : env.WORKERS_AI_MODEL,
      provider: ai.enabled ? "openai" : "cloudflare-workers-ai",
      keyHint: ai.keyHint,
    },
    book: { rightsApproved: rights === "true", public: bookPublic === "true", uploaded: Boolean(book) },
  });
}

async function handleAdminSettings(request: Request, env: RuntimeEnv) {
  if (!(await isAdmin(request, env))) return json({ error: "관리자 인증이 필요합니다." }, 401);
  if (!validateMutation(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
  const body = await readBody<{
    model?: string;
    apiKey?: string;
    rightsApproved?: boolean;
    bookPublic?: boolean;
  }>(request);
  const model = (body.model ?? "gpt-4.1-mini").trim().slice(0, 80);
  if (body.apiKey) {
    if (!body.apiKey.startsWith("sk-") || body.apiKey.length < 30) return json({ error: "OpenAI API 키 형식을 확인하세요." }, 400);
    const test = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${body.apiKey}` },
    });
    if (!test.ok) return json({ error: "OpenAI 연결 테스트에 실패했습니다. 키와 계정을 확인하세요." }, 400);
    const encrypted = await encryptSecret(env, body.apiKey);
    await env.DB.prepare(
      "UPDATE ai_settings SET model = ?, encrypted_key = ?, key_hint = ?, enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
    ).bind(model, encrypted, body.apiKey.slice(-4)).run();
  } else {
    await env.DB.prepare("UPDATE ai_settings SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1").bind(model).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('rights_approved', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    ).bind(String(Boolean(body.rightsApproved))),
    env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('book_public', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    ).bind(String(Boolean(body.bookPublic))),
    env.DB.prepare("INSERT INTO admin_audit_logs (id, action, detail) VALUES (?, 'settings_update', ?)").bind(
      crypto.randomUUID(),
      JSON.stringify({ model, rightsApproved: Boolean(body.rightsApproved), bookPublic: Boolean(body.bookPublic), apiKeyChanged: Boolean(body.apiKey) }),
    ),
  ]);
  return json({ ok: true });
}

async function handleBook(request: Request, env: RuntimeEnv) {
  const [rights, isPublic] = await Promise.all([
    setting(env, "rights_approved", "false"),
    setting(env, "book_public", "false"),
  ]);
  if (rights !== "true" || isPublic !== "true") return json({ error: "전자책 공개 권한이 확인되지 않았습니다." }, 403);
  const object = await env.BOOKS.head(env.BOOK_OBJECT_KEY);
  if (!object) return json({ error: "전자책 원본이 아직 업로드되지 않았습니다." }, 404);
  const baseHeaders = new Headers({
    "content-type": "application/pdf",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
    "content-disposition": 'inline; filename="success-puzzle.pdf"',
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    baseHeaders.set("content-length", String(object.size));
    return new Response(null, { headers: baseHeaders });
  }
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) return new Response(null, { status: 416 });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), object.size - 1) : object.size - 1;
    if (start > end || start >= object.size) return new Response(null, { status: 416 });
    const result = await env.BOOKS.get(env.BOOK_OBJECT_KEY, { range: { offset: start, length: end - start + 1 } });
    if (!result?.body) return new Response(null, { status: 404 });
    baseHeaders.set("content-length", String(end - start + 1));
    baseHeaders.set("content-range", `bytes ${start}-${end}/${object.size}`);
    return new Response(result.body, { status: 206, headers: baseHeaders });
  }
  const result = await env.BOOKS.get(env.BOOK_OBJECT_KEY);
  if (!result?.body) return new Response(null, { status: 404 });
  baseHeaders.set("content-length", String(result.size));
  return new Response(result.body, { headers: baseHeaders });
}

async function handleAiCoach(request: Request, env: RuntimeEnv) {
  const user = await ensureUser(request, env);
  if (!validateMutation(request)) return json({ error: "허용되지 않은 요청입니다." }, 403);
  const config = await getAiConfig(env);
  const body = await readBody<{ message?: string; context?: unknown }>(request);
  const message = (body.message ?? "").trim().slice(0, 3_000);
  if (!message) return json({ error: "질문을 입력하세요." }, 400);
  const dailyUsage = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM ai_runs WHERE user_id = ? AND created_at >= datetime('now', '-1 day')",
  ).bind(user.id).first<{ count: number }>();
  if ((dailyUsage?.count ?? 0) >= 10) return json({ error: "오늘의 무료 AI 코칭 10회를 모두 사용했습니다. 내일 다시 이용해 주세요." }, 429);
  const runId = crypto.randomUUID();
  const activeModel = config.enabled ? config.model : env.WORKERS_AI_MODEL;
  await env.DB.prepare("INSERT INTO ai_runs (id, user_id, model, status) VALUES (?, ?, ?, 'started')").bind(runId, user.id, activeModel).run();
  const systemPrompt = "당신은 AI 성공의 퍼즐조각 코치다. 성공을 보장하거나 사용자를 등급화하지 않는다. 책의 관점, 사용자의 실제 기록, 앱의 계산 결과를 구분한다. 낮은 점수를 인격이나 능력의 결함으로 해석하지 않는다. 과로, 위험투자, 기만적 영업, 맹목적 복종을 권하지 않는다. 관찰 → 근거 → 선택 가능한 작은 행동 → 사용자의 승인 순서로 간결한 한국어로 답한다.";
  let answer: string;
  if (config.enabled) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        max_output_tokens: 900,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `사용자 질문:\n${message}\n\n현재 앱 기록:\n${JSON.stringify(body.context ?? {})}` },
        ],
      }),
    });
    if (!response.ok) {
      await env.DB.prepare("UPDATE ai_runs SET status = 'failed' WHERE id = ?").bind(runId).run();
      return json({ error: "AI 제공자 응답에 실패했습니다. 잠시 후 다시 시도하세요." }, 502);
    }
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    answer = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("\n").trim() ?? "";
  } else {
    try {
      const result = await env.AI.run(env.WORKERS_AI_MODEL, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `사용자 질문:\n${message}\n\n현재 앱 기록:\n${JSON.stringify(body.context ?? {})}` },
        ],
        max_tokens: 900,
      });
      answer = typeof result === "object" && result && "response" in result ? String(result.response ?? "") : "";
    } catch {
      await env.DB.prepare("UPDATE ai_runs SET status = 'failed' WHERE id = ?").bind(runId).run();
      return json({ error: "Cloudflare AI 응답에 실패했습니다. 잠시 후 다시 시도하세요." }, 502);
    }
  }
  await env.DB.prepare("UPDATE ai_runs SET status = 'completed' WHERE id = ?").bind(runId).run();
  return json({ answer: answer || "응답 내용이 비어 있습니다.", runId, draft: true, model: activeModel });
}

async function routeApi(request: Request, env: RuntimeEnv) {
  const path = new URL(request.url).pathname;
  if (path === "/api/health") return json({ ok: true, service: env.APP_NAME });
  if (path === "/api/state" && ["GET", "PUT"].includes(request.method)) return handleState(request, env);
  if (path === "/api/book/pdf" && ["GET", "HEAD"].includes(request.method)) return handleBook(request, env);
  if (path === "/api/ai/status" && request.method === "GET") {
    const config = await getAiConfig(env);
    return json({
      connected: true,
      model: config.enabled ? config.model : env.WORKERS_AI_MODEL,
      provider: config.enabled ? "openai" : "cloudflare-workers-ai",
      dailyLimit: 10,
    });
  }
  if (path === "/api/ai/coach" && request.method === "POST") return handleAiCoach(request, env);
  if (path === "/api/admin/login" && request.method === "POST") return handleAdminLogin(request, env);
  if (path === "/api/admin/status" && request.method === "GET") return handleAdminStatus(request, env);
  if (path === "/api/admin/settings" && request.method === "PUT") return handleAdminSettings(request, env);
  return json({ error: "API not found" }, 404);
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await routeApi(request, env);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "strict-origin-when-cross-origin");
      headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
      headers.set("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://api.openai.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(JSON.stringify({ event: "request_error", message: error instanceof Error ? error.message : "unknown" }));
      if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") return json({ error: "요청이 너무 큽니다." }, 413);
      return json({ error: "서버 요청을 처리하지 못했습니다." }, 500);
    }
  },
} satisfies ExportedHandler<RuntimeEnv>;
