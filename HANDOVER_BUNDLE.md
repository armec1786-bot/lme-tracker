# HANDOVER BUNDLE（自動生成・編集禁止）

生成日時: 2026-11-24 15:46 JST

このファイルには引き継ぎ書と主要コード一式が含まれています。

## FILE: PROJECT_HANDOVER.md

~~~~
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

~~~~

## FILE: requirements.txt

~~~~
playwright>=1.40.0
requests>=2.31.0
pypdf>=4.0.0

~~~~

## FILE: lme_cloud_sync.py

~~~~
import os
import sys
import datetime
import json
import time
import re
import io
import urllib.request
import pypdf
import requests
from playwright.sync_api import sync_playwright

GAS_WEBHOOK_URL = os.environ.get('GAS_WEBHOOK_URL', '')

def get_realtime_usdjpy(page):
    """
    TradingView (https://www.tradingview.com/symbols/USDJPY/) からリアルタイムドル円為替レートと取得時刻(JST)を取得
    """
    try:
        url = 'https://www.tradingview.com/symbols/USDJPY/'
        page.goto(url, wait_until='networkidle', timeout=60000)
        
        html = page.content()
        now_jst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
        now_str = now_jst.strftime('%Y-%m-%d %H:%M JST')
        
        m = re.search(r'"last_price":\s*([0-9\.]+)', html)
        if m:
            rate = float(m.group(1))
            return {'rate': rate, 'time': now_str}
            
        price_elem = page.query_selector('span[class*="last-"]')
        if price_elem:
            t = price_elem.inner_text().strip()
            m_val = re.search(r'([1-2][0-9]{2}\.[0-9]{2,3})', t)
            if m_val:
                rate = float(m_val.group(1))
                return {'rate': rate, 'time': now_str}
    except Exception as e:
        print('TradingView Realtime USD/JPY Scraping Error:', e)
        
    return None

def get_westmetall_cash_prices_with_change(page):
    fields = {
        'copper': ('銅 (Copper)', 'LME_Cu_cash'),
        'tin': ('スズ (Tin)', 'LME_Sn_cash'),
        'lead': ('鉛 (Lead)', 'LME_Pb_cash'),
        'zinc': ('亜鉛 (Zinc)', 'LME_Zn_cash'),
        'aluminium': ('アルミニウム (Aluminium)', 'LME_Al_cash'),
        'nickel': ('ニッケル (Nickel)', 'LME_Ni_cash'),
    }
    
    results = {}
    date_str = ''
    
    for key, (name, field_name) in fields.items():
        try:
            url = 'https://www.westmetall.com/en/markdaten.php?action=table&field=' + field_name
            page.goto(url, wait_until='networkidle', timeout=60000)
            
            tables = page.query_selector_all('table')
            if tables:
                rows = tables[0].query_selector_all('tr')
                data_rows = []
                for r in rows:
                    tds = r.query_selector_all('td')
                    if len(tds) >= 2:
                        d_txt = tds[0].inner_text().strip()
                        p_txt = tds[1].inner_text().strip().replace(',', '')
                        try:
                            p_val = float(p_txt)
                            data_rows.append((d_txt, p_val))
                        except ValueError:
                            continue
                            
                if len(data_rows) >= 2:
                    if not date_str:
                        date_str = data_rows[0][0]
                        
                    price1 = data_rows[0][1]
                    price2 = data_rows[1][1]
                    
                    change_usd = price1 - price2
                    change_pct = (change_usd / price2) * 100 if price2 != 0 else 0.0
                    
                    results[key] = {
                        'name': name,
                        'price_usd': price1,
                        'change_usd': round(change_usd, 2),
                        'change_pct': round(change_pct, 2)
                    }
        except Exception as e:
            print(f'Westmetall Error ({key}):', e)
            
    return {'date': date_str, 'prices': results}

def get_boj_forex(page):
    try:
        page.goto('https://www.boj.or.jp/statistics/market/forex/fxdaily/index.htm', wait_until='networkidle', timeout=60000)
        pdf_url = None
        pdf_date = None
        
        table = page.query_selector('table')
        if table:
            for r in table.query_selector_all('tr'):
                text = r.inner_text().strip().replace('\n', ' ')
                a_list = r.query_selector_all('a')
                for a in a_list:
                    href = a.get_attribute('href') or ''
                    if '.pdf' in href:
                        m = re.search(r'([0-9]{1,2}月\s*[0-9]{1,2}日)', text)
                        pdf_date = m.group(1).replace(' ', '') if m else ''
                        pdf_url = 'https://www.boj.or.jp' + href if href.startswith('/') else href
                        break
                if pdf_url:
                    break
                    
        if not pdf_url:
            return None
            
        req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            pdf_bytes = resp.read()

        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        lines = [l.strip() for l in reader.pages[0].extract_text().split('\n') if l.strip()]
        
        date_str = ''
        at17_str = ''
        central_str = ''
        central_num = None
        high_val = ''
        low_val = ''
        
        for i, line in enumerate(lines):
            if re.search(r'[0-9]{4}年\s*[0-9]{1,2}月\s*[0-9]{1,2}日', line):
                date_str = line.replace(' ', '')
            elif '17:00時点' in line or 'At 17:00 JST' in line:
                m17 = re.search(r'17:00\s*JST\s*([0-9\.-]+)', line)
                if m17:
                    at17_str = m17.group(1) + '円'
            elif 'レ ン ジ' in line or 'Range' in line:
                if i > 0:
                    m_h = re.search(r'([1-2][0-9]{2}\.[0-9]{2})', lines[i-1])
                    if m_h: high_val = m_h.group(1) + '円'
                if i + 3 < len(lines):
                    m_l = re.search(r'([1-2][0-9]{2}\.[0-9]{2})', lines[i+3])
                    if m_l: low_val = m_l.group(1) + '円'
                if i + 4 < len(lines):
                    m_c = re.search(r'([1-2][0-9]{2}\.[0-9]{2})', lines[i+4])
                    if m_c:
                        central_num = float(m_c.group(1))
                        central_str = f'{central_num:.2f}円'
                    
        return {
            'date': date_str,
            'central_rate': central_str,
            'central_num': central_num,
            'at17': at17_str,
            'range': f'{low_val} ～ {high_val}' if low_val and high_val else 'N/A'
        }
    except Exception as e:
        print('BOJ Error:', e)
    return None

