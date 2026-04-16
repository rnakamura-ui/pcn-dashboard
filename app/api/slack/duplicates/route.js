// 重複検出エンドポイント（読み取り専用）
// GET /api/slack/duplicates  with Bearer CRON_SECRET

import { CONFIG } from '@/lib/slack/parse';
import { getAccessToken } from '@/lib/slack/googleAuth';

export const runtime = 'nodejs';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4';

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const token = await getAccessToken();
    const encoded = encodeURIComponent(`${CONFIG.SHEET_RAW}!A:H`);
    const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}/values/${encoded}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const rows = data.values || [];

    // 重複検出（日付+担当者+支店+架電+着電+アポの6項目一致）
    const seen = new Map(); // key → [row_numbers]
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const date = String(r[0] || '').trim();
      const person = String(r[1] || '').trim();
      const branch = String(r[2] || '').trim();
      if (!date || !person || !branch || branch === '（未解析）') continue;
      const calls = Number(r[3]) || 0;
      const pr = Number(r[4]) || 0;
      const apo = Number(r[5]) || 0;
      const key = `${date}|${person}|${branch}|${calls}|${pr}|${apo}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(i + 1); // 1-indexed row number
    }

    const duplicates = [];
    for (const [key, rowNums] of seen.entries()) {
      if (rowNums.length >= 2) {
        const [date, person, branch, calls, pr, apo] = key.split('|');
        duplicates.push({
          date, person, branch,
          calls: Number(calls), pr: Number(pr), apo: Number(apo),
          rows: rowNums,
          count: rowNums.length,
        });
      }
    }

    return Response.json({
      ok: true,
      duplicateGroups: duplicates.length,
      totalDuplicateRows: duplicates.reduce((s, d) => s + d.count - 1, 0), // 1件は正規、残りが重複
      duplicates: duplicates.sort((a, b) => (a.date < b.date ? -1 : 1)),
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('duplicates error', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
