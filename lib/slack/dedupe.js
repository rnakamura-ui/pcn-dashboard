// 生データシートから完全重複行を検出して削除する
// 重複判定: 日付+担当者+支店+架電+着電+アポ の6項目一致
// 最も古い行（最初に現れた行）を残し、後続を削除

import { CONFIG } from './parse.js';
import { getAccessToken } from './googleAuth.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4';

export async function dedupeRawData() {
  const token = await getAccessToken();

  // シートIDを取得
  const metaRes = await fetch(
    `${SHEETS_API}/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  const sheet = meta.sheets.find((s) => s.properties.title === CONFIG.SHEET_RAW);
  if (!sheet) throw new Error('生データ sheet not found');
  const sheetId = sheet.properties.sheetId;

  const encoded = encodeURIComponent(`${CONFIG.SHEET_RAW}!A:H`);
  const dataRes = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}/values/${encoded}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await dataRes.json();
  const rows = data.values || [];

  // 重複検出
  const seen = new Map();
  const toDelete = []; // 削除対象行番号（1-indexed）
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
    if (seen.has(key)) {
      toDelete.push(i + 1); // 後続行を削除対象
    } else {
      seen.set(key, i + 1);
    }
  }

  if (toDelete.length === 0) return { deleted: 0, rows: [] };

  // 降順で削除（index ずれ防止）
  toDelete.sort((a, b) => b - a);
  const requests = toDelete.map((rowNum) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: rowNum - 1,
        endIndex: rowNum,
      },
    },
  }));

  const batchRes = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!batchRes.ok) throw new Error(`dedupe batchUpdate ${batchRes.status}: ${await batchRes.text()}`);

  return { deleted: toDelete.length, rows: toDelete.sort((a, b) => a - b) };
}
