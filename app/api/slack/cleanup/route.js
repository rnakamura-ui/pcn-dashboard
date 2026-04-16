// 一度限りのクリーンアップ: 重複行削除 + （未解析）行のI列再パース
// GET /api/slack/cleanup with Bearer CRON_SECRET

import { parseBranchData, CONFIG } from '@/lib/slack/parse';
import { getAccessToken } from '@/lib/slack/googleAuth';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4';

async function apiGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPut(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const report = { reparsed: [], appended: [], deleted: [] };

    // シートIDを取得
    const meta = await apiGet('?fields=sheets.properties');
    const rawSheet = meta.sheets.find((s) => s.properties.title === CONFIG.SHEET_RAW);
    if (!rawSheet) throw new Error('生データ sheet not found');
    const sheetId = rawSheet.properties.sheetId;

    // 全行取得
    const encoded = encodeURIComponent(`${CONFIG.SHEET_RAW}!A:I`);
    const dataRes = await apiGet(`/values/${encoded}`);
    const rows = dataRes.values || [];

    // ステップ1: （未解析）行を I 列から再パース
    // 単一支店は同じ行を更新、複数支店は1件目を更新+残りを末尾に append
    const appendRows = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const branch = String(r[2] || '');
      if (branch !== '（未解析）') continue;

      const iText = String(r[8] || '');
      if (!iText.trim()) continue;

      const parsed = parseBranchData(iText);
      if (parsed.length === 0) continue;

      const date = String(r[0] || '');
      const person = String(r[1] || '');
      const recordedAt = String(r[6] || '');

      // 1件目: 現在行を上書き
      const first = parsed[0];
      if (first.warn) continue;
      const rowNum = i + 1;
      await apiPut(
        `/values/${encodeURIComponent(`${CONFIG.SHEET_RAW}!A${rowNum}:H${rowNum}`)}?valueInputOption=USER_ENTERED`,
        {
          values: [[
            date, person, first.name,
            Number(first.calls), Number(first.pr), Number(first.apo),
            recordedAt, '✅正常（再パース）',
          ]],
        }
      );
      report.reparsed.push({ row: rowNum, branch: first.name, calls: first.calls, pr: first.pr, apo: first.apo });

      // 2件目以降: 末尾に追加
      for (let j = 1; j < parsed.length; j++) {
        const b = parsed[j];
        if (b.warn) continue;
        appendRows.push([
          date, person, b.name,
          Number(b.calls), Number(b.pr), Number(b.apo),
          recordedAt, '✅正常（再パース・追加）', '',
        ]);
        report.appended.push({ date, person, branch: b.name, calls: b.calls, pr: b.pr, apo: b.apo });
      }
    }

    if (appendRows.length > 0) {
      await apiPost(
        `/values/${encodeURIComponent(`${CONFIG.SHEET_RAW}!A:I`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { values: appendRows }
      );
    }

    // ステップ2: 重複行を削除
    // クエリパラメータで行番号を指定可能 (?deleteRows=32,33)
    const url = new URL(request.url);
    const delRowsParam = url.searchParams.get('deleteRows');
    if (delRowsParam) {
      const delRows = delRowsParam.split(',').map(Number).filter(Boolean).sort((a, b) => b - a); // 降順
      for (const rowNum of delRows) {
        await apiPost(':batchUpdate', {
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowNum - 1, // 0-indexed
                endIndex: rowNum,
              },
            },
          }],
        });
        report.deleted.push(rowNum);
      }
    }

    return Response.json({ ok: true, ...report, at: new Date().toISOString() });
  } catch (err) {
    console.error('cleanup error', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
