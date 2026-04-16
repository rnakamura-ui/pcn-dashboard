// パースロジックのスモークテスト（依存なし、ローカル実行）
// 実行: node lib/slack/__smoke.test.mjs

import {
  extractDate, extractPersonName, parseBranchData,
  normalizeText, hasBranchData, getTextFromEvent,
} from './parse.js';

let pass = 0, fail = 0;
function t(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`); }
}

console.log('## extractDate');
t('standard', extractDate('2026年4月15日の報告'), '2026/04/15');
t('single digit', extractDate('2026年3月7日'), '2026/03/07');
t('no date', extractDate('日付なし'), null);

console.log('\n## extractPersonName');
t('mention with display', extractPersonName('<@U123|清水陸斗> の報告'), '清水陸斗');
t('plain at-mention', extractPersonName('2026年4月3日の\n@清水陸斗 の\nパシフィックネット'), '清水陸斗');
t('simple at', extractPersonName('@中村凌 の'), '中村凌');

console.log('\n## normalizeText');
t('fullwidth num', normalizeText('仙台１２３'), '仙台123');
t('punctuation', normalizeText('仙台、架電・着電。アポ'), '仙台,架電,着電,アポ');

console.log('\n## hasBranchData');
t('has branch+num', hasBranchData('仙台 架電100'), true);
t('branch no num', hasBranchData('仙台について'), false);
t('num no branch', hasBranchData('100件'), false);

console.log('\n## parseBranchData (基本)');
const text1 = `定性所感
仙台、架電数：100、着電数：10、アポ数：2
札幌、架電数：80、着電数：8、アポ数：1`;
t('2 branches', parseBranchData(text1), [
  { name: '仙台', calls: 100, pr: 10, apo: 2, warn: false },
  { name: '札幌', calls: 80, pr: 8, apo: 1, warn: false },
]);

console.log('\n## parseBranchData (北海道→札幌変換)');
const text2 = `北海道 架電数50 着電数5 アポ数1`;
t('hokkaido→sapporo', parseBranchData(text2), [
  { name: '札幌', calls: 50, pr: 5, apo: 1, warn: false },
]);

console.log('\n## parseBranchData (全角数字)');
const text3 = `東京、架電数：１２０、着電数：１２、アポ数：３`;
t('fullwidth', parseBranchData(text3), [
  { name: '東京', calls: 120, pr: 12, apo: 3, warn: false },
]);

console.log('\n## parseBranchData (大阪対応)');
const text4 = `大阪、架電数：55、着電数：5、アポ数：1`;
t('osaka', parseBranchData(text4), [
  { name: '大阪', calls: 55, pr: 5, apo: 1, warn: false },
]);

console.log('\n## getTextFromEvent');
t('plain text', getTextFromEvent({ text: 'hello' }), 'hello');
t('rich_text blocks', getTextFromEvent({
  text: 'short',
  blocks: [{ type: 'rich_text', elements: [{ elements: [{ type: 'text', text: 'full content from block' }] }] }],
}), 'full content from block');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
