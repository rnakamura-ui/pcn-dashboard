// Slackイベントのテキスト抽出・日付/担当者/支店データのパース
// Code.gs (pcn_slack_to_sheets) から移植

export const CONFIG = {
  SPREADSHEET_ID: process.env.SPREADSHEET_ID || '1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4',
  SLACK_BOT_ID: process.env.SLACK_BOT_ID || 'B0A5FK15QBH',
  CHANNEL_ID: process.env.SLACK_CHANNEL_ID || 'C04LDEQNZN3',
  TARGET_PROJECT: 'パシフィックネット',
  SHEET_RAW: '生データ',
  SHEET_CUMULATIVE: '全月累計',
  BRANCHES: ['仙台', '札幌', '北海道', '東京', '東海', '福岡', '大阪'],
};

export function getTextFromEvent(event) {
  let text = event.text || '';
  if (event.blocks && Array.isArray(event.blocks)) {
    const parts = [];
    event.blocks.forEach((block) => {
      if (block.type === 'section' && block.text && block.text.text) {
        parts.push(block.text.text);
      }
      if (block.type === 'rich_text' && block.elements) {
        // rich_text_section/list 内のサブ要素（太字/リンク等）は同一行として結合、
        // section同士は改行で分ける
        block.elements.forEach((el) => {
          if (el.elements) {
            const chunks = [];
            el.elements.forEach((sub) => {
              if (sub.type === 'text') chunks.push(sub.text);
              else if (sub.type === 'link') chunks.push(sub.text || sub.url || '');
            });
            if (chunks.length > 0) parts.push(chunks.join(''));
          }
        });
      }
    });
    if (parts.length > 0) {
      const blockText = parts.join('\n');
      if (blockText.length > text.length) text = blockText;
    }
  }
  return text;
}

export function hasBranchData(text) {
  for (const b of CONFIG.BRANCHES) {
    if (text.includes(b) && /[0-9０-９]/.test(text)) return true;
  }
  return false;
}

export function extractDate(text) {
  const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return m[1] + '/' + m[2].padStart(2, '0') + '/' + m[3].padStart(2, '0');
}

// Slack ID → 正式な漢字名 / 表記ゆれ修正
export const NAME_CORRECTIONS = {
  '中村做': '中村凌',
  'U09S1CB6NER': '清水陸斗',
  'U0AGPB39UB0': '浦上開至',
  'U095ULYG0TE': '中村凌',
  'U0A7WKGSR39': '原田幸輝',
  '浦上開至/KaishinUrakami': '浦上開至',
  '浦上開至/Kaishin Urakami': '浦上開至',
};

export function normalizeName(name) {
  if (!name) return name;
  const trimmed = name.replace(/[\s　]+/g, '');
  return NAME_CORRECTIONS[trimmed] || NAME_CORRECTIONS[name] || trimmed;
}

export function extractPersonName(text) {
  const m1 = text.match(/<@[^|>]+\|([^>]+)>/);
  if (m1) return normalizeName(m1[1].trim());
  const m2 = text.match(/@([^\s<>\n]+)\s*の/);
  if (m2) return normalizeName(m2[1].trim());
  const m3 = text.match(/@([^\s<>\n、。]+)/);
  if (m3) return normalizeName(m3[1].trim());
  // <@USERID> 形式（表示名なし）
  const m4 = text.match(/<@([^|>]+)>/);
  if (m4) return normalizeName(m4[1].trim());
  return null;
}

export function normalizeText(text) {
  return text
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[：]/g, ':')
    .replace(/[、，,。・]/g, ',')
    .replace(/　/g, ' ');
}

function extractNumber(text, keywords) {
  for (const kw of keywords) {
    const pattern = new RegExp(kw + '[：: ]*([0-9]+)');
    const m = text.match(pattern);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

export function parseBranchData(text) {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');
  const results = [];
  const seen = new Set();

  for (const line of lines) {
    if (line.includes('定性所感')) continue;
    if (!line.trim()) continue;

    let foundBranch = null;
    for (const b of CONFIG.BRANCHES) {
      if (line.includes(b)) { foundBranch = b; break; }
    }
    if (!foundBranch) continue;

    const branchName = foundBranch === '北海道' ? '札幌' : foundBranch;
    if (seen.has(branchName)) continue;
    seen.add(branchName);

    const calls = extractNumber(line, ['架電数', '架電']);
    const pr = extractNumber(line, ['着電数', 'PR数', 'PR', '着電']);
    const apo = extractNumber(line, ['アポ数', 'アポ']);

    if (calls === null && pr === null && apo === null) {
      results.push({ name: branchName, calls: '', pr: '', apo: '', warn: true });
    } else {
      results.push({
        name: branchName,
        calls: calls ?? 0,
        pr: pr ?? 0,
        apo: apo ?? 0,
        warn: false,
      });
    }
  }
  return results;
}