def get_jx_copper(page):
    try:
        page.goto('https://www.jx-nmm.com/cuprice/', wait_until='networkidle', timeout=60000)
        tables = page.query_selector_all('table')
        
        current_year_tables = []
        for tbl in tables:
            rows = tbl.query_selector_all('tr')
            if len(rows) > 0:
                header = rows[0].inner_text().strip().replace('\n', ' ')
                if '改定日' in header and '建値' in header:
                    current_year_tables.append(tbl)
                    
        target_tbl = None
        for tbl in reversed(current_year_tables[:2]):
            rows = tbl.query_selector_all('tr')
            if len(rows) > 1:
                target_tbl = tbl
                break
                
        if not target_tbl and len(current_year_tables) > 0:
            target_tbl = current_year_tables[0]
            
        if target_tbl:
            target_rows = target_tbl.query_selector_all('tr')
            if len(target_rows) >= 2:
                last_row = target_rows[-1]
                prev_row = target_rows[-2]
                
                t_last = last_row.inner_text().strip().replace('\n', ' ')
                t_prev = prev_row.inner_text().strip().replace('\n', ' ')
                
                m_last = re.search(r'([0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日).*?([0-9,]+)\s*円', t_last)
                m_prev = re.search(r'([0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日).*?([0-9,]+)\s*円', t_prev)
                
                if m_last:
                    p_curr = int(m_last.group(2).replace(',', ''))
                    p_prev = int(m_prev.group(2).replace(',', '')) if m_prev else None
                    
                    diff_val = p_curr - p_prev if p_prev else 0
                    diff_pct = (diff_val / p_prev) * 100 if p_prev else 0.0
                    
                    diff_str = f'{diff_val:+,}円/t' if diff_val != 0 else '±0円/t'
                    
                    return {
                        'date': m_last.group(1).replace(' ', ''),
                        'price': f'{p_curr:,}円/t',
                        'prev_date': m_prev.group(1).replace(' ', '') if m_prev else '',
                        'prev_price': f'{p_prev:,}円/t' if p_prev else '',
                        'diff': diff_str,
                        'diff_pct': round(diff_pct, 2)
                    }
    except Exception as e:
        print('JX Error:', e)
    return None

def get_tokyo_steel_tahara(page):
    try:
        pdf_url = None
        update_date = None
        
        page.goto('https://www.tokyosteel.co.jp/scrapprice/', wait_until='networkidle', timeout=60000)
        a_list = page.query_selector_all('a')
        for a in a_list:
            text = a.inner_text().strip().replace('\n', ' ')
            href = a.get_attribute('href') or ''
            if '.pdf' in href and any(c.isdigit() for c in text):
                update_date = text
                pdf_url = 'https://www.tokyosteel.co.jp' + href.replace('../', '/') if href.startswith('../') else href
                break
                
        if not pdf_url:
            return None
            
        req = urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            pdf_bytes = resp.read()

        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        page0_lines = [l.strip() for l in reader.pages[0].extract_text().split('\n') if l.strip()]
        page1_lines = [l.strip() for l in reader.pages[1].extract_text().split('\n') if l.strip()] if len(reader.pages) > 1 else []
        
        apply_date = update_date
        for line in page0_lines:
            if '適用開始日' in line or '午前' in line:
                m = re.search(r'([0-9]{4}年\s*[0-9]{1,2}月\s*[0-9]{1,2}日)', line)
                if m:
                    apply_date = m.group(1).replace(' ', '')
                    break
                    
        def parse_lines(lines, is_change=False):
            res = {}
            for line in lines:
                nums = re.findall(r'([\+-]?[0-9]{1,2},[0-9]{3}|[\+-]?[0-9]{3}|0)', line)
                if not nums:
                    continue
                    
                target_key = None
                if '電' in line and '特' in line and 'Ａ' in line:
                    target_key = '電特A'
                elif '特' in line and 'Ａ' in line and '電' not in line:
                    target_key = '特A'
                elif '特' in line and '級' in line and '電' not in line:
                    target_key = '特級'
                elif '一' in line and '級' in line:
                    target_key = '一級'
                elif '二' in line and '級' in line:
                    target_key = '二級'
                elif '新' in line and '断' in line:
                    target_key = '新断'
                elif 'シュレッダ' in line and 'Ａ' in line:
                    target_key = 'シュレッダーA'
                elif 'シュレッダ' in line and 'Ｃ' in line:
                    target_key = 'シュレッダーC'
                    
                if target_key and target_key not in res:
                    first_num = nums[0]
                    if not is_change:
                        res[target_key] = first_num + '円/t'
                    else:
                        c_val = first_num
                        c_fmt = c_val + '円/t' if c_val.startswith('+') or c_val.startswith('-') else ('+' + c_val + '円/t' if c_val != '0' and c_val != '±0' else '±0円/t')
                        res[target_key] = c_fmt
            return res

        prices = parse_lines(page0_lines, is_change=False)
        changes = parse_lines(page1_lines, is_change=True)
        
        items_order = ['電特A', '特A', '特級', '一級', '二級', '新断', 'シュレッダーA', 'シュレッダーC']
        details = {}
        for item in items_order:
            details[item] = {
                'price': prices.get(item, 'N/A'),
                'change': changes.get(item, '±0円/t')
            }
            
        return {
            'factory': '田原工場',
            'update_date': update_date,
            'apply_date': apply_date,
            'details': details
        }
    except Exception as e:
        print('Tokyo Steel Error:', e)
        return None

def get_mmc_precious_metals(page):
    try:
        page.goto('https://gold.mmc.co.jp/market/', wait_until='networkidle', timeout=60000)
        
        results = {}

        def parse_table_for_retail(tbl):
            rows = tbl.query_selector_all('tr')
            price_val = ''
            change_val = ''
            for r in rows:
                text = r.inner_text().strip().replace('\n', ' ')
                if '店頭価格' in text:
                    tds = r.query_selector_all('td')
                    for td in tds:
                        t_text = td.inner_text().strip()
                        if '円/g' in t_text:
                            if not price_val:
                                price_val = t_text
                            elif not change_val:
                                change_val = t_text
            return price_val, change_val

        tables = page.query_selector_all('table')
        if len(tables) > 4:
            p, c = parse_table_for_retail(tables[4])
            results['gold'] = {'name': '金 (Gold)', 'price': p, 'change': c}
            
        if len(tables) > 8:
            p, c = parse_table_for_retail(tables[8])
            results['platinum'] = {'name': 'プラチナ (Platinum)', 'price': p, 'change': c}
            
        if len(tables) > 10:
            p, c = parse_table_for_retail(tables[10])
            results['silver'] = {'name': '銀 (Silver)', 'price': p, 'change': c}
            
        return results
    except Exception as e:
        print('MMC Error:', e)
        return None

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        realtime_forex = get_realtime_usdjpy(page)
        westmetall_data = get_westmetall_cash_prices_with_change(page)
        boj_forex = get_boj_forex(page)
        jx_copper = get_jx_copper(page)
        tokyo_steel = get_tokyo_steel_tahara(page)
        mmc_metals = get_mmc_precious_metals(page)
        
        browser.close()
        
    use_rate = realtime_forex.get('rate') if realtime_forex else (boj_forex.get('central_num') if boj_forex else None)
    use_time = realtime_forex.get('time') if realtime_forex else ''
    
    if westmetall_data and westmetall_data.get('prices') and use_rate:
        for k, v in westmetall_data['prices'].items():
            price_jpy = round(v['price_usd'] * use_rate)
            v['price_jpy'] = price_jpy
            
        westmetall_data['realtime_rate'] = use_rate
        westmetall_data['realtime_time'] = use_time
            
    now_jst_today = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    today_str = now_jst_today.strftime('%Y-%m-%d')
    
    payload = {
        'date': today_str,
        'lme_cash': westmetall_data,
        'boj_forex': boj_forex,
        'realtime_forex': realtime_forex,
        'jx_copper': jx_copper,
        'tokyo_steel': tokyo_steel,
        'mmc_metals': mmc_metals
    }
    
    if not GAS_WEBHOOK_URL:
        print("GAS_WEBHOOK_URL 未設定")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
        
    try:
        resp = requests.post(GAS_WEBHOOK_URL, json=payload)
        print("送信成功:", resp.text)
    except Exception as e:
        print("送信エラー:", e)

