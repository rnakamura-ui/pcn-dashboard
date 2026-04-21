// ナイトリー監査: 直近N日のSlackスレッドとスプシの乖離を検出
// GET /api/slack/audit?days=14[&autofix=1]  (Bearer CRON_SECRET)

import {
  CONFIG, getTextFromEvent, hasBranchData, extractDate,
  extractPersonName, parseBranchData,
} from '@/lib/slack/parse';
import { slackApi, slackPostMessage } from '@/lib/slack/slackApi';
import { getAccessToken } from '@/lib/slack/googleAuth';
import { writeRawData, updateMonthlySheet, updateCumulativeSheet } from '@/lib/slack/sheets';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4';
const AUDIT_DM_USER = process.env.AUDIT_DM_USER || 'U095ULYG0TE'; // 通知先 Slack User ID

async function fetchSheetRows() {
  const token = await getAccessToken();
  const range = encodeURIComponent('生データ!A:H');
  const res = await fetch(`${SHEETS_API}/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets GET ${res.status}`);
  const data = await res.json();
  return data.values || [];
}

function buildSheetIndex(rows) {
  // key: date|person|branch -> { calls, pr, apo, status, rowIdx }
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const date = String(r[0] || '').trim();
    const person = String(r[1] || '').trim();
    const branch = String(r[2] || '').trim();
    if (!date || !person || !branch || branch === '（未解析）') continue;
    const key = `${date}|${person}|${branch}`;
    index.set(key, {
      calls: Number(r[3]) || 0,
      pr: Number(r[4]) || 0,
      apo: Number(r[5]) || 0,
      status: String(r[7] || ''),
    });
  }
  return index;
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '14', 10), 1), 60);
  const autofix = url.searchParams.get('autofix') === '1';

  try {
    // 1. Slack channel history — days * ~15msg/day を目安に、最低500
    const historyLimit = Math.min(Math.max(days * 30, 500), 1000);
    const history = await slackApi('conversations.history', {
      channel: CONFIG.CHANNEL_ID, limit: String(historyLimit),
    });
    const cutoffTs = (Date.now() / 1000) - days * 86400;
    const parents = (history.messages || []).filter(
      (m) => m.bot_id === CONFIG.SLACK_BOT_ID
        && Number(m.ts) >= cutoffTs
        && (m.text || '').includes(CONFIG.TARGET_PROJECT)
        && m.reply_count > 0
    );

    // 2. スプシを先に1回だけ読む
    const sheetRows = await fetchSheetRows();
    const sheetIndex = buildSheetIndex(sheetRows);

    const anomalies = { missing: [], mismatch: [], no_human_reply: [] };
    const autofixed = [];
    const debug = url.searchParams.get('debug') === '1' ? [] : null;

    for (const parent of parents) {
      const parentText = parent.text || '';
      const date = extractDate(parentText);
      const person = extractPersonName(parentText);
      if (!date || !person) {
        if (debug) debug.push({ ts: parent.ts, skipped: 'no date or person', date, person });
        continue;
      }

      // スレッドから人間返信を取得
      const thread = await slackApi('conversations.replies', {
        channel: CONFIG.CHANNEL_ID, ts: parent.ts, limit: '50',
      });
      const humanReplies = (thread.messages || []).filter(
        (m) => m.ts !== parent.ts && !m.bot_id && hasBranchData(getTextFromEvent(m))
      );

      if (humanReplies.length === 0) {
        // 人間返信がない → Bot 定性所感のみ依拠。今回は警告のみ
        const hasBotSokan = (thread.messages || []).some(
          (m) => m.ts !== parent.ts && m.bot_id === CONFIG.SLACK_BOT_ID
            && getTextFromEvent(m).includes('定性所感')
        );
        if (hasBotSokan) {
          anomalies.no_human_reply.push({ date, person, thread_ts: parent.ts });
        }
        continue;
      }

      // 人間返信をパースし、期待値を構築
      const expected = [];
      for (const reply of humanReplies) {
        const branches = parseBranchData(getTextFromEvent(reply));
        for (const b of branches) {
          if (b.warn) continue;
          expected.push({
            date, person, name: b.name,
            calls: b.calls, pr: b.pr, apo: b.apo,
          });
        }
      }
      if (debug) debug.push({ ts: parent.ts, date, person, humanReplyCount: humanReplies.length, expected });

      // スプシと突合
      for (const e of expected) {
        const key = `${e.date}|${e.person}|${e.name}`;
        const sheet = sheetIndex.get(key);
        if (!sheet) {
          anomalies.missing.push(e);
          if (autofix) {
            const ok = await writeRawData(
              e.date, e.person, e.name, e.calls, e.pr, e.apo,
              '✅正常（監査補完）', ''
            );
            if (ok) {
              await updateMonthlySheet(e.date, e.person, [{ ...e, warn: false }]);
              await updateCumulativeSheet(e.person, [{ ...e, warn: false }]);
              autofixed.push(e);
            }
          }
        } else if (sheet.calls !== e.calls || sheet.pr !== e.pr || sheet.apo !== e.apo) {
          anomalies.mismatch.push({ ...e, sheet });
        }
      }
    }

    // 3. Slack DM で通知
    const total = anomalies.missing.length + anomalies.mismatch.length + anomalies.no_human_reply.length;
    if (total > 0) {
      const fmtRow = (r) => `• ${r.date} / ${r.person} / ${r.name} / ${r.calls}/${r.pr}/${r.apo}`;
      const fmtMismatch = (r) =>
        `• ${r.date} / ${r.person} / ${r.name}\n  期待: ${r.calls}/${r.pr}/${r.apo}  スプシ: ${r.sheet.calls}/${r.sheet.pr}/${r.sheet.apo}`;
      const fmtNoHuman = (r) => `• ${r.date} / ${r.person}`;

      const lines = [`📊 *PCNダッシュボード監査レポート* (直近${days}日)`];
      if (anomalies.missing.length > 0) {
        lines.push(`\n🔴 *スプシ未反映* (${anomalies.missing.length}件)${autofix ? ' — 自動補完済' : ''}`);
        anomalies.missing.forEach((r) => lines.push(fmtRow(r)));
      }
      if (anomalies.mismatch.length > 0) {
        lines.push(`\n🟡 *値の食い違い* (${anomalies.mismatch.length}件)`);
        anomalies.mismatch.forEach((r) => lines.push(fmtMismatch(r)));
      }
      if (anomalies.no_human_reply.length > 0) {
        lines.push(`\n🔵 *人間返信なし・Bot定性所感のみ* (${anomalies.no_human_reply.length}件) — 値の正確性を確認してください`);
        anomalies.no_human_reply.forEach((r) => lines.push(fmtNoHuman(r)));
      }
      await slackPostMessage(AUDIT_DM_USER, lines.join('\n'));
    } else if (url.searchParams.get('notify_ok') === '1') {
      await slackPostMessage(AUDIT_DM_USER, `✅ PCN監査OK (直近${days}日、異常なし)`);
    }

    return Response.json({
      ok: true, days, autofix, anomalies, autofixed,
      ...(debug ? { debug, history_count: (history.messages || []).length } : {}),
      counts: {
        parents_checked: parents.length,
        missing: anomalies.missing.length,
        mismatch: anomalies.mismatch.length,
        no_human_reply: anomalies.no_human_reply.length,
        autofixed: autofixed.length,
      },
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('audit error', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
