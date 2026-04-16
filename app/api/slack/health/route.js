// デプロイ疎通確認用ヘルスチェック
// GET /api/slack/health → 環境変数の設定状況のみ返す（値は返さない）

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    ok: true,
    env: {
      SLACK_SIGNING_SECRET: !!process.env.SLACK_SIGNING_SECRET,
      SLACK_BOT_TOKEN: !!process.env.SLACK_BOT_TOKEN,
      GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      SPREADSHEET_ID: !!process.env.SPREADSHEET_ID,
      CRON_SECRET: !!process.env.CRON_SECRET,
    },
    time: new Date().toISOString(),
  });
}
