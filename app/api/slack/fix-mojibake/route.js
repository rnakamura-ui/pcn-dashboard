// One-shot: delete rows containing mojibake (U+FFFD) across 生データ / 2026年4月 / 全月累計
// POST /api/slack/fix-mojibake (Bearer CRON_SECRET)

import { getAccessToken } from '@/lib/slack/googleAuth';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4';
const TARGET_SHEETS = ['生データ', '2026年4月', '全月累計'];

async function apiGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

function hasMojibake(cells) {
  for (const c of (cells || [])) {
    if (typeof c === 'string' && c.includes('�')) return true;
  }
  return false;
}

export async function POST(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const meta = await apiGet('?fields=sheets.properties');
    const sheetIdMap = {};
    for (const s of meta.sheets || []) {
      sheetIdMap[s.properties.title] = s.properties.sheetId;
    }

    const results = {};
    for (const title of TARGET_SHEETS) {
      if (!(title in sheetIdMap)) { results[title] = 'not found'; continue; }
      const data = await apiGet(`/values/${encodeURIComponent(`${title}!A:Z`)}`);
      const rows = data.values || [];
      const badIndexes = []; // 0-indexed rows
      for (let i = 0; i < rows.length; i++) {
        if (hasMojibake(rows[i])) badIndexes.push(i);
      }
      if (badIndexes.length === 0) { results[title] = 0; continue; }

      // Delete from bottom-up so indexes stay valid
      const requests = badIndexes.reverse().map((idx) => ({
        deleteDimension: {
          range: {
            sheetId: sheetIdMap[title],
            dimension: 'ROWS',
            startIndex: idx,
            endIndex: idx + 1,
          },
        },
      }));
      await apiPost(':batchUpdate', { requests });
      results[title] = badIndexes.length;
    }

    return Response.json({ ok: true, deleted: results, at: new Date().toISOString() });
  } catch (err) {
    console.error('fix-mojibake error', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
