// File: scheduler.gs
const GH_OWNER = "armec1786-bot";
const GH_REPO = "lme-tracker";

// everyday: true → 土日祝日も起動 / false → 平日（祝日を除く）のみ
// JX・東京製鉄は、起動後に各スクリプト内で5分おきに確認を続ける（終了時刻はPython側の WINDOW_END）
const SCHEDULE = [
  { workflow: "daily_lme.yml", time: "06:37", everyday: true },
  { workflow: "daily_jx.yml", time: "09:20", everyday: false },
  { workflow: "daily_tokyo_steel.yml", time: "15:55", everyday: false }
];
const TZ = "Asia/Tokyo";

function setupDailyScheduler() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "scheduleToday")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("scheduleToday")
    .timeBased().everyDays(1).atHour(4).inTimezone(TZ).create();
  scheduleToday();
}

function scheduleToday() {
  const props = PropertiesService.getScriptProperties();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "dispatchByTrigger")
    .forEach(t => {
      props.deleteProperty("trig_" + t.getUniqueId());
      ScriptApp.deleteTrigger(t);
    });

  const now = new Date();
  const dow = Number(Utilities.formatDate(now, TZ, "u"));
  const isBusinessDay = dow <= 5 && !isJapaneseHoliday(now);
  const today = Utilities.formatDate(now, TZ, "yyyy-MM-dd");

  SCHEDULE.forEach(s => {
    if (!s.everyday && !isBusinessDay) return;
    const at = new Date(`${today}T${s.time}:00+09:00`);
    if (at <= now) return;
    const trig = ScriptApp.newTrigger("dispatchByTrigger").timeBased().at(at).create();
    props.setProperty("trig_" + trig.getUniqueId(), s.workflow);
  });
}

function dispatchByTrigger(e) {
  const props = PropertiesService.getScriptProperties();
  const key = "trig_" + e.triggerUid;
  const workflow = props.getProperty(key);
  props.deleteProperty(key);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getUniqueId() === e.triggerUid)
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (workflow) dispatchWorkflow(workflow);
}

function dispatchWorkflow(workflow) {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflow}/dispatches`;
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
    payload: JSON.stringify({ ref: "main" }),
    muteHttpExceptions: true
  });
  console.log(`${workflow}: HTTP ${res.getResponseCode()}`);
  if (res.getResponseCode() !== 204) {
    GmailApp.sendEmail(DEFAULT_RECIPIENT, `【警告】自動起動失敗: ${workflow}`,
      `HTTP ${res.getResponseCode()}\n${res.getContentText()}`);
  }
}

function isJapaneseHoliday(date) {
  const cal = CalendarApp.getCalendarById("ja.japanese#holiday@group.v.calendar.google.com");
  return cal ? cal.getEventsForDay(date).length > 0 : false;
}

function testDispatchNow() {
  dispatchWorkflow("daily_jx.yml");
}