if __name__ == '__main__':
    main()

~~~~

## FILE: jx_copper_monitor.py

~~~~
import os
import sys
import datetime
import json
import re
import requests
from playwright.sync_api import sync_playwright

GAS_WEBHOOK_URL = os.environ.get('GAS_WEBHOOK_URL', '')

def get_realtime_usdjpy(page):
    try:
        url = 'https://www.tradingview.com/symbols/USDJPY/'
        page.goto(url, wait_until='networkidle', timeout=60000)
        html = page.content()
        now_jst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
        now_str = now_jst.strftime('%Y-%m-%d %H:%M JST')
        
        m = re.search(r'"last_price":\s*([0-9\.]+)', html)
        if m:
            return {'rate': float(m.group(1)), 'time': now_str}
            
        price_elem = page.query_selector('span[class*="last-"]')
        if price_elem:
            t = price_elem.inner_text().strip()
            m_val = re.search(r'([1-2][0-9]{2}\.[0-9]{2,3})', t)
            if m_val:
                return {'rate': float(m_val.group(1)), 'time': now_str}
    except Exception as e:
        print('TradingView Error:', e)
    return None

def get_jx_copper(page):
    try:
        page.goto('https://www.jx-nmm.com/cuprice/', wait_until='networkidle', timeout=60000)
        tables = page.query_selector_all('table')
        
        current_year_tables = []
        for tbl in tables:
            rows = tbl.query_selector_all('tr')
            if len(rows) > 0:
                header = rows[0].inner_text().strip().replace('\n', ' ')
                if '改定日' in header and '建値' in header:
                    current_year_tables.append(tbl)
                    
        target_tbl = None
        for tbl in reversed(current_year_tables[:2]):
            rows = tbl.query_selector_all('tr')
            if len(rows) > 1:
                target_tbl = tbl
                break
                
        if not target_tbl and len(current_year_tables) > 0:
            target_tbl = current_year_tables[0]
            
        if target_tbl:
            target_rows = target_tbl.query_selector_all('tr')
            if len(target_rows) >= 2:
                last_row = target_rows[-1]
                prev_row = target_rows[-2]
                
                t_last = last_row.inner_text().strip().replace('\n', ' ')
                t_prev = prev_row.inner_text().strip().replace('\n', ' ')
                
                m_last = re.search(r'([0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日).*?([0-9,]+)\s*円', t_last)
                m_prev = re.search(r'([0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日).*?([0-9,]+)\s*円', t_prev)
                
                if m_last:
                    p_curr = int(m_last.group(2).replace(',', ''))
                    p_prev = int(m_prev.group(2).replace(',', '')) if m_prev else None
                    
                    diff_val = p_curr - p_prev if p_prev else 0
                    diff_pct = (diff_val / p_prev) * 100 if p_prev else 0.0
                    diff_str = f'{diff_val:+,}円/t' if diff_val != 0 else '±0円/t'
                    
                    return {
                        'date': m_last.group(1).replace(' ', ''),
                        'price': f'{p_curr:,}円/t',
                        'raw_price': p_curr,
                        'prev_date': m_prev.group(1).replace(' ', '') if m_prev else '',
                        'prev_price': f'{p_prev:,}円/t' if p_prev else '',
                        'diff': diff_str,
                        'diff_pct': round(diff_pct, 2)
                    }
    except Exception as e:
        print('JX Scraping Error:', e)
    return None

