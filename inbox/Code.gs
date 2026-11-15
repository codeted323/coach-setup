// Canvas Coach inbox sync. Runs in the student's own Google account, READ-ONLY:
// every 15 minutes it sends the Coach bot recent inbox emails (sender, subject, short preview)
// and the next 14 days of his calendar. It cannot send, change or delete anything.
// The shared secret lives in Project Settings > Script Properties as INBOX_SECRET (never in this code).

const COACH_URL = "https://coach-bot.ted323-aa5.workers.dev/inbox";

// Run this ONCE by hand: it approves access, starts the 15-minute timer, and sends the first sync.
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sync").timeBased().everyMinutes(15).create();
  sync();
  console.log("Setup done. Sync will run every 15 minutes.");
}

function sync() {
  const secret = PropertiesService.getScriptProperties().getProperty("INBOX_SECRET");
  if (!secret) throw new Error("Add INBOX_SECRET in Project Settings > Script Properties first.");

  const emails = [];
  const list = Gmail.Users.Messages.list("me", { q: "in:inbox newer_than:3d", maxResults: 40 });
  (list.messages || []).forEach(m => {
    const msg = Gmail.Users.Messages.get("me", m.id, { format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
    const h = {};
    (msg.payload.headers || []).forEach(x => h[x.name] = x.value);
    emails.push({
      id: m.id, from: h.From || "", subject: h.Subject || "", date: h.Date || "",
      preview: (msg.snippet || "").slice(0, 300),
      unread: (msg.labelIds || []).indexOf("UNREAD") >= 0,
      link: "https://mail.google.com/mail/u/0/#inbox/" + m.id,
    });
  });

  const now = new Date(), later = new Date(now.getTime() + 14 * 86400000);
  const ev = Calendar.Events.list("primary", { timeMin: now.toISOString(), timeMax: later.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 60 });
  const events = (ev.items || []).map(e => ({
    id: e.id, title: e.summary || "(no title)", start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date,
    allDay: !e.start.dateTime, where: e.location || "", link: e.htmlLink || "",
  }));

  const r = UrlFetchApp.fetch(COACH_URL, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + secret },
    payload: JSON.stringify({ sent: now.toISOString(), emails: emails, events: events }),
  });
  console.log("Sent " + emails.length + " emails and " + events.length + " events. Coach said " + r.getResponseCode());
  if (r.getResponseCode() !== 200) throw new Error("Coach bot rejected the sync (" + r.getResponseCode() + "). Check INBOX_SECRET.");
}
