// Slackイベント処理のメインロジック（Code.gs の processEvent / handleDefinedSokan に相当）

import {
  CONFIG, getTextFromEvent, hasBranchData, extractDate,
  extractPersonName, parseBranchData,
} from './parse.js';
import { writeRawData, updateMonthlySheet, updateCumulativeSheet } from './sheets.js';
import { slackApi, slackPostMessage } from './slackApi.js';

async function fetchParentMessageData(channel, ts) {
  try {
    const data = await slackApi('conversations.replies', {
      channel, ts, limit: '1', inclusive: 'true',
    });
    const msg = data.messages && data.messages[0];
    if (!msg) return null;
    const text = getTextFromEvent(msg);
    if (!text.includes(CONFIG.TARGET_PROJECT)) return null;
    const date = extractDate(text);
    const person = extractPersonName(text);
    if (!date || !person) return null;
    return { date, person };
  } catch (e) {
    console.error('fetchParentMessageData error', e);
    return null;
  }
}

async function handleDefinedSokan(event, text) {
  const threadTs = event.thread_ts;
  const parent = await fetchParentMessageData(event.channel, threadTs);
  if (!parent) {
    console.log('Parent message not found for thread', threadTs);
    return;
  }
  const { date, person } = parent;
  const branchData = parseBranchData(text);

  if (branchData.length === 0) {
    await writeRawData(date, person, '（未解析）', '', '', '', '⚠️要確認', text);
    await slackPostMessage(
      event.channel,
      `⚠️ *転記エラー通知*\n担当者: ${person}\n定性所感の支店データが読み取れませんでした。\n正しい形式で再入力をお願いします👇\n\`\`\`仙台、架電数：30、着電数：3、アポ数：1\n札幌、架電数：20、着電数：2、アポ数：0\`\`\``,
      threadTs
    );
    return;
  }

  const newBranches = [];
  for (const branch of branchData) {
    const written = await writeRawData(
      date, person, branch.name, branch.calls, branch.pr, branch.apo, '✅正常', ''
    );
    if (written) newBranches.push(branch);
  }
  if (newBranches.length === 0) return;

  await updateMonthlySheet(date, person, newBranches);
  await updateCumulativeSheet(person, newBranches);
  console.log(`転記完了: ${person} / ${date} / ${newBranches.length}支店`);
}

export async function processSlackEvent(event) {
  if (event.channel && event.channel !== CONFIG.CHANNEL_ID) return;

  const text = getTextFromEvent(event);
  const isThreadReply = !!(event.thread_ts && event.thread_ts !== event.ts);

  if (isThreadReply) {
    if (event.bot_id === CONFIG.SLACK_BOT_ID && text.includes('定性所感')) {
      await handleDefinedSokan(event, text);
      return;
    }
    if (!event.bot_id && hasBranchData(text)) {
      await handleDefinedSokan(event, text);
      return;
    }
    return;
  }

  // メインメッセージは親としてSlack API経由で後から取得するので、
  // 保存不要（fetchParentMessageData で都度取得する設計）
}

export async function backfillRecentThreads(limit = 50) {
  const data = await slackApi('conversations.history', {
    channel: CONFIG.CHANNEL_ID, limit: String(limit),
  });
  const messages = data.messages || [];
  let processed = 0, skipped = 0;

  for (const msg of messages) {
    if (msg.bot_id !== CONFIG.SLACK_BOT_ID) continue;
    const msgText = msg.text || '';
    if (!msgText.includes(CONFIG.TARGET_PROJECT)) continue;
    if (!msg.reply_count || msg.reply_count === 0) continue;

    const threadData = await slackApi('conversations.replies', {
      channel: CONFIG.CHANNEL_ID, ts: msg.ts, limit: '50',
    });
    const date = extractDate(msgText);
    const person = extractPersonName(msgText);
    if (!date || !person) continue;

    for (const reply of threadData.messages || []) {
      if (reply.ts === msg.ts) continue;
      const replyText = getTextFromEvent(reply);
      const isBotSokan = reply.bot_id === CONFIG.SLACK_BOT_ID && replyText.includes('定性所感');
      const isUserReply = !reply.bot_id && hasBranchData(replyText);
      if (!isBotSokan && !isUserReply) continue;

      const branchData = parseBranchData(replyText);
      if (branchData.length === 0) continue;

      const newBranches = [];
      for (const branch of branchData) {
        if (branch.warn) continue;
        const written = await writeRawData(
          date, person, branch.name, branch.calls, branch.pr, branch.apo,
          '✅正常（一括取込）', ''
        );
        if (written) { newBranches.push(branch); processed++; }
        else skipped++;
      }
      if (newBranches.length > 0) {
        await updateMonthlySheet(date, person, newBranches);
        await updateCumulativeSheet(person, newBranches);
      }
    }
  }
  return { processed, skipped };
}
