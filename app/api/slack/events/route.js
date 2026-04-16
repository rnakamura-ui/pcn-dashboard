// Slack Events API エンドポイント
// Slack App > Event Subscriptions の Request URL に設定する:
// https://pcn-dashboard-app.vercel.app/api/slack/events

import { verifySlackSignature } from '@/lib/slack/verify';
import { processSlackEvent } from '@/lib/slack/process';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
    return new Response('invalid signature', { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return new Response('bad json', { status: 400 }); }

  // URL 検証（初回セットアップ時）
  if (payload.type === 'url_verification') {
    return new Response(payload.challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  if (payload.type === 'event_callback') {
    // Slack のタイムアウト(3s)を避けるため、処理は投げっぱなしで200を即返す。
    // エラーは Vercel ログで追跡可能。
    processSlackEvent(payload.event).catch((err) => {
      console.error('processSlackEvent error', err);
    });
  }

  return new Response('ok', { status: 200 });
}
