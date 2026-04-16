# Slack→Sheets 自動転記のセットアップ

GAS版と同等の自動転記を Next.js API Route に移植済み。以下の手順で本番稼働させる。

## セットアップ進捗（2026-04-16）

- [x] 1-A: GCPプロジェクト選択（`korean-study-app` / ID: `korean-study-app-21ccb` を流用）
- [x] 1-B: Google Sheets API 有効化済み
- [x] 1-C-1: サービスアカウント作成済み（`pcn-sheets-writer@korean-study-app-21ccb.iam.gserviceaccount.com`）
- [x] 1-C-2: JSONキー発行済み（2026/04/16）
- [x] 1-D: スプレッドシート共有済み（編集者権限）
- [x] 2-A: Signing Secret 取得済み
- [x] 2-B: Bot Token 取得済み
- [x] 2-C: Request URL に Next.js URL 貼付（まだSave前）。旧URLはGAS Webhookだった
- [ ] 2-D: Request URL の Verify（デプロイ後に実施）
- [x] 3: Vercel 環境変数5件設定済み
- [x] 4-A: ローカルコミット作成（commit `4027960`）
- [x] 4-B: git push 完了（commit 4027960 → main）
- [x] 4-C: Vercelデプロイ成功、/api/slack/health 全env=true
- [x] 5: Slack Verified ✅ 確認（Save Changes済み）
- [x] 6: 手動バックフィル疎通確認（processed=12, skipped=0）✅
- [x] 7: 名前正規化（NAME_CORRECTIONS移植、fix-namesで既存データ44セル修正）✅
- [x] 8: 22:00 JST cron 追加（朝07:00 + 夜22:00 の2本運用）✅
- [x] 9: 重複検出エンドポイント `/api/slack/duplicates` 追加・push済み
- [x] 10: 条件付き書式設定エンドポイント `/api/slack/setup-formatting` 追加・push済み（実行待ち）
- [x] 11: バックフィル末尾に `dedupeRawData()` 自動呼び出し追加・push済み
- [x] 12: 全実行完了 (2026-04-16 14:41 JST)
    - ✅ 条件付き書式設定完了（赤ハイライトで重複可視化）
    - ✅ cleanup実行: 行14→福岡71/7/0, 行15→東海54/7/0, 札幌21/1/0追加, 行32削除
    - ✅ 自動dedupeで追加重複3行削除（行17, 33, 45）
    - ✅ 最終重複ゼロ確認

## エンドポイント一覧
| URL | 用途 |
|---|---|
| `/api/slack/health` | 環境変数チェック |
| `/api/slack/events` | Slack Event受信（Slack側設定済） |
| `/api/slack/backfill` | 手動/cronバックフィル（末尾で自動dedupe） |
| `/api/slack/duplicates` | 重複検出（読み取り専用） |
| `/api/slack/fix-names` | 担当者名正規化 |
| `/api/slack/setup-formatting` | 重複ハイライト条件付き書式設定 |
| `/api/slack/cleanup` | （未解析）再パース+指定行削除 |

## 🎉 セットアップ完了（2026-04-16 13:50 JST）

- Slack → Next.js API → Google Sheets の自動転記が稼働中
- 毎朝 07:00 JST に Vercel Cron が自動バックフィル実行
- 旧GAS Webhook は Slack 側URL変更により自動的に呼ばれなくなった（GASプロジェクト自体は残置）

---

## 1. Google Service Account 作成

1. https://console.cloud.google.com/ でプロジェクト選択（既存で可）
2. IAM → サービスアカウント → 作成（例: `pcn-sheets-writer`）
3. キーを追加 → JSON → ダウンロード
4. **対象スプレッドシート**（`1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4`）をそのサービスアカウントのメール（`...iam.gserviceaccount.com`）に**編集者**として共有
5. API 有効化: Google Cloud Console → 「Google Sheets API」を Enable

## 2. Slack App 設定変更

1. https://api.slack.com/apps → 対象Bot
2. **Event Subscriptions** → Request URL を変更:
   ```
   https://pcn-dashboard-app.vercel.app/api/slack/events
   ```
3. Subscribe to bot events に `message.channels` が入っていることを確認
4. **Basic Information** → Signing Secret をコピー（後で使う）
5. **OAuth & Permissions** → Bot Token (`xoxb-...`) をコピー

## 3. Vercel 環境変数設定

Vercel プロジェクト設定 → Environment Variables に以下を追加（Production + Preview + Development 全て）:

| Key | Value |
|---|---|
| `SLACK_SIGNING_SECRET` | Slack App の Signing Secret |
| `SLACK_BOT_TOKEN` | `xoxb-...` |
| `SLACK_BOT_ID` | `B0A5FK15QBH`（既定なので省略可） |
| `SLACK_CHANNEL_ID` | `C04LDEQNZN3`（既定なので省略可） |
| `SPREADSHEET_ID` | `1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4`（既定なので省略可） |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 手順1でDLしたJSONの中身を**そのまま**貼るか、base64エンコードして貼る |
| `CRON_SECRET` | 任意のランダム文字列（cron認証用） |

### GOOGLE_SERVICE_ACCOUNT_JSON の入れ方
JSONをそのまま貼っても動くが、改行混入トラブル回避なら base64 推奨:
```bash
base64 -w 0 service-account.json    # Linux
base64 -i service-account.json      # macOS
```
出力を Vercel に貼る（コード側で両形式自動判定）。

## 4. デプロイ

```bash
cd C:/Users/user/Desktop/pcn-dashboard
git add .
git commit -m "feat: slack→sheets auto-transcription API routes"
git push
```
Vercel が自動デプロイ。

## 5. 動作確認

### 5-1. Slack Event URL の Verified
Slack App の Event Subscriptions 画面で Request URL の横に ✅ Verified が出ればOK。

### 5-2. 手動バックフィル
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://pcn-dashboard-app.vercel.app/api/slack/backfill
```
レスポンス例: `{"ok":true,"processed":12,"skipped":3,"at":"..."}`

### 5-3. 本番のSlack投稿テスト
実績報告Botの新投稿に対して、生データシートに自動で行が増えることを確認。

## 6. 自動バックフィル

`vercel.json` の `crons` 設定で毎朝 **07:00 JST**（UTC 22:00）に `/api/slack/backfill` を自動実行（Vercel Cron）。
直近50件のスレッドを遡って欠損データをリカバーする。

## 7. GAS 版の処遇

Next.js版が安定稼働したら GAS Webhook は無効化してOK:
- Slack App の Request URL は Next.js に変わるので、GAS側は自動的に呼ばれなくなる
- GASプロジェクト自体は削除せずに残しておくと安心（過去実行ログの参照用）

## トラブルシュート

| 症状 | 確認項目 |
|---|---|
| Slack で Verified が出ない | `SLACK_SIGNING_SECRET` が正しいか / URLがtypoないか |
| `invalid signature` | 環境変数再設定 → 再デプロイが必要 |
| Sheets 書き込みエラー | サービスアカウントがシートに「編集者」で共有されてるか / Sheets API がEnableか |
| バックフィルで取れない | `SLACK_BOT_TOKEN` が有効か / Botが `#rpt-sales_予実報告` に参加してるか |
