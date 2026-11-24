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
