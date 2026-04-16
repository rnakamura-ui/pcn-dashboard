// ===================================================
// 過去スレッド一括取込み（Slackから欠損データを自動リカバー）
// ===================================================
function backfillAllThreadReplies() {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    Logger.log('[ERROR] SLACK_BOT_TOKEN が設定されていません');
    return;
  }

  let cursor = '';
  let totalProcessed = 0;
  let totalSkipped = 0;
  const maxPages = 20;
  let page = 0;

  while (page < maxPages) {
    let url = 'https://slack.com/api/conversations.history?channel=' + CONFIG.CHANNEL_ID + '&limit=100';
    if (cursor) url += '&cursor=' + encodeURIComponent(cursor);

    const res = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    const data = JSON.parse(res.getContentText());
    if (!data.ok) { Logger.log('API エラー: ' + data.error); break; }

    const messages = data.messages || [];
    if (messages.length === 0) break;

    for (const msg of messages) {
      if (msg.bot_id !== CONFIG.SLACK_BOT_ID) continue;
      const msgText = msg.text || '';
      if (!msgText.includes(CONFIG.TARGET_PROJECT)) continue;
      if (!msg.reply_count || msg.reply_count === 0) continue;

      const threadUrl = 'https://slack.com/api/conversations.replies?channel=' + CONFIG.CHANNEL_ID + '&ts=' + msg.ts + '&limit=50';
      const threadRes = UrlFetchApp.fetch(threadUrl, {
        headers: { 'Authorization': 'Bearer ' + token },
        muteHttpExceptions: true
      });
      const threadData = JSON.parse(threadRes.getContentText());
      if (!threadData.ok) continue;

      const date = extractDate(msgText);
      const person = extractPersonName(msgText);
      if (!date || !person) continue;

      for (const reply of threadData.messages || []) {
        if (reply.ts === msg.ts) continue;
        const replyText = getTextFromEvent(reply);
        const isBotSokan = (reply.bot_id === CONFIG.SLACK_BOT_ID && replyText.includes('定性所感'));
        const isUserReply = (!reply.bot_id && hasBranchData(replyText));
        if (!isBotSokan && !isUserReply) continue;

        const branchData = parseBranchData(replyText);
        if (branchData.length === 0) continue;

        const newBranches = [];
        for (const branch of branchData) {
          if (branch.warn) continue;
          const written = writeRawData(date, person, branch.name, branch.calls, branch.pr, branch.apo, '[OK] 一括取込', '');
          if (written) {
            newBranches.push(branch);
            totalProcessed++;
            Logger.log('取込: ' + date + ' ' + person + ' ' + branch.name + ' 架電' + branch.calls);
          } else {
            totalSkipped++;
          }
        }
        if (newBranches.length > 0) {
          updateMonthlySheet(date, person, newBranches);
          updateCumulativeSheet(person, newBranches);
        }
      }
      Utilities.sleep(300);
    }

    if (data.response_metadata && data.response_metadata.next_cursor) {
      cursor = data.response_metadata.next_cursor;
      page++;
    } else break;
  }

  Logger.log('[DONE] 一括取込完了: 新規追加=' + totalProcessed + '件, 重複スキップ=' + totalSkipped + '件');
}

// ===================================================
// 毎朝 7:00 に自動バックフィル実行（一度だけ実行して仕込む）
// ===================================================
function installDailyBackfillTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyBackfill') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('dailyBackfill')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  Logger.log('[OK] 毎朝7:00のバックフィルトリガーを設定しました');
}

// 日次バックフィル本体（トリガーから自動呼び出し）
function dailyBackfill() {
  var startTime = Date.now();
  try {
    Logger.log('[START] 日次バックフィル開始: ' + new Date().toString());
    backfillAllThreadReplies();
    var duration = Math.round((Date.now() - startTime) / 1000);
    Logger.log('[DONE] 日次バックフィル完了 (' + duration + '秒)');
    if (typeof cleanupOldEventIds === 'function') cleanupOldEventIds();
  } catch (err) {
    Logger.log('[ERROR] 日次バックフィルエラー: ' + err.toString());
    var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
    if (token) {
      try {
        UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'Authorization': 'Bearer ' + token },
          payload: JSON.stringify({
            channel: CONFIG.CHANNEL_ID,
            text: '[WARN] 日次バックフィル失敗\nエラー: ' + err.toString()
          }),
          muteHttpExceptions: true
        });
      } catch (e2) {}
    }
  }
}

// トリガー解除（不要になったら実行）
function uninstallDailyBackfillTrigger() {
  var count = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyBackfill') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  Logger.log('[OK] ' + count + '件のトリガーを削除しました');
}

// 現在のトリガー一覧を確認
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log('トリガー数: ' + triggers.length);
  triggers.forEach(function(t, i) {
    Logger.log((i + 1) + ') ' + t.getHandlerFunction() +
               ' / type=' + t.getEventType() +
               ' / source=' + t.getTriggerSource());
  });
}
