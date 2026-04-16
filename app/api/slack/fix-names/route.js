// 既存データの担当者名を NAME_CORRECTIONS で一括修正（一度限り）
// GET /api/slack/fix-names with Bearer CRON_SECRET

import { normalizeName } from '@/lib/slack/parse';
import { getAccessToken } from '@/lib/slack/googleAuth';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4';

async function getValues(sheetName, range) {
  const token = await getAccessToken();
  const encoded = encodeURIComponent(`${sheetName}!${range}`);
  const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}/values/${encoded}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${sheetName} ${res.status}`);
  const data = await res.json();
  return data.values || [];
}

async function updateCell(sheetName, a1, value) {
  const token = await getAccessToken();
  const encoded = encodeURIComponent(`${sheetName}!${a1}`);
  const res = await fetch(
    `${SHEETS_API}/${SPREADSHEET_ID}/values/${encoded}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[value]] }),
    }
  );
  if (!res.ok) throw new Error(`PUT ${sheetName}!${a1} ${res.status}`);
}

async function listSheetTitles() {
  const token = await getAccessToken();
  const res = await fetch(
    `${SHEETS_API}/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.sheets.map((s) => s.properties.title);
}

async function fixSheet(sheetName, nameCol /* 0-indexed */) {
  const rows = await getValues(sheetName, 'A:Z');
  let fixed = 0;
  for (let i = 1; i < rows.length; i++) {
    const name = String((rows[i] || [])[nameCol] || '');
    if (!name) continue;
    const corrected = normalizeName(name);
    if (corrected !== name) {
      const a1Col = String.fromCharCode(65 + nameCol); // A, B, C...
      await updateCell(sheetName, `${a1Col}${i + 1}`, corrected);
      fixed++;
    }
  }
  return fixed;
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const titles = await listSheetTitles();
    const results = {};

    // 生データ: B列（index 1）が担当者
    if (titles.includes('生データ')) {
      results['生データ'] = await fixSheet('生データ', 1);
    }

    // 月次・累計シート: A列（index 0）が担当者
    for (const title of titles) {
      if (title === '生データ') continue;
      if (title.match(/^\d{4}年\d{1,2}月$/) || title === '全月累計') {
        results[title] = await fixSheet(title, 0);
      }
    }

    return Response.json({ ok: true, fixed: results, at: new Date().toISOString() });
  } catch (err) {
    console.error('fix-names error', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
