# File: jx_copper_monitor.py
import os
import sys
import re
import time
import datetime
import requests
from playwright.sync_api import sync_playwright

GAS_WEBHOOK_URL = os.environ.get('GAS_WEBHOOK_URL', '')

# ===== 設定（必要に応じて変更） =====
WINDOW_END = "10:15"       # この時刻（日本時間）を過ぎたら確認を終了する
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


def get_realtime_usdjpy(page):
    try:
        page.goto('https://www.tradingview.com/symbols/USDJPY/', wait_until='domcontentloaded', timeout=30000)
        now_str = now_jst().strftime('%Y-%m-%d %H:%M JST')
        for _ in range(3):
            html = page.content()
            m = re.search(r'"last_price":\s*([0-9\.]+)', html)
            if m:
                return {'rate': float(m.group(1)), 'time': now_str}
            price_elem = page.query_selector('span[class*="last-"]')
            if price_elem:
                m_val = re.search(r'([1-2][0-9]{2}\.[0-9]{2,3})', price_elem.inner_text().strip())
                if m_val:
                    return {'rate': float(m_val.group(1)), 'time': now_str}
            page.wait_for_timeout(3000)
    except Exception as e:
        print('TradingView Error:', e)
    return None


def get_jx_copper(page):
    try:
        url = f'https://www.jx-nmm.com/cuprice/?t={int(time.time())}'
        page.goto(url, wait_until='load', timeout=45000)
        page.wait_for_selector('table', timeout=20000)
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
            if len(tbl.query_selector_all('tr')) > 1:
                target_tbl = tbl
                break

        if not target_tbl and len(current_year_tables) > 0:
            target_tbl = current_year_tables[0]

        if target_tbl:
            target_rows = target_tbl.query_selector_all('tr')
            if len(target_rows) >= 2:
                t_last = target_rows[-1].inner_text().strip().replace('\n', ' ')
                t_prev = target_rows[-2].inner_text().strip().replace('\n', ' ')

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
    """シート最終行のJX銅建値を返す。読み込めなかった場合は None を返す。"""
    try:
        resp = requests.get(GAS_WEBHOOK_URL, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('status') == 'success':
                rows = data.get('rows', [])
                return str(rows[-1].get('JX銅建値', '')).strip() if rows else ''
    except Exception as e:
        print('Spreadsheet Fetch Error:', e)
    return None


def send_alert(jx_copper, realtime_forex):
    payload = {
        'action': 'jx_alert',
        'date': now_jst().strftime('%Y-%m-%d'),
        'jx_copper': jx_copper,
        'realtime_forex': realtime_forex
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
    print(f'確認を開始します（{WINDOW_END} まで {CHECK_INTERVAL_SEC} 秒おき）')

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA)
        page.route('**/*', block_heavy_resources)

        while True:
            stamp = now_jst().strftime('%H:%M:%S')
            jx = get_jx_copper(page)

            if jx:
                fetched_once = True
                saved = fetch_last_spreadsheet_jx_price()
                print(f"[{stamp}] Web: {jx['price']}（{jx['date']}） / シート: {saved}")

                if saved is None:
                    print('シートを読み込めなかったため、今回は判定を見送ります。')
                elif saved != jx['price']:
                    print('⚡ 建値の更新を検知しました。速報を送信します。')
                    forex = get_realtime_usdjpy(page)
                    if send_alert(jx, forex):
                        break
                    print('送信に失敗したため、次回もう一度送信します。')
            else:
                print(f'[{stamp}] JX建値を取得できませんでした。次回もう一度確認します。')

            if now_jst() + datetime.timedelta(seconds=CHECK_INTERVAL_SEC) > end_at:
                print('確認する時間帯が終わりました。')
                break
            time.sleep(CHECK_INTERVAL_SEC)

        browser.close()

    if not fetched_once:
        print('時間内に一度もJX建値を取得できませんでした。')
        sys.exit(1)


if __name__ == '__main__':
    main()
