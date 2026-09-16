import os
import sys
import datetime
import json
import requests
from playwright.sync_api import sync_playwright

GAS_WEBHOOK_URL = os.environ.get('GAS_WEBHOOK_URL', '')

METALS = {
    'copper': {'name': '銅 (Copper)', 'url_slug': 'lme-copper'},
    'aluminium': {'name': 'アルミニウム (Aluminium)', 'url_slug': 'lme-aluminium'},
    'zinc': {'name': '亜鉛 (Zinc)', 'url_slug': 'lme-zinc'},
    'lead': {'name': '鉛 (Lead)', 'url_slug': 'lme-lead'},
    'nickel': {'name': 'ニッケル (Nickel)', 'url_slug': 'lme-nickel'},
    'tin': {'name': 'スズ (Tin)', 'url_slug': 'lme-tin'}
}

def fetch_lme_official_prices():
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        for key, info in METALS.items():
            url = f"https://www.lme.com/Metals/Non-ferrous/{info['url_slug']}"
            try:
                page.goto(url, wait_until='networkidle', timeout=60000)
                page.wait_for_timeout(2000)
                
                body_text = page.inner_text('body')
                lines = [l.strip() for l in body_text.split('\n') if l.strip()]
                
                price = None
                change_pct = None
                
                for i, line in enumerate(lines):
                    if '3-month closing price' in line.lower():
                        if i >= 2:
                            raw_price = lines[i-2].replace(',', '').replace('$', '').strip()
                            raw_change = lines[i-1].replace('%', '').strip()
                            try:
                                price = float(raw_price)
                                change_pct = float(raw_change)
                            except ValueError:
                                pass
                        break
                
                results[key] = {
                    'name': info['name'],
                    'price': price,
                    'change_pct': change_pct
                }
            except Exception as e:
                results[key] = {'name': info['name'], 'price': None, 'change_pct': None}
                
        browser.close()
    return results

def send_to_gas(data):
    today_str = datetime.date.today().strftime('%Y-%m-%d')
    payload = {'date': today_str, 'data': data}
    if not GAS_WEBHOOK_URL:
        print("GAS_WEBHOOK_URL 未設定")
        return
    try:
        resp = requests.post(GAS_WEBHOOK_URL, json=payload)
        print("送信成功:", resp.text)
    except Exception as e:
        print("送信エラー:", e)

if __name__ == '__main__':
    prices = fetch_lme_official_prices()
    send_to_gas(prices)