def fetch_last_spreadsheet_jx_price():
    if not GAS_WEBHOOK_URL:
        return None
    try:
        resp = requests.get(GAS_WEBHOOK_URL, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            rows = data.get('rows', [])
            if rows:
                last_row = rows[-1]
                return last_row.get('JX銅建値', '')
    except Exception as e:
        print('Spreadsheet Fetch Error:', e)
    return None

def main():
    if not GAS_WEBHOOK_URL:
        print("エラー: GAS_WEBHOOK_URL が設定されていません。")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        jx_copper = get_jx_copper(page)
        realtime_forex = get_realtime_usdjpy(page)
        browser.close()

    if not jx_copper:
        print("JX建値の取得に失敗しました。")
        return

    current_jx_price_str = jx_copper.get('price', '')
    print(f"現在Web上のJX銅建値: {current_jx_price_str} ({jx_copper.get('date')})")

    last_saved_jx_price = fetch_last_spreadsheet_jx_price()
    print(f"スプレッドシート上の前回JX銅建値: {last_saved_jx_price}")

    if last_saved_jx_price != current_jx_price_str:
        print("⚡ 【建値更新を検知！】GASに速報メール送信をリクエストします...")
        now_jst_today = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
        today_str = now_jst_today.strftime('%Y-%m-%d')
        
        payload = {
            'action': 'jx_alert',
            'date': today_str,
            'jx_copper': jx_copper,
            'realtime_forex': realtime_forex
        }
        
        try:
            resp = requests.post(GAS_WEBHOOK_URL, json=payload, timeout=30)
            print("送信結果:", resp.text)
        except Exception as e:
            print("送信エラー:", e)
    else:
        print("建値に変更はありません。通知をスキップします。")

if __name__ == '__main__':
    main()

~~~~

## FILE: tokyo_steel_monitor.py

~~~~
import os
import sys
import datetime
import json
import requests
from playwright.sync_api import sync_playwright

from lme_cloud_sync import get_tokyo_steel_tahara

GAS_WEBHOOK_URL = os.environ.get('GAS_WEBHOOK_URL', '')

def fetch_last_spreadsheet_ts_data():
    if not GAS_WEBHOOK_URL:
        return None, None
        
    try:
        resp = requests.get(GAS_WEBHOOK_URL, timeout=15)
        if resp.status_code == 200:
            res_json = resp.json()
            if res_json.get('status') == 'success' and res_json.get('rows'):
                last_row = res_json['rows'][-1]
                ts_shindan = last_row.get('田原_新断', '')
                date_str = last_row.get('日付', '')
                return ts_shindan, date_str
    except Exception as e:
        print("スプレッドシートデータ取得エラー:", e)
        
    return None, None

def check_and_notify_tokyo_steel():
    if not GAS_WEBHOOK_URL:
        print("エラー: GAS_WEBHOOK_URL 環境変数が設定されていません。")
        return

    print("東京製鉄（田原工場）の買値情報をチェック中...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        tokyo_steel_data = get_tokyo_steel_tahara(page)
        browser.close()
        
    if not tokyo_steel_data or not tokyo_steel_data.get('details'):
        print("東京製鉄のデータを取り込めませんでした。")
        return

    current_shindan = tokyo_steel_data['details'].get('新断', {}).get('price', '')
    apply_date = tokyo_steel_data.get('apply_date', '')
    
    print(f"Web上の最新・新断価格: {current_shindan} (適用日: {apply_date})")

    last_shindan, last_date = fetch_last_spreadsheet_ts_data()
    print(f"スプレッドシート上の最後の新断価格: {last_shindan} (日付: {last_date})")

    if not last_shindan or last_shindan != current_shindan:
        print(f"🔥 東京製鉄のスクラップ買値更新を検知しました！速報メールを送信します。")
        
        now_jst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
        today_str = now_jst.strftime('%Y-%m-%d')

        payload = {
            "action": "tokyo_steel_alert",
            "date": today_str,
            "tokyo_steel": tokyo_steel_data
        }
        
        try:
            resp = requests.post(GAS_WEBHOOK_URL, json=payload, timeout=20)
            print("速報Webhook送信結果:", resp.text)
        except Exception as e:
            print("Webhook送信エラー:", e)
    else:
        print("東京製鉄の買値に変更はありません。通知をスキップします。")

if __name__ == '__main__':
    check_and_notify_tokyo_steel()

~~~~

## FILE: gas/gas_webhook.gs

~~~~
/**
 * LME非鉄・為替・銅建値・東京製鉄田原工場・三菱マテリアル貴金属 データ受取 兼 メール自動送信 兼 Web API スクリプト
 */

const DEFAULT_RECIPIENT = "armec1786@gmail.com";
const EMAIL_SUBJECT_PREFIX = "【市況・為替・建値】総合市況レポート";
const JX_SUBJECT_PREFIX = "【速報】JX金属 銅建値改定のお知らせ";
const TS_SUBJECT_PREFIX = "【速報】東京製鉄（田原工場）スクラップ購入価格改定のお知らせ";
const WESTMETALL_URL = "https://www.westmetall.com/en/markdaten.php";
const MMC_URL = "https://gold.mmc.co.jp/market/";


/**
 * 値差を数式ではなく文字列として保存する
 */
function setPlainTextValue(sheet, row, column, value) {
  const cell = sheet.getRange(row, column);
  cell.setNumberFormat("@");
  cell.setValue(
    value === null || value === undefined ? "" : String(value)
  );
}




const HEADERS = [
  "日付", 
  "銅_USD", "銅_前日比%", "銅_円換算", 
  "アルミ_USD", "アルミ_前日比%", "アルミ_円換算", 
  "亜鉛_USD", "亜鉛_前日比%", "亜鉛_円換算", 
  "鉛_USD", "鉛_前日比%", "鉛_円換算", 
  "ニッケル_USD", "ニッケル_前日比%", "ニッケル_円換算", 
  "スズ_USD", "スズ_前日比%", "スズ_円換算", 
  "ドル円中央相場",
  "JX銅建値", "JX建値値差",
  "田原_新断", "田原_新断値差",
  "金_店頭価格", "金_前日比",
  "プラチナ_店頭価格", "プラチナ_前日比",
  "銀_店頭価格", "銀_前日比",
  "更新日時"
];

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("LME_Prices");
    
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Sheet not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", headers: HEADERS, rows: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const headers = data[0];
    const rows = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowObj = {};
      for (let j = 0; j < headers.length; j++) {
        let val = row[j];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, "JST", "yyyy-MM-dd HH:mm:ss");
        }
        rowObj[headers[j]] = val;
      }
      rows.push(rowObj);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      headers: headers,
      rows: rows
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getRecipientsList(targetType) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("アドレス帳");
  
  if (!sheet) {
    return [DEFAULT_RECIPIENT];
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    return [DEFAULT_RECIPIENT];
  }
  
  const values = sheet.getRange(1, 1, lastRow, 5).getValues();
  const emails = [];
  
  let colIndex = 2;
  if (targetType === "JX") colIndex = 3;
  else if (targetType === "TS" || targetType === "TOKYO_STEEL") colIndex = 4;
  
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const email = String(row[1]).trim();
    const flag = (row.length > colIndex) ? String(row[colIndex]).trim() : "";
    
    if (email.includes("メールアドレス") || email.includes("アドレス")) continue;
    
    if (email && email.includes("@")) {
      const isAllowed = flag === "〇" || flag === "○" || flag.toUpperCase() === "O" || flag.toLowerCase() === "yes" || flag === "1" || (targetType === "LME" && flag === "");
      if (isAllowed) {
        emails.push(email);
      }
    }
  }
  
  return emails.length > 0 ? emails : [DEFAULT_RECIPIENT];
}

function fixSheetHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("LME_Prices");
  if (!sheet) {
    sheet = ss.insertSheet("LME_Prices");
  }
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold").setBackground("#e0e0e0");
  SpreadsheetApp.getActiveSpreadsheet().toast("スプレッドシートの1行目を正しい項目名に更新しました！");
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    
    if (action === "jx_alert") {
      sendJxAlertEmail(payload.date, payload.jx_copper, payload.realtime_forex);
      updateSpreadsheetJxPrice(payload.date, payload.jx_copper, payload.realtime_forex);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "JX alert sent and updated" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "tokyo_steel_alert" || action === "ts_alert") {
      sendTokyoSteelAlertEmail(payload.date, payload.tokyo_steel);
      updateSpreadsheetTokyoSteelPrice(payload.date, payload.tokyo_steel);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Tokyo Steel alert sent and updated" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const dateStr = payload.date;
    const lmeCash = payload.lme_cash;
    const bojForex = payload.boj_forex;
    const realtimeForex = payload.realtime_forex;
    const jxCopper = payload.jx_copper;
    const tokyoSteel = payload.tokyo_steel;
    const mmcMetals = payload.mmc_metals;
    
    processAndSend(dateStr, lmeCash, bojForex, realtimeForex, jxCopper, tokyoSteel, mmcMetals);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function processAndSend(dateStr, lmeCash, bojForex, realtimeForex, jxCopper, tokyoSteel, mmcMetals) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("LME_Prices");

  if (!sheet) {
    sheet = ss.insertSheet("LME_Prices");
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setValues([HEADERS])
      .setFontWeight("bold")
      .setBackground("#e0e0e0");
  }

  const nowStr = Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd HH:mm:ss");
  const prices = (lmeCash && lmeCash.prices) ? lmeCash.prices : {};

  const centralRate = (realtimeForex && realtimeForex.rate)
    ? `${realtimeForex.rate}円`
    : ((bojForex && bojForex.central_rate) ? bojForex.central_rate : "");

  const jxPrice = jxCopper ? jxCopper.price : "";
  const jxDiff = jxCopper ? jxCopper.diff : "";

  const tsShindan = (tokyoSteel && tokyoSteel.details && tokyoSteel.details["新断"])
    ? tokyoSteel.details["新断"].price : "";

  const tsShindanDiff = (tokyoSteel && tokyoSteel.details && tokyoSteel.details["新断"])
    ? tokyoSteel.details["新断"].change : "";

  const mmcGold = mmcMetals && mmcMetals.gold ? mmcMetals.gold.price : "";
  const mmcGoldChange = mmcMetals && mmcMetals.gold ? mmcMetals.gold.change : "";

  const mmcPlat = mmcMetals && mmcMetals.platinum ? mmcMetals.platinum.price : "";
  const mmcPlatChange = mmcMetals && mmcMetals.platinum ? mmcMetals.platinum.change : "";

  const mmcSilver = mmcMetals && mmcMetals.silver ? mmcMetals.silver.price : "";
  const mmcSilverChange = mmcMetals && mmcMetals.silver ? mmcMetals.silver.change : "";

  // 値差列は一旦空欄にして、後から文字列として個別に書き込む
  const newRow = [
    dateStr,

    prices.copper ? prices.copper.price_usd : "",
    prices.copper ? prices.copper.change_pct : "",
    prices.copper ? prices.copper.price_jpy : "",

    prices.aluminium ? prices.aluminium.price_usd : "",
    prices.aluminium ? prices.aluminium.change_pct : "",
    prices.aluminium ? prices.aluminium.price_jpy : "",

    prices.zinc ? prices.zinc.price_usd : "",
    prices.zinc ? prices.zinc.change_pct : "",
    prices.zinc ? prices.zinc.price_jpy : "",

    prices.lead ? prices.lead.price_usd : "",
    prices.lead ? prices.lead.change_pct : "",
    prices.lead ? prices.lead.price_jpy : "",

    prices.nickel ? prices.nickel.price_usd : "",
    prices.nickel ? prices.nickel.change_pct : "",
    prices.nickel ? prices.nickel.price_jpy : "",

    prices.tin ? prices.tin.price_usd : "",
    prices.tin ? prices.tin.change_pct : "",
    prices.tin ? prices.tin.price_jpy : "",

    centralRate,
    jxPrice, "",
    tsShindan, "",
    mmcGold, "",
    mmcPlat, "",
    mmcSilver, "",
    nowStr
  ];

  const lastRow = sheet.getLastRow();
  let targetRowIndex = -1;

  if (lastRow > 1) {
    const lastRowDate = sheet.getRange(lastRow, 1).getValue();
    let formattedLastDate = lastRowDate;

    if (lastRowDate instanceof Date) {
      formattedLastDate = Utilities.formatDate(lastRowDate, "JST", "yyyy-MM-dd");
    }

    if (String(formattedLastDate).includes(dateStr)) {
      targetRowIndex = lastRow;
    }
  }

  let writeRow;

  if (targetRowIndex > 1) {
    writeRow = targetRowIndex;
    sheet.getRange(writeRow, 1, 1, newRow.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
    writeRow = sheet.getLastRow();
  }

  // 値差を文字列として保存
  setPlainTextValue(sheet, writeRow, 22, jxDiff);        // V列
  setPlainTextValue(sheet, writeRow, 24, tsShindanDiff); // X列
  setPlainTextValue(sheet, writeRow, 26, mmcGoldChange); // Z列
  setPlainTextValue(sheet, writeRow, 28, mmcPlatChange); // AB列
  setPlainTextValue(sheet, writeRow, 30, mmcSilverChange); // AD列

  sendHtmlEmail(dateStr, lmeCash, bojForex, realtimeForex, jxCopper, tokyoSteel, mmcMetals);
}

function updateSpreadsheetJxPrice(dateStr, jxCopper, realtimeForex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("LME_Prices");
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  const nowStr = Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd HH:mm:ss");

  const jxPrice = jxCopper ? jxCopper.price : "";
  const jxDiff = jxCopper ? jxCopper.diff : "";
  const centralRate = (realtimeForex && realtimeForex.rate)
    ? `${realtimeForex.rate}円` : "";

  if (lastRow > 1) {
    const lastRowDate = sheet.getRange(lastRow, 1).getValue();
    let formattedLastDate = lastRowDate;

    if (lastRowDate instanceof Date) {
      formattedLastDate = Utilities.formatDate(lastRowDate, "JST", "yyyy-MM-dd");
    }

    if (String(formattedLastDate).includes(dateStr)) {
      sheet.getRange(lastRow, 21).setValue(jxPrice);
      setPlainTextValue(sheet, lastRow, 22, jxDiff);
      sheet.getRange(lastRow, 31).setValue(nowStr);
      return;
    }
  }

  const newRow = new Array(HEADERS.length).fill("");
  newRow[0] = dateStr;
  newRow[19] = centralRate;
  newRow[20] = jxPrice;
  newRow[30] = nowStr;

  sheet.appendRow(newRow);
  setPlainTextValue(sheet, sheet.getLastRow(), 22, jxDiff);
}


function updateSpreadsheetTokyoSteelPrice(dateStr, tokyoSteel) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("LME_Prices");
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  const nowStr = Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd HH:mm:ss");

  const tsShindan = (tokyoSteel && tokyoSteel.details && tokyoSteel.details["新断"])
    ? tokyoSteel.details["新断"].price : "";

  const tsShindanDiff = (tokyoSteel && tokyoSteel.details && tokyoSteel.details["新断"])
    ? tokyoSteel.details["新断"].change : "";

  if (lastRow > 1) {
    const lastRowDate = sheet.getRange(lastRow, 1).getValue();
    let formattedLastDate = lastRowDate;

    if (lastRowDate instanceof Date) {
      formattedLastDate = Utilities.formatDate(lastRowDate, "JST", "yyyy-MM-dd");
    }

    if (String(formattedLastDate).includes(dateStr)) {
      sheet.getRange(lastRow, 23).setValue(tsShindan);
      setPlainTextValue(sheet, lastRow, 24, tsShindanDiff);
      sheet.getRange(lastRow, 31).setValue(nowStr);
      return;
    }
  }

  const newRow = new Array(HEADERS.length).fill("");
  newRow[0] = dateStr;
  newRow[22] = tsShindan;
  newRow[30] = nowStr;

  sheet.appendRow(newRow);
  setPlainTextValue(sheet, sheet.getLastRow(), 24, tsShindanDiff);
}


