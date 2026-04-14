# PCN 営業KPI ダッシュボード

パシフィックネット向け営業KPIのリアルタイム可視化ダッシュボード。Google Spreadsheetから直接データ取得し、支店×個人×月の歩留まり指標を表示します。

## 主な機能

- **3つの歩留まり指標**: アポ率 / 着電toアポ率 / 着電率
- **マルチセレクトフィルター**: 月・支店・担当者（複数選択可）
- **前月比トレンド**: 単一月選択時に差分を表示
- **個人ランキング**: アポ率 / 着電toアポ率 の2軸で切替
- **支店別比較チャート**: 全支店の歩留まり指標を横並び比較
- **5分おきの自動再読み込み**

## データソース

- Google Spreadsheet ID: `1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4`
- シート名: `生データ`
- 列構成: A=日付 / B=担当者 / C=支店 / D=架電数 / E=着電数(PR数) / F=アポ数
- 必須共有設定: 「リンクを知っている全員・閲覧者」

## 開発

```bash
npm install
npm run dev -- -p 3002
```

http://localhost:3002 を開く。

## デプロイ（Vercel）

1. GitHubにpush
2. [vercel.com/new](https://vercel.com/new) でリポジトリを選択
3. Next.jsプリセットで自動デプロイ
4. 環境変数は不要（データは公開Sheetsから直接取得）

## 技術スタック

- Next.js 16 (App Router, Turbopack)
- React 19
- Chart.js 4
- Vanilla CSS（Tailwindなし）
- Google Fonts: Inter + JetBrains Mono
