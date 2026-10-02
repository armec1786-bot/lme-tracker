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