function sendHtmlEmail(dateStr, lmeCash, bojForex, realtimeForex, jxCopper, tokyoSteel, mmcMetals) {
  const recipientsList = getRecipientsList("LME");
  const toRecipient = DEFAULT_RECIPIENT;
  const bccRecipients = recipientsList.join(",");

  const metals = [
    { id: 'copper', name: '銅 (Copper)' },
    { id: 'aluminium', name: 'アルミニウム (Aluminium)' },
    { id: 'zinc', name: '亜鉛 (Zinc)' },
    { id: 'lead', name: '鉛 (Lead)' },
    { id: 'nickel', name: 'ニッケル (Nickel)' },
    { id: 'tin', name: 'スズ (Tin)' }
  ];
  
  let lmeTableRows = "";
  const prices = (lmeCash && lmeCash.prices) ? lmeCash.prices : {};
  
  metals.forEach(metal => {
    const item = prices[metal.id];
    const usdStr = (item && item.price_usd !== undefined && item.price_usd !== null) 
      ? "$" + item.price_usd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " /t"
      : "N/A";
      
    let changeStr = "N/A";
    let changeColor = "#333333";
    if (item && item.change_pct !== undefined && item.change_pct !== null) {
      if (item.change_pct > 0) {
        changeStr = "+" + item.change_pct.toFixed(2) + "% ▲";
        changeColor = "#d9534f";
      } else if (item.change_pct < 0) {
        changeStr = item.change_pct.toFixed(2) + "% ▼";
        changeColor = "#0275d8";
      } else {
        changeStr = "0.00%";
      }
    }
    
    const jpyStr = (item && item.price_jpy !== undefined && item.price_jpy !== null)
      ? item.price_jpy.toLocaleString('ja-JP') + " 円/t"
      : "N/A";
      
    lmeTableRows += `
      <tr>
        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">${metal.name}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 15px;">${usdStr}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 15px; font-weight: bold; color: ${changeColor};">${changeStr}</td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 15px; font-weight: bold; color: #1a365d;">${jpyStr}</td>
      </tr>
    `;
  });

  const lmeDateStr = (lmeCash && lmeCash.date) ? lmeCash.date : dateStr;

  let rateValStr = "";
  let rateTimeStr = "";

  if (realtimeForex && realtimeForex.rate) {
    rateValStr = `${realtimeForex.rate}円`;
    rateTimeStr = realtimeForex.time || "";
  } else if (lmeCash && lmeCash.realtime_rate) {
    rateValStr = `${lmeCash.realtime_rate}円`;
    rateTimeStr = lmeCash.realtime_time || "";
  } else if (bojForex && bojForex.central_rate) {
    rateValStr = bojForex.central_rate;
  } else {
    rateValStr = "N/A";
  }

  const rateNote = rateTimeStr 
    ? `※円換算価格は、リアルタイム為替レート（<strong>${rateValStr}</strong> / 取得時間: <strong>${rateTimeStr}</strong>）を使用して算出しています。`
    : `※円換算価格は、ドル円相場（<strong>${rateValStr}</strong>）を使用して算出しています。`;

  let bojHtml = "";
  if (bojForex) {
    bojHtml = `
      <div style="margin-top: 25px; padding: 15px; background-color: #f4f6f9; border-left: 4px solid #0056b3; border-radius: 4px;">
        <h3 style="margin: 0 0 10px 0; color: #0056b3; font-size: 16px;">日本銀行 外国為替市況 (USD/JPY)</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px; font-weight: bold; width: 35%;">中心相場:</td>
            <td style="padding: 6px; font-size: 16px; font-weight: bold; color: #0056b3;">${bojForex.central_rate || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 6px; font-weight: bold;">本日レンジ (安値～高値):</td>
            <td style="padding: 6px; font-size: 15px; color: #2b6cb0;">${bojForex.range || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 6px; color: #555;">17:00時点スポット:</td>
            <td style="padding: 6px; color: #555;">${bojForex.at17 || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 6px; color: #666; font-size: 13px;">公表日:</td>
            <td style="padding: 6px; color: #666; font-size: 13px;">${bojForex.date || 'N/A'}</td>
          </tr>
        </table>
      </div>
    `;
  }

  let jxHtml = "";
  if (jxCopper) {
    let diffColor = "#333333";
    if (jxCopper.diff && jxCopper.diff.startsWith("+")) diffColor = "#d9534f";
    else if (jxCopper.diff && jxCopper.diff.startsWith("-")) diffColor = "#0275d8";

    const diffPctStr = jxCopper.diff_pct ? ` (${jxCopper.diff_pct > 0 ? '+' : ''}${jxCopper.diff_pct}%)` : '';

    jxHtml = `
      <div style="margin-top: 25px; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #cc0000; border-radius: 4px;">
        <h3 style="margin: 0 0 10px 0; color: #cc0000; font-size: 16px;">国内 銅建値（JX金属）</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px; font-weight: bold; width: 35%;">最新建値:</td>
            <td style="padding: 6px; font-size: 18px; font-weight: bold; color: #cc0000;">${jxCopper.price || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 6px; font-weight: bold;">前回比 (値差・価格比):</td>
            <td style="padding: 6px; font-size: 16px; font-weight: bold; color: ${diffColor};">${jxCopper.diff || '±0円/t'}${diffPctStr}</td>
          </tr>
          <tr>
            <td style="padding: 6px; color: #666; font-size: 13px;">改定日:</td>
            <td style="padding: 6px; color: #666; font-size: 13px;">${jxCopper.date || 'N/A'} (前回: ${jxCopper.prev_date || 'N/A'} ${jxCopper.prev_price || ''})</td>
          </tr>
        </table>
      </div>
    `;
  }

  let tsHtml = "";
  if (tokyoSteel && tokyoSteel.details) {
    let tsRowsHtml = "";
    Object.keys(tokyoSteel.details).forEach(item_name => {
      const item = tokyoSteel.details[item_name];
      let cColor = "#333333";
      if (item.change && item.change.startsWith("+")) cColor = "#d9534f";
      else if (item.change && item.change.startsWith("-")) cColor = "#0275d8";

      tsRowsHtml += `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${item_name}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-size: 15px; font-weight: bold;">${item.price}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-size: 15px; font-weight: bold; color: ${cColor};">${item.change}</td>
        </tr>
      `;
    });

    tsHtml = `
      <div style="margin-top: 25px; padding: 15px; background-color: #f7f9f8; border-left: 4px solid #2e7d32; border-radius: 4px;">
        <h3 style="margin: 0 0 5px 0; color: #2e7d32; font-size: 16px;">東京製鉄 国内スクラップ購入価格（田原工場）</h3>
        <p style="margin: 0 0 12px 0; color: #555; font-size: 13px;">改定適用日: <strong>${tokyoSteel.apply_date || tokyoSteel.update_date || 'N/A'}</strong></p>
        
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background-color: #2e7d32; color: #ffffff; font-size: 13px;">
              <th style="padding: 8px; text-align: left;">取得品目</th>
              <th style="padding: 8px; text-align: right;">購入価格 (税込)</th>
              <th style="padding: 8px; text-align: right;">対前回改定幅 (値差)</th>
            </tr>
          </thead>
          <tbody>
            ${tsRowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  let mmcHtml = "";
  if (mmcMetals) {
    let mmcRowsHtml = "";
    ['gold', 'platinum', 'silver'].forEach(key => {
      const item = mmcMetals[key];
      if (item) {
        let cColor = "#333333";
        if (item.change && item.change.startsWith("+")) cColor = "#d9534f";
        else if (item.change && item.change.startsWith("-")) cColor = "#0275d8";

        mmcRowsHtml += `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${item.name}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-size: 15px; font-weight: bold; color: #b7791f;">${item.price}</td>
            <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-size: 15px; font-weight: bold; color: ${cColor};">${item.change}</td>
          </tr>
        `;
      }
    });

    mmcHtml = `
      <div style="margin-top: 25px; padding: 15px; background-color: #fffdf5; border-left: 4px solid #d69e2e; border-radius: 4px;">
        <h3 style="margin: 0 0 10px 0; color: #b7791f; font-size: 16px;">三菱マテリアル 貴金属店頭相場（店頭小売価格）</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background-color: #d69e2e; color: #ffffff; font-size: 13px;">
              <th style="padding: 8px; text-align: left;">品目</th>
              <th style="padding: 8px; text-align: right;">店頭小売価格 (消費税込)</th>
              <th style="padding: 8px; text-align: right;">前営業日比</th>
            </tr>
          </thead>
          <tbody>
            ${mmcRowsHtml}
          </tbody>
        </table>
        <div style="margin-top: 10px; font-size: 12px; color: #555;">
          参考URL: <a href="${MMC_URL}" target="_blank" style="color: #b7791f;">${MMC_URL}</a>
        </div>
      </div>
    `;
  }

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #ffffff;">
      <h2 style="color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 8px; margin-top: 0;">LME 非鉄金属 現物価格 (Cash Settlement)</h2>
      <p style="color: #555; font-size: 13px; margin-bottom: 5px;">公表日付: <strong>${lmeDateStr}</strong></p>
      <p style="color: #555; font-size: 13px; margin-bottom: 15px;">${rateNote}</p>
      
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #1a365d; color: #ffffff;">
            <th style="padding: 10px; text-align: left;">品目</th>
            <th style="padding: 10px; text-align: right;">現物価格 (USD/t)</th>
            <th style="padding: 10px; text-align: right;">前日比 (%)</th>
            <th style="padding: 10px; text-align: right;">円換算価格 (JPY/t)</th>
          </tr>
        </thead>
        <tbody>
          ${lmeTableRows}
        </tbody>
      </table>

      <div style="margin-top: 10px; font-size: 12px; color: #555;">
        参考URL: <a href="${WESTMETALL_URL}" target="_blank" style="color: #0056b3;">${WESTMETALL_URL}</a>
      </div>

      ${bojHtml}
      ${jxHtml}
      ${tsHtml}
      ${mmcHtml}

      <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #eee; text-align: center; font-size: 12px; color: #888;">
        自動配信システム - Westmetall / 日本銀行 / JX金属 / 東京製鉄 / 三菱マテリアル 公表データより自動生成
      </div>
    </div>
  `;
  
  GmailApp.sendEmail(toRecipient, `${EMAIL_SUBJECT_PREFIX} (${dateStr})`, "", {
    bcc: bccRecipients,
    htmlBody: htmlBody
  });
}

function sendJxAlertEmail(dateStr, jxCopper, realtimeForex) {
  const recipientsList = getRecipientsList("JX");
  const toRecipient = DEFAULT_RECIPIENT;
  const bccRecipients = recipientsList.join(",");

  if (!jxCopper) return;

  let diffColor = "#cc0000";
  let diffBg = "#fff5f5";
  let badgeText = "改定";

  if (jxCopper.diff && jxCopper.diff.startsWith("-")) {
    diffColor = "#0275d8";
    diffBg = "#f0f8ff";
    badgeText = "値下げ改定";
  } else if (jxCopper.diff && jxCopper.diff.startsWith("+")) {
    diffColor = "#d9534f";
    diffBg = "#fff5f5";
    badgeText = "値上げ改定";
  }

  const diffPctStr = jxCopper.diff_pct ? ` (${jxCopper.diff_pct > 0 ? '+' : ''}${jxCopper.diff_pct}%)` : '';
  const rateValStr = (realtimeForex && realtimeForex.rate) ? `${realtimeForex.rate}円` : "N/A";
  const rateTimeStr = (realtimeForex && realtimeForex.time) ? realtimeForex.time : "";

  const htmlBody = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 20px; background-color: #f4f6f9;">
      <div style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e1e8ed;">
        
        <div style="background-color: #cc0000; padding: 18px 25px; color: #ffffff;">
          <table style="width: 100%;">
            <tr>
              <td><h2 style="margin: 0; font-size: 20px; font-weight: bold; color: #ffffff;">【速報】JX金属 銅建値改定</h2></td>
              <td style="text-align: right;"><span style="background-color: #ffffff; color: #cc0000; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: bold;">${badgeText}</span></td>
            </tr>
          </table>
        </div>

        <div style="padding: 25px;">
          <div style="margin-bottom: 20px; font-size: 14px; color: #555;">
            改定適用日: <strong style="color: #1a202c; font-size: 16px;">${jxCopper.date || dateStr}</strong>
          </div>

          <div style="background-color: ${diffBg}; border-left: 6px solid ${diffColor}; padding: 20px; border-radius: 6px; margin-bottom: 25px;">
            <div style="font-size: 13px; text-transform: uppercase; color: #718096; font-weight: bold; margin-bottom: 5px;">新・銅建値</div>
            <div style="font-size: 32px; font-weight: bold; color: ${diffColor}; margin-bottom: 10px; letter-spacing: -0.5px;">
              ${jxCopper.price || 'N/A'}
            </div>
            
            <div style="border-top: 1px solid rgba(0,0,0,0.08); padding-top: 10px; font-size: 16px; font-weight: bold; color: ${diffColor};">
              前回比 (値差): <span style="font-size: 20px;">${jxCopper.diff || '±0円/t'}</span> ${diffPctStr}
            </div>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
            <tr style="border-bottom: 1px solid #edf2f7;">
              <td style="padding: 10px 0; color: #718096; width: 35%;">前回建値:</td>
              <td style="padding: 10px 0; font-weight: bold; color: #2d3748;">${jxCopper.prev_price || 'N/A'} (${jxCopper.prev_date || '前回'}改定)</td>
            </tr>
            <tr style="border-bottom: 1px solid #edf2f7;">
              <td style="padding: 10px 0; color: #718096;">参考 ドル円為替:</td>
              <td style="padding: 10px 0; font-weight: bold; color: #2d3748;">${rateValStr} <span style="font-size: 12px; color: #a0aec0; font-weight: normal;">(${rateTimeStr})</span></td>
            </tr>
          </table>

          <p style="margin: 0; font-size: 12px; color: #a0aec0; line-height: 1.5;">
            ※本メールは JX金属公式発表に基づいて自動配信されています。<br>
            ※配信設定の変更（停止・追加）は管理担当者までご連絡ください。
          </p>
        </div>

        <div style="background-color: #f7fafc; padding: 12px 25px; text-align: center; font-size: 12px; color: #718096; border-top: 1px solid #edf2f7;">
          JX金属 銅建値速報システム
        </div>
      </div>
    </div>
  `;

  GmailApp.sendEmail(toRecipient, `${JX_SUBJECT_PREFIX} (${jxCopper.date || dateStr})`, "", {
    bcc: bccRecipients,
    htmlBody: htmlBody
  });
}

function sendTokyoSteelAlertEmail(dateStr, tokyoSteel) {
  const recipientsList = getRecipientsList("TS");
  const toRecipient = DEFAULT_RECIPIENT;
  const bccRecipients = recipientsList.join(",");

  if (!tokyoSteel || !tokyoSteel.details) return;

  let tsRowsHtml = "";
  Object.keys(tokyoSteel.details).forEach(item_name => {
    const item = tokyoSteel.details[item_name];
    let cColor = "#2d3748";
    if (item.change && item.change.startsWith("+")) cColor = "#d9534f";
    else if (item.change && item.change.startsWith("-")) cColor = "#0275d8";

    tsRowsHtml += `
      <tr style="border-bottom: 1px solid #edf2f7;">
        <td style="padding: 10px; font-weight: bold; color: #2d3748;">${item_name}</td>
        <td style="padding: 10px; text-align: right; font-size: 16px; font-weight: bold; color: #2e7d32;">${item.price}</td>
        <td style="padding: 10px; text-align: right; font-size: 15px; font-weight: bold; color: ${cColor};">${item.change}</td>
      </tr>
    `;
  });

  const applyDateStr = tokyoSteel.apply_date || tokyoSteel.update_date || dateStr;

  const htmlBody = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 20px; background-color: #f4f6f9;">
      <div style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e1e8ed;">
        
        <div style="background-color: #2e7d32; padding: 18px 25px; color: #ffffff;">
          <table style="width: 100%;">
            <tr>
              <td><h2 style="margin: 0; font-size: 19px; font-weight: bold; color: #ffffff;">【速報】東京製鉄 スクラップ買値改定</h2></td>
              <td style="text-align: right;"><span style="background-color: #ffffff; color: #2e7d32; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: bold;">田原工場</span></td>
            </tr>
          </table>
        </div>

        <div style="padding: 25px;">
          <div style="margin-bottom: 20px; padding: 12px 15px; background-color: #f0fdf4; border-left: 4px solid #2e7d32; font-size: 15px; color: #166534; font-weight: bold;">
            改定適用開始日: ${applyDateStr}
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
            <thead>
              <tr style="background-color: #2e7d32; color: #ffffff; font-size: 13px;">
                <th style="padding: 10px; text-align: left;">取得品目</th>
                <th style="padding: 10px; text-align: right;">新購入価格 (税込)</th>
                <th style="padding: 10px; text-align: right;">改定幅 (値差)</th>
              </tr>
            </thead>
            <tbody>
              ${tsRowsHtml}
            </tbody>
          </table>

          <p style="margin: 0; font-size: 12px; color: #a0aec0; line-height: 1.5;">
            ※本メールは 東京製鉄（田原工場）公式発表に基づいて自動配信されています。<br>
            ※配信設定の変更は管理担当者までご連絡ください。
          </p>
        </div>

        <div style="background-color: #f7fafc; padding: 12px 25px; text-align: center; font-size: 12px; color: #718096; border-top: 1px solid #edf2f7;">
          東京製鉄 スクラップ価格速報システム
        </div>
      </div>
    </div>
  `;

  GmailApp.sendEmail(toRecipient, `${TS_SUBJECT_PREFIX} (${applyDateStr})`, "", {
    bcc: bccRecipients,
    htmlBody: htmlBody
  });
}

~~~~

## FILE: gas/scheduler.gs（リポジトリに存在しません）

## FILE: .github/workflows/daily_lme.yml

~~~~
name: Daily LME Price Scraper

on:
  # schedule:
  #   - cron: '37 21 * * *'
  workflow_dispatch:

jobs:
  scrape-and-sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install playwright requests pypdf
          python -m playwright install chromium

      - name: Run LME Scraper & Sync
        env:
          GAS_WEBHOOK_URL: ${{ secrets.GAS_WEBHOOK_URL }}
        run: |
          python lme_cloud_sync.py

~~~~

## FILE: .github/workflows/daily_jx.yml

~~~~
name: JX Copper Realtime Alert Monitor

on:
  # schedule:
  #   - cron: '37 0 * * 1-5'
  #   - cron: '13 1 * * 1-5'
  workflow_dispatch:

jobs:
  check-jx-copper:
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.10'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install playwright requests pypdf
          playwright install --with-deps chromium

      - name: Run JX Copper Monitor Script
        env:
          GAS_WEBHOOK_URL: ${{ secrets.GAS_WEBHOOK_URL }}
        run: |
          python jx_copper_monitor.py

~~~~

## FILE: .github/workflows/daily_tokyo_steel.yml

~~~~
name: Tokyo Steel Scrap Price Alert Monitor

on:
  # schedule:
  #   - cron: '3 7 * * 1-5'
  #   - cron: '13 7 * * 1-5'
  workflow_dispatch:
  
jobs:
  check-tokyo-steel:
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.10'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install playwright requests pypdf
          playwright install --with-deps chromium

      - name: Run Tokyo Steel Monitor Script
        env:
          GAS_WEBHOOK_URL: ${{ secrets.GAS_WEBHOOK_URL }}
        run: |
          python tokyo_steel_monitor.py

~~~~
