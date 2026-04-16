// Slack から過去スレッドを遡って欠損データをリカバー
// Vercel Cron で毎朝 07:00 JST に呼ぶ (vercel.json 参照)
// 手動実行: curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/slack/backfill

import { backfillRecentThreads } from '@/lib/slack/process';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await backfillRecentThreads(50);
    return Response.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    console.error('backfill error', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
