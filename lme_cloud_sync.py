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
                if len(rows) >= 3:
                    tds1 = rows[1].query_selector_all('td')
                    tds2 = rows[2].query_selector_all('td')
                    
                    if len(tds1) >= 2 and len(tds2) >= 2:
                        if not date_str:
                            date_str = tds1[0].inner_text().strip()
                            
                        p1_str = tds1[1].inner_text().strip().replace(',', '')
                        p2_str = tds2[1].inner_text().strip().replace(',', '')
                        
                        price1 = float(p1_str)
                        price2 = float(p2_str)
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

def get_tokyo_steel_shindan(page):
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
                    
        prices = []
        changes = []
        
        for line in page0_lines:
            if '新' in line and '断' in line:
                nums = re.findall(r'([0-9]{2},[0-9]{3})', line)
                if nums and not prices:
                    prices = nums
                    
        for line in page1_lines:
            if '新' in line and '断' in line:
                nums = re.findall(r'([\+-][0-9,]+|0)', line)
                if nums and not changes:
                    changes = nums
                    
        factories = ['田原(海上)', '田原(陸上)', '岡山(陸上)', '関西サテライト', '九州(陸上)', '宇都宮(陸上)']
        
        details = {}
        for i, fac in enumerate(factories):
            p_val = prices[i] if i < len(prices) else 'N/A'
            c_val = changes[i] if i < len(changes) else '0'
            
            c_fmt = c_val + '円/t' if c_val.startswith('+') or c_val.startswith('-') else ('+' + c_val + '円/t' if c_val != '±0' and c_val != '0' else '±0円/t')
            
            details[fac] = {
                'price': p_val + '円/t' if p_val != 'N/A' else 'N/A',
                'change': c_fmt
            }
            
        return {
            'update_date': update_date,
            'apply_date': apply_date,
            'details': details
        }
    except Exception as e:
        print('Tokyo Steel Error:', e)
        return None

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        westmetall_data = get_westmetall_cash_prices_with_change(page)
        boj_forex = get_boj_forex(page)
        jx_copper = get_jx_copper(page)
        tokyo_steel = get_tokyo_steel_shindan(page)
        
        browser.close()
        
    # 円換算計算
    central_num = boj_forex.get('central_num') if boj_forex else None
    if westmetall_data and westmetall_data.get('prices') and central_num:
        for k, v in westmetall_data['prices'].items():
            price_jpy = round(v['price_usd'] * central_num)
            v['price_jpy'] = price_jpy
            
    today_str = datetime.date.today().strftime('%Y-%m-%d')
    payload = {
        'date': today_str,
        'lme_cash': westmetall_data,
        'boj_forex': boj_forex,
        'jx_copper': jx_copper,
        'tokyo_steel': tokyo_steel
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
