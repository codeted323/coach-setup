// Canvas Coach inbox helper. Runs in the student's own Google account.
// - Every 15 minutes: sends the Coach bot recent inbox emails (sender, subject, short preview) and the next 14 days of calendar.
// - Every minute: asks Coach if there's an inbox clean-up job (started from Discord), and does it:
//     scan = read sender/subject of inbox emails so Coach can propose a plan
//     apply = add Coach/... labels, archive, star exactly what was approved in Discord
//     undo = reverse the last apply
// It can label and archive. It cannot send email or permanently delete anything.
// The shared secret lives in Project Settings > Script Properties as INBOX_SECRET (never in this code).

const COACH = "https://coach-bot.ted323-aa5.workers.dev";

// Run this ONCE by hand: approves access, starts the 1-minute timer, sends the first sync.
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("tick").timeBased().everyMinutes(1).create();
  sync();
  console.log("Setup done. Checking for jobs every minute, syncing every 15 minutes.");
}

function tick() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty("LAST_SYNC") || 0);
  if (Date.now() - last > 14.5 * 60000) sync();
  const job = call_("GET", "/inbox/job");
  if (job && job.id) doJob_(job);
}

function call_(method, path, body) {
  const secret = PropertiesService.getScriptProperties().getProperty("INBOX_SECRET");
  if (!secret) throw new Error("Add INBOX_SECRET in Project Settings > Script Properties first.");
  const opt = { method: method.toLowerCase(), muteHttpExceptions: true, headers: { Authorization: "Bearer " + secret } };
  if (body) { opt.contentType = "application/json"; opt.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch(COACH + path, opt);
  if (r.getResponseCode() !== 200) throw new Error("Coach said " + r.getResponseCode() + " for " + path + ". Check INBOX_SECRET.");
  const t = r.getContentText();
  return t ? JSON.parse(t) : null;
}

function headers_(msg) { const h = {}; (msg.payload.headers || []).forEach(x => h[x.name] = x.value); return h; }

function sync() {
  const emails = [];
  const list = Gmail.Users.Messages.list("me", { q: "in:inbox newer_than:3d", maxResults: 40 });
  (list.messages || []).forEach(m => {
    const msg = Gmail.Users.Messages.get("me", m.id, { format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
    const h = headers_(msg);
    emails.push({ id: m.id, from: h.From || "", subject: h.Subject || "", date: h.Date || "", preview: (msg.snippet || "").slice(0, 300),
      unread: (msg.labelIds || []).indexOf("UNREAD") >= 0, link: "https://mail.google.com/mail/u/0/#inbox/" + m.id });
  });
  const now = new Date(), later = new Date(now.getTime() + 14 * 86400000);
  const ev = Calendar.Events.list("primary", { timeMin: now.toISOString(), timeMax: later.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 60 });
  const events = (ev.items || []).map(e => ({ id: e.id, title: e.summary || "(no title)", start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date,
    allDay: !e.start.dateTime, where: e.location || "", link: e.htmlLink || "" }));
  call_("POST", "/inbox", { sent: now.toISOString(), emails: emails, events: events });
  PropertiesService.getScriptProperties().setProperty("LAST_SYNC", String(Date.now()));
  console.log("Sent " + emails.length + " emails and " + events.length + " events.");
}

function doJob_(job) {
  try {
    if (job.type === "scan") return scan_(job);
    if (job.type === "apply" || job.type === "undo") return apply_(job);
  } catch (e) {
    call_("POST", "/inbox/done", { jobId: job.id, type: job.type, error: String(e && e.message || e).slice(0, 300) });
  }
}

function scan_(job) {
  const out = [];
  const page = Gmail.Users.Messages.list("me", { q: job.q, maxResults: 300, pageToken: job.pageToken || undefined });
  (page.messages || []).forEach(m => {
    const msg = Gmail.Users.Messages.get("me", m.id, { format: "metadata", metadataHeaders: ["From", "Subject", "Date", "List-Unsubscribe"] });
    const h = headers_(msg), labels = msg.labelIds || [];
    out.push({ id: m.id, from: h.From || "", subject: (h.Subject || "").slice(0, 90), date: h.Date || "",
      unread: labels.indexOf("UNREAD") >= 0, list: !!h["List-Unsubscribe"],
      cat: (labels.filter(l => l.indexOf("CATEGORY_") === 0)[0] || "").replace("CATEGORY_", "").toLowerCase() });
  });
  call_("POST", "/inbox/scan", { jobId: job.id, emails: out, nextPageToken: page.nextPageToken || null });
}

function labelId_(name, cache) {
  if (cache[name]) return cache[name];
  const all = Gmail.Users.Labels.list("me").labels || [];
  all.forEach(l => cache[l.name] = l.id);
  if (!cache[name]) cache[name] = Gmail.Users.Labels.create({ name: name, labelListVisibility: "labelShow", messageListVisibility: "show" }, "me").id;
  return cache[name];
}

function apply_(job) {
  const cache = {}, counts = { labeled: 0, archived: 0, starred: 0 };
  (job.ops || []).forEach(op => {
    const add = [], remove = [];
    const lid = op.label ? labelId_(op.label, cache) : null;
    if (job.type === "apply") {
      if (lid) add.push(lid);
      if (op.star) add.push("STARRED");
      if (op.archive) remove.push("INBOX");
    } else {
      if (lid) remove.push(lid);
      if (op.star) remove.push("STARRED");
      if (op.archive) add.push("INBOX");
    }
    for (let i = 0; i < op.ids.length; i += 1000) {
      const ids = op.ids.slice(i, i + 1000);
      Gmail.Users.Messages.batchModify({ ids: ids, addLabelIds: add, removeLabelIds: remove }, "me");
    }
    if (lid) counts.labeled += op.ids.length;
    if (op.archive) counts.archived += op.ids.length;
    if (op.star) counts.starred += op.ids.length;
  });
  call_("POST", "/inbox/done", { jobId: job.id, type: job.type, counts: counts });
}
