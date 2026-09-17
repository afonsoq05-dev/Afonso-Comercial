import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import webpush from "npm:web-push@3.6.7";

type ReminderJob = {
  device_id: string;
  reminder_key: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  target_url: string;
};

function sameSecret(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return 0;
  const value = (error as Record<string, unknown>).statusCode;
  return typeof value === "number" ? value : 0;
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Falha desconhecida")).slice(0, 500);
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, () => next()));
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({error: "Método não permitido."}, {status: 405});
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!databaseUrl) return Response.json({error: "Configuração indisponível."}, {status: 500});
  const sql = postgres(databaseUrl, {max: 2, prepare: false, connect_timeout: 10, idle_timeout: 5});

  try {
    const secretRows = await sql`
      select name, decrypted_secret
      from vault.decrypted_secrets
      where name in ('afonso_cron_secret', 'afonso_vapid_public_key', 'afonso_vapid_private_key', 'afonso_vapid_subject')
    `;
    const secrets = Object.fromEntries(secretRows.map((row) => [row.name, row.decrypted_secret])) as Record<string, string>;
    const suppliedSecret = request.headers.get("x-cron-secret") || "";
    if (!secrets.afonso_cron_secret || !sameSecret(suppliedSecret, secrets.afonso_cron_secret)) {
      return Response.json({error: "Não autorizado."}, {status: 401});
    }
    if (!secrets.afonso_vapid_public_key || !secrets.afonso_vapid_private_key || !secrets.afonso_vapid_subject) {
      throw new Error("Segredos VAPID ausentes");
    }
    webpush.setVapidDetails(
      secrets.afonso_vapid_subject,
      secrets.afonso_vapid_public_key,
      secrets.afonso_vapid_private_key,
    );

    const jobs = await sql.begin(async (transaction) => transaction<ReminderJob[]>`
      with due as (
        select schedule.device_id, schedule.reminder_key
        from private.push_schedules as schedule
        where schedule.sent_at is null
          and schedule.notify_at <= now()
          and schedule.attempts < 20
          and (schedule.sending_at is null or schedule.sending_at < now() - interval '15 minutes')
        order by schedule.notify_at
        limit 100
        for update skip locked
      )
      update private.push_schedules as schedule
      set sending_at = now(), attempts = schedule.attempts + 1
      from due, private.push_devices as device
      where schedule.device_id = due.device_id
        and schedule.reminder_key = due.reminder_key
        and device.device_id = schedule.device_id
      returning schedule.device_id::text, schedule.reminder_key, schedule.title, schedule.body,
        schedule.target_url, device.endpoint, device.p256dh, device.auth
    `);

    let sent = 0;
    let failed = 0;
    await runPool(jobs, 8, async (job) => {
      try {
        await webpush.sendNotification(
          {endpoint: job.endpoint, keys: {p256dh: job.p256dh, auth: job.auth}},
          JSON.stringify({
            title: job.title,
            body: job.body,
            url: job.target_url,
            tag: "afonso-" + job.reminder_key.slice(0, 20),
          }),
          {TTL: 86400, urgency: "normal"},
        );
        await sql`
          update private.push_schedules
          set sent_at = now(), sending_at = null, last_error = null
          where device_id = ${job.device_id}::uuid and reminder_key = ${job.reminder_key}
        `;
        sent++;
      } catch (error) {
        const status = errorStatus(error);
        if (status === 404 || status === 410) {
          await sql`delete from private.push_devices where device_id = ${job.device_id}::uuid`;
        } else {
          await sql`
            update private.push_schedules
            set sending_at = null, last_error = ${errorMessage(error)}
            where device_id = ${job.device_id}::uuid and reminder_key = ${job.reminder_key}
          `;
        }
        failed++;
      }
    });

    return Response.json({ok: true, claimed: jobs.length, sent, failed});
  } catch (error) {
    console.error("reminder dispatch failed", error);
    return Response.json({error: "Não foi possível processar os lembretes."}, {status: 500});
  } finally {
    await sql.end({timeout: 1});
  }
});
