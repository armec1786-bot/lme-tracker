# File: tokyo_steel_monitor.py
import os
import sys
import time
import datetime
import requests
from playwright.sync_api import sync_playwright

from lme_cloud_sync import get_tokyo_steel_tahara

GAS_WEBHOOK_URL = os.environ.get('GAS_WEBHOOK_URL', '')

# ===== 設定（必要に応じて変更） =====
WINDOW_END = "17:10"       # この時刻（日本時間）を過ぎたら確認を終了する
CHECK_INTERVAL_SEC = 300   # 確認の間隔（秒）＝5分

JST = datetime.timezone(datetime.timedelta(hours=9))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def now_jst():
    return datetime.datetime.now(JST)


def window_end_dt():
    h, m = map(int, WINDOW_END.split(':'))
    return now_jst().replace(hour=h, minute=m, second=0, microsecond=0)


def block_heavy_resources(route):
    if route.request.resource_type in ('image', 'font', 'media'):
        route.abort()
    else:
        route.continue_()


def is_valid(data):
    """新断の価格が正しく読み取れているか"""
    if not data or not data.get('details'):
        return False
    price = data['details'].get('新断', {}).get('price', '')
    return price not in ('', 'N/A', None)


def signature(data):
    """改定を見分けるための指紋（更新日・適用日・全品目の価格）"""
    d = data.get('details', {})
    items = tuple((k, d[k].get('price')) for k in sorted(d))
    return (data.get('update_date'), data.get('apply_date'), items)


def fetch_last_spreadsheet_shindan():
    """(読み込めたか, シート最終行の田原_新断) を返す"""
    try:
        resp = requests.get(GAS_WEBHOOK_URL, timeout=30)
        if resp.status_code == 200:
            res_json = resp.json()
            if res_json.get('status') == 'success':
                rows = res_json.get('rows', [])
                value = str(rows[-1].get('田原_新断', '')).strip() if rows else ''
                return True, value
    except Exception as e:
        print('スプレッドシート読み込みエラー:', e)
    return False, None


def send_alert(data):
    payload = {
        'action': 'tokyo_steel_alert',
        'date': now_jst().strftime('%Y-%m-%d'),
        'tokyo_steel': data
    }
    try:
        resp = requests.post(GAS_WEBHOOK_URL, json=payload, timeout=60)
        print('送信結果:', resp.status_code, resp.text)
        return resp.ok
    except Exception as e:
        print('送信エラー:', e)
        return False


def main():
    if not GAS_WEBHOOK_URL:
        print('エラー: GAS_WEBHOOK_URL が設定されていません。')
        sys.exit(1)

    end_at = window_end_dt()
    fetched_once = False
    baseline = None
    print(f'確認を開始します（{WINDOW_END} まで {CHECK_INTERVAL_SEC} 秒おき）')

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA)
        page.route('**/*', block_heavy_resources)

        while True:
            stamp = now_jst().strftime('%H:%M:%S')
            data = get_tokyo_steel_tahara(page)

            if is_valid(data):
                fetched_once = True
                current = data['details']['新断']['price']
                sig = signature(data)
                ok, saved = fetch_last_spreadsheet_shindan()
                print(f"[{stamp}] Web: 新断 {current}（適用日 {data.get('apply_date')}） / シート: {saved}")

                reason = None
                if not ok:
                    print('シートを読み込めなかったため、今回は判定を見送ります。')
                elif saved != current:
                    reason = '新断の価格がシートと異なる'
                elif baseline is not None and sig != baseline:
                    reason = 'PDFの内容（他の品目・適用日）が変わった'

                if reason:
                    print(f'🔥 改定を検知しました（{reason}）。速報を送信します。')
                    if send_alert(data):
                        break
                    print('送信に失敗したため、次回もう一度送信します。')

                if baseline is None:
                    baseline = sig
            else:
                print(f'[{stamp}] 東京製鉄の価格を正しく読み取れませんでした。次回もう一度確認します。')

            if now_jst() + datetime.timedelta(seconds=CHECK_INTERVAL_SEC) > end_at:
                print('確認する時間帯が終わりました。')
                break
            time.sleep(CHECK_INTERVAL_SEC)

        browser.close()

    if not fetched_once:
        print('時間内に一度も東京製鉄の価格を読み取れませんでした。')
        sys.exit(1)


if __name__ == '__main__':
    main()
