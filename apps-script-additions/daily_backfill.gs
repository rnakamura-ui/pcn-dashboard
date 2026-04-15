// ===================================================
// 毎朝 7:00 に自動バックフィル実行（堅牢化パッチ）
// 既存 Code.gs の末尾に貼り付けて保存してから、
// 1) installDailyBackfillTrigger() を手動実行（1回だけ）
// 2) backfillAllThreadReplies() を手動実行（即座に4/15データ取込）
// ===================================================

// 毎朝 7:00 JST に自動バックフィル実行するトリガーを設置
function installDailyBackfillTrigger() {
  // 既存の同名トリガーを削除（重複防止）
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyBackfill') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 毎朝 7:00 JST に dailyBackfill を実行するトリガーを作成
  ScriptApp.newTrigger('dailyBackfill')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log('✅ 毎朝7:00のバックフィルトリガーを設定しました');
}

// 日次バックフィル本体（トリガーから自動呼び出し）
function dailyBackfill() {
  var startTime = Date.now();
  try {
    Logger.log('🔄 日次バックフィル開始: ' + new Date().toString());
    backfillAllThreadReplies();
    var duration = Math.round((Date.now() - startTime) / 1000);
    Logger.log('✅ 日次バックフィル完了 (' + duration + '秒)');

    // 古いキャッシュキーも一緒にクリーンアップ
    cleanupOldEventIds();
  } catch (err) {
    Logger.log('❌ 日次バックフィルエラー: ' + err.toString());
    // エラーをSlackに通知（トークンがある場合のみ）
    var token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
    if (token) {
      try {
        UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'Authorization': 'Bearer ' + token },
          payload: JSON.stringify({
            channel: CONFIG.CHANNEL_ID,
            text: '⚠️ 日次バックフィル失敗\nエラー: ' + err.toString()
          }),
          muteHttpExceptions: true
        });
      } catch (e2) {
        Logger.log('Slack通知も失敗: ' + e2.toString());
      }
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
  Logger.log('✅ ' + count + '件のトリガーを削除しました');
}

// 現在設置されているトリガー一覧を確認
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log('トリガー数: ' + triggers.length);
  triggers.forEach(function(t, i) {
    Logger.log((i + 1) + ') ' + t.getHandlerFunction() +
               ' / type=' + t.getEventType() +
               ' / source=' + t.getTriggerSource());
  });
}
