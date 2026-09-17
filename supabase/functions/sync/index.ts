import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const ALLOWED_ORIGINS = new Set([
  "https://afonsoq05-dev.github.io",
]);
const ALLOWED_PUSH_HOSTS = new Set([
  "web.push.apple.com",
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMINDER_KEY = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SCHEDULES = 500;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, x-device-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(origin: string, body: unknown, status = 200) {
  return Response.json(body, {status, headers: cors(origin)});
}

function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: value}).format();
    return true;
  } catch {
    return false;
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSubscription(value: unknown) {
  if (!value || typeof value !== "object") throw new HttpError(400, "Assinatura inválida.");
  const record = value as Record<string, unknown>;
  const keys = record.keys && typeof record.keys === "object" ? record.keys as Record<string, unknown> : {};
  const endpoint = text(record.endpoint, 2048);
  const p256dh = text(keys.p256dh, 512);
  const auth = text(keys.auth, 256);
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new HttpError(400, "Assinatura inválida.");
  }
  if (parsed.protocol !== "https:" || !ALLOWED_PUSH_HOSTS.has(parsed.hostname) || !p256dh || !auth) {
    throw new HttpError(400, "Assinatura inválida.");
  }
  return {endpoint, p256dh, auth};
}

function normalizeSchedules(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_SCHEDULES) throw new HttpError(400, "Agenda inválida.");
  const now = Date.now();
  const min = now - 366 * 86400000;
  const max = now + 3 * 366 * 86400000;
  const unique = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new HttpError(400, "Lembrete inválido.");
    const record = item as Record<string, unknown>;
    const reminderKey = text(record.key, 64).toLowerCase();
    const dueDate = text(record.dueDate, 10);
    const notifyAt = text(record.notifyAt, 40);
    const title = text(record.title, 120);
    const body = text(record.body, 300);
    const timestamp = Date.parse(notifyAt);
    if (!REMINDER_KEY.test(reminderKey) || unique.has(reminderKey) || !DATE.test(dueDate) ||
        !Number.isFinite(timestamp) || timestamp < min || timestamp > max || !title || !body) {
      throw new HttpError(400, "Lembrete inválido.");
    }
    unique.add(reminderKey);
    return {
      reminder_key: reminderKey,
      due_date: dueDate,
      notify_at: new Date(timestamp).toISOString(),
      title,
      body,
      target_url: "./?agenda=1",
    };
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return new Response("Origem não autorizada.", {status: 403});
  if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: cors(origin)});
  if (request.method !== "POST") return json(origin, {error: "Método não permitido."}, 405);

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 350000) return json(origin, {error: "Conteúdo muito grande."}, 413);

  let sql: ReturnType<typeof postgres> | undefined;
  try {
    const deviceSecret = request.headers.get("x-device-secret") || "";
    if (deviceSecret.length < 24 || deviceSecret.length > 128) throw new HttpError(401, "Dispositivo não autorizado.");
    const body = await request.json() as Record<string, unknown>;
    const deviceId = text(body.deviceId, 36).toLowerCase();
    if (!DEVICE_ID.test(deviceId)) throw new HttpError(400, "Dispositivo inválido.");
    if (!isTimezone(body.timezone)) throw new HttpError(400, "Fuso horário inválido.");
    const timezone = body.timezone;
    const subscription = normalizeSubscription(body.subscription);
    const schedules = normalizeSchedules(body.schedules);
    const secretHash = await sha256(deviceSecret);
    const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!databaseUrl) throw new Error("SUPABASE_DB_URL ausente");
    sql = postgres(databaseUrl, {max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5});

    await sql.begin(async (transaction) => {
      let device = await transaction`
        select (secret_hash = ${secretHash}) as authorized
        from private.push_devices
        where device_id = ${deviceId}::uuid
        for update
      `;
      if (!device.length) {
        await transaction`select pg_advisory_xact_lock(714202607)`;
        await transaction`delete from private.push_devices where updated_at < now() - interval '180 days'`;
        await transaction`delete from private.push_devices where endpoint = ${subscription.endpoint}`;
        const totals = await transaction`select count(*)::integer as device_count from private.push_devices`;
        if (Number(totals[0]?.device_count || 0) >= 12) {
          throw new HttpError(429, "Limite de aparelhos atingido.");
        }
        await transaction`
          insert into private.push_devices (device_id, secret_hash, endpoint, p256dh, auth, timezone)
          values (${deviceId}::uuid, ${secretHash}, ${subscription.endpoint}, ${subscription.p256dh}, ${subscription.auth}, ${timezone})
          on conflict (device_id) do nothing
        `;
        device = await transaction`
          select (secret_hash = ${secretHash}) as authorized
          from private.push_devices
          where device_id = ${deviceId}::uuid
          for update
        `;
      }
      if (!device[0]?.authorized) throw new HttpError(401, "Dispositivo não autorizado.");

      await transaction`
        update private.push_devices
        set endpoint = ${subscription.endpoint}, p256dh = ${subscription.p256dh}, auth = ${subscription.auth}, timezone = ${timezone}
        where device_id = ${deviceId}::uuid
      `;

      if (schedules.length) {
        await transaction`
          insert into private.push_schedules
            (device_id, reminder_key, due_date, notify_at, title, body, target_url)
          select
            ${deviceId}::uuid,
            incoming.reminder_key,
            incoming.due_date::date,
            incoming.notify_at::timestamptz,
            incoming.title,
            incoming.body,
            incoming.target_url
          from jsonb_to_recordset(${transaction.json(schedules)}::jsonb) as incoming(
            reminder_key text,
            due_date text,
            notify_at text,
            title text,
            body text,
            target_url text
          )
          on conflict (device_id, reminder_key) do update
          set due_date = excluded.due_date,
              notify_at = excluded.notify_at,
              title = excluded.title,
              body = excluded.body,
              target_url = excluded.target_url,
              sent_at = case
                when private.push_schedules.notify_at is distinct from excluded.notify_at then null
                else private.push_schedules.sent_at
              end,
              sending_at = null,
              attempts = case
                when private.push_schedules.notify_at is distinct from excluded.notify_at then 0
                else private.push_schedules.attempts
              end,
              last_error = case
                when private.push_schedules.notify_at is distinct from excluded.notify_at then null
                else private.push_schedules.last_error
              end
        `;
        const keys = schedules.map((schedule) => schedule.reminder_key);
        await transaction`
          delete from private.push_schedules
          where device_id = ${deviceId}::uuid
            and reminder_key not in (
              select jsonb_array_elements_text(${transaction.json(keys)}::jsonb)
            )
        `;
      } else {
        await transaction`delete from private.push_schedules where device_id = ${deviceId}::uuid`;
      }
    });

    return json(origin, {ok: true, schedules: schedules.length});
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error("push sync failed", error);
    return json(origin, {error: status === 500 ? "Não foi possível sincronizar agora." : (error as Error).message}, status);
  } finally {
    if (sql) await sql.end({timeout: 1});
  }
});
