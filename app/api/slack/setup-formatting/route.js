// 生データシートに重複ハイライトの条件付き書式を設定（一度限り）
// GET /api/slack/setup-formatting with Bearer CRON_SECRET

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

    const metaRes = await fetch(
      `${SHEETS_API}/${SPREADSHEET_ID}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await metaRes.json();
    const sheet = meta.sheets.find((s) => s.properties.title === CONFIG.SHEET_RAW);
    if (!sheet) throw new Error('生データ sheet not found');
    const sheetId = sheet.properties.sheetId;

    // 既存の重複ハイライトルールを全削除（冪等化）
    const batchUpdate = async (requests) => {
      const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
      if (!res.ok) throw new Error(`batchUpdate ${res.status}: ${await res.text()}`);
      return res.json();
    };

    // 既存のルール数を取得
    const ruleCheck = await fetch(
      `${SHEETS_API}/${SPREADSHEET_ID}?fields=sheets(properties,conditionalFormats)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const ruleCheckData = await ruleCheck.json();
    const targetSheet = ruleCheckData.sheets.find((s) => s.properties.sheetId === sheetId);
    const existingRules = (targetSheet && targetSheet.conditionalFormats) || [];

    // 既存ルールを降順で削除（index ずれ防止）
    const deleteRequests = [];
    for (let i = existingRules.length - 1; i >= 0; i--) {
      deleteRequests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
    }
    if (deleteRequests.length > 0) await batchUpdate(deleteRequests);

    // 重複ハイライトルールを追加
    // 日付+担当者+支店+架電+着電+アポ が2件以上ある行を赤くする
    const formula = '=COUNTIFS($A:$A,$A2,$B:$B,$B2,$C:$C,$C2,$D:$D,$D2,$E:$E,$E2,$F:$F,$F2)>1';

    await batchUpdate([{
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: 1, // 2行目以降（ヘッダー除く）
            startColumnIndex: 0,
            endColumnIndex: 9, // A-I
          }],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: formula }],
            },
            format: {
              backgroundColor: { red: 1.0, green: 0.85, blue: 0.85 },
            },
          },
        },
      },
    }]);

    return Response.json({
      ok: true,
      message: '条件付き書式を設定しました',
      removedRules: deleteRequests.length,
      formula,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('setup-formatting error', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
