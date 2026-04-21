// One-shot manual insert for missed human-reply rows
// POST /api/slack/manual-insert  (Bearer CRON_SECRET, body: { rows: [{date, person, name, calls, pr, apo}, ...] })

import { writeRawData, updateMonthlySheet, updateCumulativeSheet } from '@/lib/slack/sheets';

export const runtime = 'nodejs';
export const maxDuration = 60;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function POST(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'bad json' }, { status: 400 }); }

  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || rows.length === 0) {
    return Response.json({ error: 'rows required' }, { status: 400 });
  }

  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.date}|${r.person}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  const results = [];
  for (const [key, branches] of byKey.entries()) {
    const [date, person] = key.split('|');
    const written = [];
    for (const b of branches) {
      const ok = await writeRawData(
        date, person, b.name, b.calls, b.pr, b.apo, '✅正常（手動遡及補完）', ''
      );
      results.push({ date, person, ...b, wrote: ok });
      if (ok) written.push({ name: b.name, calls: b.calls, pr: b.pr, apo: b.apo, warn: false });
      await sleep(400);
    }
    if (written.length > 0) {
      await updateMonthlySheet(date, person, written);
      await sleep(400);
      await updateCumulativeSheet(person, written);
      await sleep(400);
    }
  }

  return Response.json({ ok: true, results, at: new Date().toISOString() });
}
