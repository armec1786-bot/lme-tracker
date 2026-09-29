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
