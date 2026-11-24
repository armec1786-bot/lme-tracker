[HANDOVER_BUNDLE.md](https://github.com/user-attachments/files/35308816/HANDOVER_BUNDLE.md)
# LME市況・JX建値自動配信システム 引き継ぎ書

最終更新：2026-11-24

このドキュメントは、本プロジェクトの仕様・構成・運用状況を、後任の開発者や別のAIアシスタントがすぐに把握できるようにまとめたものです。

---

## 0. 引き継ぎ方法（最初に読むこと）

- コードを個別に貼り付ける必要はありません。
- リポジトリの `HANDOVER_BUNDLE.md` に、この引き継ぎ書と主要なコード一式（Python、GAS、yml、`requirements.txt`）がまとめて入っています。
- `HANDOVER_BUNDLE.md` は、`main` ブランチが更新されるたびにGitHub Actions（`build_handover_bundle.yml`）が自動で作り直します。
- 引き継ぐときは、GitHubで `HANDOVER_BUNDLE.md` を開き、右上の「Download raw file」でダウンロードして、AIのチャットに添付します。
- GASのコードは、GASエディタとリポジトリの `gas/` フォルダの両方にあります。**GASを修正したら、`gas/` 内のファイルにも同じ内容を反映すること。** 反映しないと、引き継ぎ用のファイルが古いままになります。

---

## 1. プロジェクトの目的と概要

- **目的**：LME非鉄金属相場、為替（ドル円）、国内銅建値（JX金属）、国内鉄スクラップ価格（東京製鉄 田原工場）、貴金属店頭価格（三菱マテリアル）を自動で取得し、Googleスプレッドシートに記録して、関係者にHTMLメールで配信する。
- **稼働環境**：
  - 起動管理：Google Apps Script（GAS）のトリガー
  - 価格の取得：GitHub Actions（Ubuntu、Python、Playwright）
  - 記録とメール送信：Googleスプレッドシート、GAS、Gmail
- 無料枠の範囲で運用している。

---

## 2. システム構成と動作フロー

**重要**：2026-11-24に、起動方式をGitHubの定期実行（`schedule`）からGASによる起動（`workflow_dispatch`）に切り替えた。

1. **毎日 4時台**：GASの `scheduleToday` がその日の起動予約（トリガー）を作る。土日と日本の祝日は、平日限定のものを予約しない。
2. **予約した時刻**：GASの `dispatchByTrigger` が GitHub API を呼び、該当するワークフローを `workflow_dispatch` で起動する。起動後、使い終わった予約は自動で削除する。
3. **GitHub Actions**：Pythonスクリプトが各サイトから価格を取得し、JSONにまとめてGASのWebhook（`doPost`）へPOSTする。
4. **GAS（`doPost`）**：`action` の値に応じて処理を分け、スプレッドシートへの書き込みとメール送信（BCCで一斉送信）を行う。

### 起動スケジュール（`gas/scheduler.gs` の `SCHEDULE`）

| ワークフロー | 時刻（日本時間） | 実行日 | 内容 |
|---|---|---|---|
| `daily_lme.yml` | 6:37 | 毎日（土日祝日も） | 総合市況レポート |
| `daily_jx.yml` | 9:37、10:13 | 平日のみ | JX銅建値の改定確認 |
| `daily_tokyo_steel.yml` | 16:03、16:13 | 平日のみ | 東京製鉄の改定確認 |

- 3つのymlの `schedule:` は、**二重起動を防ぐために意図的に無効化（コメントアウト）している。再び有効にしないこと。**
- GASの時刻指定トリガーは、指定時刻から1〜2分遅れることがある（正常）。

---

## 3. ファイル構成

### GitHubリポジトリ（`armec1786-bot/lme-tracker`、ブランチ `main`）

| ファイル | 役割 |
|---|---|
| `.github/workflows/daily_lme.yml` | `lme_cloud_sync.py` を実行（`workflow_dispatch` のみ） |
| `.github/workflows/daily_jx.yml` | `jx_copper_monitor.py` を実行（`workflow_dispatch` のみ） |
| `.github/workflows/daily_tokyo_steel.yml` | `tokyo_steel_monitor.py` を実行（`workflow_dispatch` のみ） |
| `.github/workflows/build_handover_bundle.yml` | `HANDOVER_BUNDLE.md` を自動生成 |
| `lme_cloud_sync.py` | 総合取得スクリプト。Westmetall（LME Cash）、TradingView（リアルタイム為替）、日本銀行（為替PDF）、JX金属、東京製鉄（PDF）、三菱マテリアルからまとめて取得し、全データをGASへ送る |
| `jx_copper_monitor.py` | JX銅建値の速報監視。建値が更新されたときだけGASへ送る（`action: jx_alert`） |
| `tokyo_steel_monitor.py` | 東京製鉄の速報監視（`action: tokyo_steel_alert` または `ts_alert`） |
| `requirements.txt` | `playwright`、`pypdf`、`requests` など |
| `gas/gas_webhook.gs` | GASのWebhook本体（GASエディタ上のファイル名は `コード.gs`） |
| `gas/scheduler.gs` | GASの起動スケジューラ |
| `PROJECT_HANDOVER.md` | 本書 |
| `HANDOVER_BUNDLE.md` | 自動生成される引き継ぎ用のまとめファイル（手で編集しない） |

### GAS（スプレッドシートに紐づいたプロジェクト）

**`コード.gs`（= `gas/gas_webhook.gs`）**
- `doPost(e)`：JSONを受け取り、`action` で処理を分ける。
  - `jx_alert`：`sendJxAlertEmail` でメールを送った後、`updateSpreadsheetJxPrice` でシートに書き込む。
  - `tokyo_steel_alert` / `ts_alert`：`sendTokyoSteelAlertEmail` でメールを送った後、`updateSpreadsheetTokyoSteelPrice` でシートに書き込む。
  - それ以外：`processAndSend` で総合データをシートに書き込み、メールを送る。
- `doGet(e)`：`LME_Prices` の内容をJSONで返すWeb API。
- `getRecipientsList(targetType)`：`アドレス帳` から宛先リストを取得する（`LME`、`JX`、`TS`）。
- `setPlainTextValue(...)`：値差を数式ではなく文字列として保存する。
- `fixSheetHeaders()`：1行目の見出しを `HEADERS` の内容に直す。

**`scheduler.gs`**
- `setupDailyScheduler()`：毎日4時台に `scheduleToday` を動かすトリガーを作る。何度実行しても予約は重複しない。
- `scheduleToday()`：その日の起動予約を作る。祝日の判定にはGoogleの日本の祝日カレンダーを使う。
- `dispatchByTrigger(e)`：予約時刻にワークフローを起動し、使い終わった自分のトリガーを削除する。
- `dispatchWorkflow(workflow)`：GitHub API（`workflow_dispatch`）を呼ぶ。HTTP 204以外のときは、`DEFAULT_RECIPIENT` に「【警告】自動起動失敗」メールを送る。
- `testDispatchNow()`：動作確認用。`daily_jx.yml` を起動する（JXは更新が無ければメールを送らないので、テストで関係者にメールが届かない）。

---

## 4. 設定値・秘密情報

| 項目 | 保存場所 | 内容・注意 |
|---|---|---|
| `GAS_WEBHOOK_URL` | GitHub → Settings → Secrets and variables → Actions | GASウェブアプリのURL。Pythonから送信するときに使う |
| `GITHUB_TOKEN` | GAS → プロジェクトの設定 → スクリプト プロパティ | Fine-grained personal access token。対象は `lme-tracker` のみ。権限は Actions: Read and write、Metadata: Read-only |
| トークンの有効期限 | なし | （期限日を記入。無期限の場合は「なし」と記入） |
| `GH_OWNER` / `GH_REPO` | `scheduler.gs` | `armec1786-bot` / `lme-tracker` |
| 起動するブランチ | `scheduler.gs` の `ref` | `main` |
| `DEFAULT_RECIPIENT` | `コード.gs` | メールのTo、宛先が0件のときの送り先、警告メールの送り先 |
| トリガーのオーナー | GAS | `setupDailyScheduler` を実行したGoogleアカウントの権限で動く |

- トークンは、コード、メール、チャットに貼り付けないこと。漏れた可能性があるときは、GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens から削除して作り直す。

---

## 5. スプレッドシートの仕様

### シート1：`LME_Prices`（1日1行）

| 列 | 内容 |
|---|---|
| A | 日付 |
| B〜D | 銅（USD、前日比%、円換算） |
| E〜G | アルミ（同上） |
| H〜J | 亜鉛（同上） |
| K〜M | 鉛（同上） |
| N〜P | ニッケル（同上） |
| Q〜S | スズ（同上） |
| T | ドル円中央相場 |
| U〜V | JX銅建値、JX建値値差 |
| W〜X | 田原_新断、田原_新断値差 |
| Y〜Z | 金_店頭価格、金_前日比 |
| AA〜AB | プラチナ_店頭価格、プラチナ_前日比 |
| AC〜AD | 銀_店頭価格、銀_前日比 |
| AE | 更新日時 |

- 値差の列（V、X、Z、AB、AD）は、`setPlainTextValue` で文字列として保存している（「+1,000円/t」が数式と解釈されるのを防ぐため）。

### シート2：`アドレス帳`

| 列 | 内容 |
|---|---|
| A | 名前 |
| B | メールアドレス |
| C | LME毎日配信 |
| D | JX銅建値速報 |
| E | 東京製鉄速報 |

- 配信対象と判定する値：「〇」「○」「O」「yes」「1」
- **注意：LME（C列）は空白でも配信対象になる**（`getRecipientsList` の現在の仕様）。LMEを止めたい人は、C列に上記以外の値（例：「×」）を入れる必要がある。
- 宛先が0件のときは `DEFAULT_RECIPIENT` だけに送る。

---

## 6. 運用手順

| やりたいこと | 手順 |
|---|---|
| 起動時刻を変える | `scheduler.gs` の `SCHEDULE` を書き換えて保存すると、翌日から反映される。当日から反映したいときは、保存後に `scheduleToday` を1回実行する。`gas/scheduler.gs` にも同じ内容を反映する |
| 今日の予約を確認する | GASの時計アイコン（トリガー）を開く。実行済みの予約は自動で消えるので、時間が経つほど件数が減るのは正常 |
| 担当者（GASのオーナー）が変わる | 新しい担当者のアカウントで `setupDailyScheduler` を1回実行する |
| トークンを更新する | GitHubで同じ権限のトークンを作り直し、スクリプト プロパティ `GITHUB_TOKEN` の値を差し替える |
| 手動でレポートを送る | GitHub → Actions → 該当ワークフロー →「Run workflow」 |
| 警告メールが届いた | 本文のHTTP番号で判断する。401：トークンが誤っているか期限切れ。404：リポジトリ名、ファイル名、権限のいずれかの誤り。422：ymlに `workflow_dispatch` が無いか、ブランチ名の誤り |

- `scheduleToday` のトリガーは、エラー通知設定を「今すぐ通知を受け取る」にしておくこと（4時台の予約作成が失敗したときに気付くため）。

---

## 7. 解決済みの課題（再発時の参考）

1. **Westmetall（LME価格）の取得失敗**
   - 問題：表の途中に見出し行が入るようになり、数値への変換でエラーが出た。
   - 解決：`lme_cloud_sync.py` で `try-except ValueError` を使い、数値の行だけを取り出すようにした。
2. **東京製鉄（田原工場）の列ズレ**
   - 問題：W列（田原_新断）に値差が入り、`#ERROR!` になっていた。
   - 解決：`updateSpreadsheetTokyoSteelPrice` の列番号を、23（W列）と24（X列）に修正した。
3. **GitHubの定期実行による大幅なメール遅延（2026-11-24解決）**
   - 問題：`schedule` で起動していたが、混雑による順番待ちで大きく遅れていた。実測値は、LME（予定6:37）が10:31〜11:44、JX（予定9:37／10:13）が16:41〜17:56、東京製鉄（予定16:03／16:13）が翌日3:55／4:12。祝日（11/23）にも起動していた。
   - 解決：GASの時刻指定トリガーから `workflow_dispatch` で起動する方式に切り替え、ymlの `schedule` を無効にした。11/24のJX速報は定刻に1通だけ届いたことを確認済み。

---

## 8. 既知の課題と改善候補

### 優先度：高
1. **確認の間隔が粗い**：JXは9:37と10:13の2回しか確認しない。9:40に発表されると、通知は10:13の確認後になる。→ 発表時間帯に数分おきに確認し、見つけたら終了する方式にする（**次に着手**）。
2. **二重送信の防止が無い**：2回の確認がどちらも「更新あり」と判定すると、同じ速報が2通届く恐れがある。→ 送信済みの記録（日付と改定日）を残し、2回目は送らないようにする（**次に着手**）。
3. **速報の書き込み先が「最終行」になっている**：`updateSpreadsheetJxPrice` と `updateSpreadsheetTokyoSteelPrice` は、最終行の日付が一致したときだけ上書きし、一致しないときは新しい行を追加する。日付で行を探す方式に統一したほうが安全。
4. **列番号を数字で直接指定している**：`getRange(lastRow, 23)` など。列を追加すると、列ズレが再発する恐れがある。→ 見出し名から列を探す方式にする。
5. **取得失敗に気付けない**：取得できなかった値は「N/A」や空欄のまま配信される。→ 管理者への失敗通知、異常な値の検知（例：前日比±15%超えは保留にする）を入れる。

### 優先度：中
6. **Webhookに認証が無い**：URLを知っている人なら誰でもデータを送り込める。→ 共有トークンをGitHub Secretsに置き、GAS側で照合する。
7. **同時受信の競合**：GASの `LockService` で、1件ずつ処理させる。
8. **土日のLMEレポート**：LMEは毎日起動しているので、土日やLMEの休場日には前日と同じ内容が届く可能性がある。配信が必要かどうか、利用者に確認すること。
9. **年末年始の扱い**：Googleの祝日カレンダーでは12/31や1/2〜1/3が祝日扱いにならないため、平日限定の確認も起動する（更新が無ければメールは送られないので実害は小さい）。
10. **処理の速さ**：Playwrightのブラウザを毎回インストールしている。また `networkidle` で待っているため、ページの読み込みに時間がかかる。→ キャッシュを使う、`domcontentloaded` で待つ、画像の読み込みを止める。
11. **送信の制限時間が無い**：`requests.post` に `timeout` を付ける。

### 優先度：低
12. **取得処理の重複**：`lme_cloud_sync.py` と各速報用スクリプトで、同じ取得処理が重なっている可能性がある。共通部分をまとめる。
13. **壊れやすい取得処理**：三菱マテリアルは、表の位置（何番目の表か）で値を探している。東京製鉄はPDFの文字の並びに依存している。サイトの構成が変わると取得できなくなる。
14. **実行ログ用シートの追加**：取得元ごとの成功・失敗、送信件数を記録する。

---

## 9. 次のステップ（2026-11-24時点）

- 上記の8-1と8-2（数分おきの確認と二重送信の防止）を、`jx_copper_monitor.py`、`tokyo_steel_monitor.py`、`scheduler.gs`、`コード.gs` を修正して実装する。
- JXと東京製鉄が例年だいたい何時頃に発表するかを確認し、確認を続ける時間帯を決める。
- リポジトリが非公開（Private）の場合、GitHub Actionsの無料枠は月2,000分。数分おきの確認は実行時間が長くなるため、無料枠に収まるように設計する。

---

## 10. 引き継ぎ先（開発者・AI）へのお願い

- 利用者の環境はWindows。エディタやIDEにはあまり詳しくない。修正は「どのファイルの、どこを、どう差し替えるか」を具体的に示し、可能であればファイル全体を差し替えられる形で示すこと。
- GitHubとGASの操作は、画面のボタン名を使って手順で説明すること。
- ymlの `schedule:` を再び有効にする提案はしないこと（GASからの起動と重なり、メールが二重に届く）。
- トークンやWebhookのURLを、チャットに貼るよう求めないこと。
- 関係者全員にメールが届く操作（`daily_lme.yml` の手動実行など）をテストで行う場合は、事前に利用者の了承を得ること。

---

## 11. 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-11-24 | 起動方式をGASからの `workflow_dispatch` に変更。`scheduler.gs` を追加。引き継ぎ用のまとめファイルの自動生成を追加。既知の課題を整理 |
| （以前） | Westmetallの取得失敗を修正。東京製鉄の列ズレを修正 |
