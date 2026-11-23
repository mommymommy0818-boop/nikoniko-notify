// 10分ごとに動いて、通知の時刻になったスマホへ、今日や明日の予定を送ります。
const admin = require("firebase-admin");

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

const PEOPLE = ["パパ", "ママ", "吹奏楽部", "バトン", "アップルムーン", "ナナ（その他）", "家族", "パパとママ", "パパとナナ", "ママとナナ"];
const WINDOW_MIN = 120;   // 時刻から2時間以内なら、遅れていても送る（GitHubの実行は遅れることがあるため）

const p = n => String(n).padStart(2, "0");
const fmt = d => `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
const jst = new Date(Date.now() + 9 * 3600 * 1000);   // 日本時間
const today = fmt(jst);
const tomorrowDate = new Date(jst.getTime() + 86400000);
const tomorrow = fmt(tomorrowDate);
const nowMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
const DOW = "日月火水木金土";

function build(day, events) {
  const d = day === 1 ? tomorrowDate : jst;
  const ds = day === 1 ? tomorrow : today;
  const title = `${day === 1 ? "明日" : "今日"}の予定（${d.getUTCMonth() + 1}/${d.getUTCDate()} ${DOW[d.getUTCDay()]}）`;
  const list = events.filter(e => e.date === ds).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  if (!list.length) return { title, body: "予定はありません" };
  const lines = list.slice(0, 8).map(e => {
    const t = e.start ? e.start + (e.end ? "〜" + e.end : "") : "終日";
    return `${t} ${e.title || ""}［${PEOPLE[e.person] || ""}］${e.place ? " " + e.place : ""}`;
  });
  if (list.length > 8) lines.push(`ほか${list.length - 8}件`);
  return { title, body: lines.join("\n") };
}

async function main() {
  const devices = await db.collection("devices").get();
  if (devices.empty) { console.log("登録されたスマホはありません"); return; }
  const snap = await db.collection("events").where("date", "in", [today, tomorrow]).get();
  const events = snap.docs.map(d => d.data());
  console.log(`日本時間 ${today} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())} / スマホ${devices.size}台 / 予定${events.length}件`);

  for (const doc of devices.docs) {
    const dev = doc.data();
    const slots = Array.isArray(dev.slots) ? dev.slots : [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || !s.on || typeof s.at !== "string") continue;
      const [h, m] = s.at.split(":").map(Number);
      const diff = nowMin - (h * 60 + m);
      if (!(diff >= 0 && diff < WINDOW_MIN)) continue;
      if ((dev.lastSent || {})[i] === today) continue;
      const msg = build(s.day === 1 ? 1 : 0, events);
      try {
        await admin.messaging().send({
          token: doc.id,
          data: { title: msg.title, body: msg.body, tag: `${s.day === 1 ? "t" : "d"}-${today}` },
          webpush: { headers: { Urgency: "high", TTL: "7200" } }
        });
        await doc.ref.update({ [`lastSent.${i}`]: today });
        console.log(`送りました：${dev.name || "?"} の ${i + 1}つ目`);
      } catch (e) {
        console.log(`失敗：${dev.name || "?"} ${e.code || e.message}`);
        if (e.code === "messaging/registration-token-not-registered" || e.code === "messaging/invalid-registration-token") await doc.ref.delete();
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
