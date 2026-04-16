// Google Sheets への書き込み（writeRawData / updateMonthlySheet / updateCumulativeSheet）
// Code.gs から移植。REST API v4 を直叩き。

import { getAccessToken } from './googleAuth.js';
import { CONFIG } from './parse.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function apiGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${CONFIG.SPREADSHEET_ID}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets GET ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${CONFIG.SPREADSHEET_ID}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheets POST ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPut(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${CONFIG.SPREADSHEET_ID}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheets PUT ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getSpreadsheetMeta() {
  return apiGet('?fields=sheets.properties');
}

async function ensureSheet(sheetName) {
  const meta = await getSpreadsheetMeta();
  const found = meta.sheets.find((s) => s.properties.title === sheetName);
  if (found) return found.properties;
  const res = await apiPost(':batchUpdate', {
    requests: [{ addSheet: { properties: { title: sheetName } } }],
  });
  return res.replies[0].addSheet.properties;
}

async function getValues(range) {
  const encoded = encodeURIComponent(range);
  const data = await apiGet(`/values/${encoded}`);
  return data.values || [];
}

async function appendValues(range, values) {
  const encoded = encodeURIComponent(range);
  return apiPost(
    `/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values }
  );
}

async function updateValues(range, values) {
  const encoded = encodeURIComponent(range);
  return apiPut(`/values/${encoded}?valueInputOption=USER_ENTERED`, { values });
}

// 生データ書き込み（重複チェック付き）
// return: true=書き込み、false=重複スキップ
export async function writeRawData(date, person, branch, calls, pr, apo, status, rawText) {
  await ensureSheet(CONFIG.SHEET_RAW);
  const rows = await getValues(`${CONFIG.SHEET_RAW}!A:I`);

  if (rows.length === 0) {
    await appendValues(`${CONFIG.SHEET_RAW}!A:I`, [[
      '日付', '担当者', '支店', '架電数', '着電数(PR数)', 'アポ数',
      '記録日時', 'ステータス', '定性所感（生テキスト）',
    ]]);
  }

  // 重複チェック（6項目一致）
  if (branch !== '（未解析）' && calls !== '' && pr !== '' && apo !== '') {
    const nCalls = Number(calls), nPr = Number(pr), nApo = Number(apo);
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const existDate = String(r[0] || '').trim();
      if (
        existDate === date &&
        String(r[1] || '') === person &&
        String(r[2] || '') === branch &&
        Number(r[3]) === nCalls &&
        Number(r[4]) === nPr &&
        Number(r[5]) === nApo
      ) {
        return false;
      }
    }
  }

  const now = new Date();
  const jstStamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now).replace(' ', ' ').replace(/-/g, '/');

  await appendValues(`${CONFIG.SHEET_RAW}!A:I`, [[
    date,
    person,
    branch,
    calls !== '' ? Number(calls) : '',
    pr !== '' ? Number(pr) : '',
    apo !== '' ? Number(apo) : '',
    jstStamp,
    status,
    rawText || '',
  ]]);
  return true;
}

function aggregateHeaders() {
  return [
    '担当者', '支店', '架電数', '着電数(PR数)', 'アポ数',
    '①架電to着電', '②着電toアポ', '③架電toアポ',
  ];
}

async function ensureAggregateSheet(sheetName) {
  await ensureSheet(sheetName);
  const rows = await getValues(`${sheetName}!A1:H1`);
  if (rows.length === 0 || !rows[0] || rows[0].length === 0) {
    await updateValues(`${sheetName}!A1:H1`, [aggregateHeaders()]);
  }
}

async function updateAggregateSheet(sheetName, person, branchData) {
  await ensureAggregateSheet(sheetName);
  const rows = await getValues(`${sheetName}!A:H`);

  for (const branch of branchData) {
    if (branch.warn) continue;

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i] || [])[0] === person && (rows[i] || [])[1] === branch.name) {
        rowIndex = i + 1; // 1-indexed
        break;
      }
    }

    const nCalls = Number(branch.calls) || 0;
    const nPr = Number(branch.pr) || 0;
    const nApo = Number(branch.apo) || 0;

    if (rowIndex === -1) {
      const newRowIndex = rows.length + 1;
      const formulas = [
        person, branch.name, nCalls, nPr, nApo,
        `=IFERROR(IF(C${newRowIndex}=0,"",D${newRowIndex}/C${newRowIndex}),"")`,
        `=IFERROR(IF(D${newRowIndex}=0,"",E${newRowIndex}/D${newRowIndex}),"")`,
        `=IFERROR(IF(C${newRowIndex}=0,"",E${newRowIndex}/C${newRowIndex}),"")`,
      ];
      await updateValues(`${sheetName}!A${newRowIndex}:H${newRowIndex}`, [formulas]);
      rows.push(formulas);
    } else {
      const cur = rows[rowIndex - 1] || [];
      const newCalls = (Number(cur[2]) || 0) + nCalls;
      const newPr = (Number(cur[3]) || 0) + nPr;
      const newApo = (Number(cur[4]) || 0) + nApo;
      await updateValues(`${sheetName}!C${rowIndex}:E${rowIndex}`, [[newCalls, newPr, newApo]]);
    }
  }
}

export async function updateMonthlySheet(date, person, branchData) {
  const [year, month] = date.split('/');
  const sheetName = `${year}年${parseInt(month, 10)}月`;
  await updateAggregateSheet(sheetName, person, branchData);
}

export async function updateCumulativeSheet(person, branchData) {
  await updateAggregateSheet(CONFIG.SHEET_CUMULATIVE, person, branchData);
}
