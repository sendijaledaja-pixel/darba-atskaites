import { useState, useEffect, useRef } from "react";

const VEIKALI = ["DEPO","SANISTAL","KSENUKAI","STORENT","AKVEDUKTS","UPTK","KURŠI","Cits"];
const STATUSI = [
  { value:"pabeigts",   label:"Pabeigts",   icon:"✓", color:"#16a34a", bg:"#f0fdf4", border:"#bbf7d0" },
  { value:"nepabeigts", label:"Nepabeigts", icon:"⏳", color:"#d97706", bg:"#fffbeb", border:"#fde68a" },
  { value:"turpinams",  label:"Jāturpina",  icon:"↻", color:"#2563eb", bg:"#eff6ff", border:"#bfdbfe" },
];
const DARBINIEKI = ["Aigars","Valdis"];
const SK = "darba_atskaites_v4";
const CFG_KEY = "da_config_v1";

const getToday = () => new Date().toISOString().split("T")[0];
const emptyMat = () => ({ nosaukums:"", veikals:"", cena:"", kopejsCeks:false, objektiSaraksts:"" });
const emptyForm = () => ({
  darbinieki:[], objekts:"", datums:getToday(),
  laiks_no:"", laiks_lidz:"", statuss:"",
  darba_apraksts:"", materiali:false,
  materiali_saraksts:[emptyMat()], pieziimes:"", foto:[],
});

// localStorage helpers (works in real browser)
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function calcHours(no, lidz) {
  if (!no || !lidz) return null;
  const [h1,m1] = no.split(":").map(Number);
  const [h2,m2] = lidz.split(":").map(Number);
  const d = (h2*60+m2) - (h1*60+m1);
  return d > 0 ? `${Math.floor(d/60)}h${d%60 ? " "+d%60+"min" : ""}` : null;
}

async function resizeImage(file) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h*MAX/w); w = MAX; }
          else { w = Math.round(w*MAX/h); h = MAX; }
        }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        res(c.toDataURL("image/jpeg", 0.72));
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });
}

function formatReport(f) {
  const hours = calcHours(f.laiks_no, f.laiks_lidz);
  const st = STATUSI.find(s => s.value === f.statuss);
  const mats = (f.materiali && f.materiali_saraksts || []).filter(m => m.nosaukums);
  let txt = `📋 *DARBA ATSKAITE*\n`;
  txt += `👷 ${f.darbinieki.join(" & ")}\n`;
  txt += `📍 ${f.objekts}\n`;
  txt += `📅 ${f.datums}`;
  if (f.laiks_no && f.laiks_lidz) txt += ` · ${f.laiks_no}–${f.laiks_lidz}`;
  if (hours) txt += ` (${hours})`;
  txt += `\n${st ? st.icon+" "+st.label : "?"}\n\n`;
  txt += `📝 ${f.darba_apraksts}\n`;
  if (mats.length) {
    txt += `\n🧱 *Materiāli:*\n`;
    mats.forEach(m => {
      txt += `• ${m.nosaukums}`;
      if (m.veikals) txt += ` — ${m.veikals}`;
      if (m.cena) txt += ` — €${m.cena}`;
      if (m.kopejsCeks && m.objektiSaraksts) txt += ` (kopējs čeks: ${m.objektiSaraksts})`;
      txt += "\n";
    });
  }
  if (f.pieziimes) txt += `\n💬 ${f.pieziimes}`;
  return txt;
}

async function sendTelegram(report, token, chatId) {
  const text = formatReport(report);
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    for (const b64 of (report.foto || [])) {
      const blob = await (await fetch(b64)).blob();
      const fd = new FormData();
      fd.append("chat_id", chatId);
      fd.append("photo", blob, "photo.jpg");
      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: fd });
    }
    return { ok: true };
  } catch (e) { return { ok: false, err: e.message }; }
}

function openWhatsApp(report, phone) {
  const text = formatReport(report);
  const clean = phone.replace(/\D/g, "");
  window.open(`https://wa.me/${clean}?text=${encodeURIComponent(text)}`, "_blank");
}

const C = "#cc785c";
const card = { background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", padding:"16px 18px", marginBottom:12 };
const inp = { width:"100%", background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:8, padding:"11px 13px", color:"#111827", fontSize:15, boxSizing:"border-box", outline:"none", fontFamily:"inherit", marginBottom:12 };
const lbl = { fontSize:13, color:"#6b7280", marginBottom:5, display:"block" };
const sLbl = { fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:12, display:"block" };

export default function App() {
  const [view, setView]         = useState("menu");
  const [reports, setReports]   = useState(() => lsGet(SK, []));
  const [done, setDone]         = useState(false);
  const [sending, setSending]   = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [form, setForm]         = useState(emptyForm());
  const [cfg, setCfg]           = useState(() => lsGet(CFG_KEY, { waPhone:"", tgToken:"", tgChatId:"", useWA:false, useTG:false }));
  const [cfgDirty, setCfgDirty] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  function saveReports(list) { lsSet(SK, list); setReports(list); }
  function saveCfg(c) { lsSet(CFG_KEY, c); setCfg(c); setCfgDirty(false); }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setCfgField = (k, v) => { setCfg(c => ({ ...c, [k]: v })); setCfgDirty(true); };

  function toggleWorker(name) {
    const cur = form.darbinieki;
    set("darbinieki", cur.includes(name) ? cur.filter(d => d !== name) : [...cur, name]);
  }
  function updateMat(i, k, v) {
    const arr = [...form.materiali_saraksts]; arr[i] = { ...arr[i], [k]: v };
    set("materiali_saraksts", arr);
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const resized = await Promise.all(files.map(resizeImage));
    set("foto", [...form.foto, ...resized]);
    setUploading(false); e.target.value = "";
  }

  async function submit() {
    setSending(true); setSendResult(null);
    const r = { ...form, id: Date.now(), iesniegts: new Date().toISOString() };
    const upd = [r, ...reports];
    saveReports(upd);
    let res = { wa: null, tg: null };
    if (cfg.useWA && cfg.waPhone) { openWhatsApp(r, cfg.waPhone); res.wa = "opened"; }
    if (cfg.useTG && cfg.tgToken && cfg.tgChatId) {
      const tgRes = await sendTelegram(r, cfg.tgToken, cfg.tgChatId);
      res.tg = tgRes.ok ? "sent" : "error";
    }
    setSendResult(res); setSending(false); setDone(true);
  }

  function newForm() { setForm(emptyForm()); setDone(false); setSendResult(null); setView("form"); }
  const canSubmit = form.darbinieki.length > 0 && form.objekts && form.statuss && form.darba_apraksts;
  const hours = calcHours(form.laiks_no, form.laiks_lidz);

  const Logo = () => (
    <div style={{ width:30, height:30, borderRadius:8, background:C, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700, flexShrink:0 }}>DA</div>
  );
  const Header = ({ title, sub, back, action, actionLabel }) => (
    <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"14px 18px", display:"flex", alignItems:"center", gap:10, position:"sticky", top:0, zIndex:10 }}>
      {back && <button onClick={back} style={{ background:"none", border:"none", color:"#6b7280", fontSize:20, cursor:"pointer", padding:"0 4px", lineHeight:1 }}>←</button>}
      <Logo />
      <div style={{ flex:1 }}>
        <p style={{ margin:0, fontSize:15, fontWeight:600, color:"#111827", lineHeight:1.3 }}>{title}</p>
        {sub && <p style={{ margin:0, fontSize:12, color:"#9ca3af" }}>{sub}</p>}
      </div>
      {action && <button onClick={action} style={{ background:"none", border:"none", color:C, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>{actionLabel}</button>}
    </div>
  );
  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} style={{ width:44, height:24, borderRadius:12, background:on?C:"#d1d5db", border:"none", cursor:"pointer", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
      <div style={{ position:"absolute", top:3, left:on?22:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
    </button>
  );
  const PhotoGrid = ({ photos, onRemove }) => (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
      {photos.map((src, i) => (
        <div key={i} style={{ position:"relative", aspectRatio:"1", borderRadius:8, overflow:"hidden", border:"1px solid #e5e7eb" }}>
          <img src={src} alt="" onClick={() => setLightbox(src)} style={{ width:"100%", height:"100%", objectFit:"cover", cursor:"pointer", display:"block" }} />
          {onRemove && <button onClick={() => onRemove(i)} style={{ position:"absolute", top:4, right:4, width:22, height:22, borderRadius:"50%", background:"rgba(0,0,0,0.55)", border:"none", color:"#fff", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>}
        </div>
      ))}
    </div>
  );

  // LIGHTBOX overlay
  if (lightbox) return (
    <div onClick={() => setLightbox(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <img src={lightbox} alt="" style={{ maxWidth:"100%", maxHeight:"90vh", borderRadius:10, objectFit:"contain" }} />
      <button onClick={() => setLightbox(null)} style={{ position:"absolute", top:16, right:16, background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", borderRadius:"50%", width:36, height:36, fontSize:18, cursor:"pointer" }}>✕</button>
    </div>
  );

  // SETTINGS
  if (view === "settings") return (
    <div style={{ minHeight:"100vh", background:"#f8f9fb", fontFamily:"system-ui,-apple-system,sans-serif", color:"#111827" }}>
      <Header title="Iestatījumi" sub="Nosūtīšanas kanāli" back={() => setView("menu")} />
      <div style={{ padding:16, maxWidth:480, margin:"0 auto", paddingBottom:40 }}>
        <div style={card}>
          <span style={sLbl}>📱 WhatsApp</span>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <span style={{ fontSize:14, color:"#374151" }}>Ieslēgt WhatsApp</span>
            <Toggle on={cfg.useWA} onClick={() => setCfgField("useWA", !cfg.useWA)} />
          </div>
          {cfg.useWA && (
            <>
              <label style={lbl}>Tavs WhatsApp numurs (ar valsts kodu)</label>
              <input style={inp} placeholder="+37120000000" value={cfg.waPhone} onChange={e => setCfgField("waPhone", e.target.value)} />
              <div style={{ fontSize:12, color:"#9ca3af", marginTop:-8 }}>Pēc atskaites atvērsies WhatsApp ar sagatavotu tekstu</div>
            </>
          )}
        </div>
        <div style={card}>
          <span style={sLbl}>✈️ Telegram</span>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <span style={{ fontSize:14, color:"#374151" }}>Ieslēgt Telegram</span>
            <Toggle on={cfg.useTG} onClick={() => setCfgField("useTG", !cfg.useTG)} />
          </div>
          {cfg.useTG && (
            <>
              <label style={lbl}>Bot Token (no @BotFather)</label>
              <input style={inp} placeholder="1234567890:AAFxxxxxxx" value={cfg.tgToken} onChange={e => setCfgField("tgToken", e.target.value)} />
              <label style={lbl}>Chat ID</label>
              <input style={inp} placeholder="-1001234567890" value={cfg.tgChatId} onChange={e => setCfgField("tgChatId", e.target.value)} />
            </>
          )}
        </div>
        {cfgDirty
          ? <button onClick={() => saveCfg(cfg)} style={{ width:"100%", background:C, border:"none", borderRadius:12, padding:16, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Saglabāt</button>
          : <div style={{ textAlign:"center", fontSize:13, color:"#9ca3af", padding:"12px 0" }}>Saglabāts ✓</div>
        }
      </div>
    </div>
  );

  // MENU
  if (view === "menu") return (
    <div style={{ minHeight:"100vh", background:"#f8f9fb", fontFamily:"system-ui,-apple-system,sans-serif", color:"#111827" }}>
      <Header title="Darba Atskaites" sub={new Date().toLocaleDateString("lv-LV", { weekday:"long", day:"numeric", month:"long" })} action={() => setView("settings")} actionLabel="⚙️" />
      <div style={{ padding:16, maxWidth:480, margin:"0 auto" }}>
        {!cfg.useWA && !cfg.useTG && (
          <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:10, padding:"12px 14px", marginBottom:12, fontSize:13, color:"#92400e" }}>
            ⚙️ Nosūtīšana nav iestatīta — <span onClick={() => setView("settings")} style={{ color:C, fontWeight:600, cursor:"pointer" }}>spiedi šeit</span>
          </div>
        )}
        {(cfg.useWA || cfg.useTG) && (
          <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:10, padding:"10px 14px", marginBottom:12, fontSize:13, color:"#166534", display:"flex", gap:12 }}>
            {cfg.useWA && <span>📱 WhatsApp aktīvs</span>}
            {cfg.useTG && <span>✈️ Telegram aktīvs</span>}
          </div>
        )}
        {[
          { label:"Jauna atskaite", sub:"Aizpildi šīs dienas darbu", icon:"📋", accent:C, action:newForm },
          { label:"Atskaišu vēsture", sub:`${reports.length} ieraksti`, icon:"📊", accent:"#2563eb", action:() => setView("reports") },
          { label:"Iestatījumi", sub:"WhatsApp, Telegram", icon:"⚙️", accent:"#6b7280", action:() => setView("settings") },
        ].map(item => (
          <div key={item.label} onClick={item.action} style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:16, padding:"18px 20px", marginBottom:12, cursor:"pointer", display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ width:44, height:44, borderRadius:12, background:item.accent+"18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{item.icon}</div>
            <div>
              <div style={{ fontWeight:600, fontSize:16, color:"#111827", marginBottom:2 }}>{item.label}</div>
              <div style={{ fontSize:13, color:"#9ca3af" }}>{item.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // SUCCESS
  if (done) return (
    <div style={{ minHeight:"100vh", background:"#f8f9fb", fontFamily:"system-ui,-apple-system,sans-serif", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ textAlign:"center", maxWidth:340, width:"100%" }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"#f0fdf4", border:"2px solid #bbf7d0", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px", fontSize:32 }}>✓</div>
        <div style={{ fontSize:22, fontWeight:700, color:"#111827", marginBottom:8 }}>Atskaite iesniegta!</div>
        <div style={{ fontSize:14, color:"#6b7280", marginBottom:4 }}>Objekts: <strong style={{ color:"#111827" }}>{form.objekts}</strong></div>
        <div style={{ fontSize:14, color:"#6b7280", marginBottom:20 }}>Darbinieki: <strong style={{ color:"#111827" }}>{form.darbinieki.join(" & ")}</strong></div>
        {sendResult && (
          <div style={{ marginBottom:16 }}>
            {sendResult.wa === "opened" && <div style={{ fontSize:13, color:"#16a34a", marginBottom:4 }}>📱 WhatsApp atvērts — nosūti ziņu!</div>}
            {sendResult.tg === "sent"   && <div style={{ fontSize:13, color:"#16a34a", marginBottom:4 }}>✈️ Telegram nosūtīts ✓</div>}
            {sendResult.tg === "error"  && <div style={{ fontSize:13, color:"#d97706", marginBottom:4 }}>⚠️ Telegram kļūda — pārbaudi iestatījumus</div>}
          </div>
        )}
        {form.foto.length > 0 && <div style={{ marginBottom:20 }}><PhotoGrid photos={form.foto} /></div>}
        <button onClick={newForm} style={{ width:"100%", background:C, border:"none", borderRadius:12, padding:16, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", fontFamily:"inherit", marginBottom:10 }}>+ Jauna atskaite</button>
        <button onClick={() => setView("menu")} style={{ width:"100%", background:"#f3f4f6", border:"none", borderRadius:12, padding:16, color:"#6b7280", fontSize:16, cursor:"pointer", fontFamily:"inherit" }}>← Sākums</button>
      </div>
    </div>
  );

  // REPORTS
  if (view === "reports") return (
    <div style={{ minHeight:"100vh", background:"#f8f9fb", fontFamily:"system-ui,-apple-system,sans-serif", color:"#111827" }}>
      <Header title="Atskaišu vēsture" sub={`${reports.length} ieraksti`} back={() => setView("menu")} />
      <div style={{ padding:16, maxWidth:480, margin:"0 auto", paddingBottom:40 }}>
        {reports.length === 0 && (
          <div style={{ textAlign:"center", color:"#9ca3af", padding:"60px 20px" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📭</div>
            <div>Vēl nav atskaišu</div>
          </div>
        )}
        {reports.map(r => {
          const st = STATUSI.find(s => s.value === r.statuss) || STATUSI[1];
          const h = calcHours(r.laiks_no, r.laiks_lidz);
          const mats = (r.materiali_saraksts || []).filter(m => m.nosaukums);
          return (
            <div key={r.id} style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, padding:"16px 18px", marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                <div style={{ fontWeight:600, fontSize:15, color:"#111827", flex:1, marginRight:8 }}>{r.objekts}</div>
                <span style={{ background:st.bg, color:st.color, border:`1px solid ${st.border}`, borderRadius:20, padding:"3px 10px", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>{st.label}</span>
              </div>
              <div style={{ fontSize:13, color:"#6b7280", marginBottom:8 }}>👷 {(r.darbinieki||[]).join(" & ")} · 📅 {r.datums}{h ? ` · ⏱ ${h}` : ""}</div>
              <div style={{ fontSize:14, color:"#374151", marginBottom:mats.length?8:0 }}>{r.darba_apraksts}</div>
              {mats.map((m,i) => (
                <span key={i} style={{ display:"inline-block", background:"#f3f4f6", border:"1px solid #e5e7eb", borderRadius:6, padding:"3px 9px", fontSize:12, color:"#6b7280", marginRight:5, marginBottom:5 }}>
                  {m.nosaukums}{m.veikals ? ` · ${m.veikals}` : ""}{m.cena ? ` · €${m.cena}` : ""}{m.kopejsCeks ? " 🔗" : ""}
                </span>
              ))}
              {r.foto?.length > 0 && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:12, color:"#9ca3af", marginBottom:6 }}>📷 {r.foto.length} foto</div>
                  <PhotoGrid photos={r.foto} />
                </div>
              )}
              {r.pieziimes && <div style={{ fontSize:13, color:"#9ca3af", marginTop:8, borderTop:"1px solid #f3f4f6", paddingTop:8 }}>{r.pieziimes}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );

  // FORM
  return (
    <div style={{ minHeight:"100vh", background:"#f8f9fb", fontFamily:"system-ui,-apple-system,sans-serif", color:"#111827" }}>
      <Header title="Jauna atskaite" sub="Aizpildi darba informāciju" back={() => setView("menu")} />
      <div style={{ padding:16, maxWidth:480, margin:"0 auto", paddingBottom:40 }}>

        <div style={card}>
          <span style={sLbl}>Darbinieks</span>
          <div style={{ display:"flex", gap:8 }}>
            {DARBINIEKI.map(d => {
              const active = form.darbinieki.includes(d);
              return (
                <button key={d} onClick={() => toggleWorker(d)} style={{ flex:1, padding:"13px 8px", borderRadius:10, border:active?`2px solid ${C}`:"1px solid #e5e7eb", background:active?"#fdf5f2":"#fff", color:active?"#9a4423":"#6b7280", fontWeight:active?600:400, fontSize:15, cursor:"pointer", fontFamily:"inherit" }}>
                  {d}
                </button>
              );
            })}
          </div>
          {form.darbinieki.length === 2 && <div style={{ marginTop:10, fontSize:13, color:C, fontWeight:500, textAlign:"center" }}>Strādājat kopā — abi atlasīti ✓</div>}
        </div>

        <div style={card}>
          <span style={sLbl}>Objekts & Laiks</span>
          <label style={lbl}>Objekta adrese / nosaukums</label>
          <input style={inp} placeholder="Piemēram: Brīvības 45, Rīga" value={form.objekts} onChange={e => set("objekts", e.target.value)} />
          <label style={lbl}>Datums</label>
          <input style={inp} type="date" value={form.datums} onChange={e => set("datums", e.target.value)} />
          <label style={lbl}>Darba laiks</label>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <input style={{ ...inp, flex:1, marginBottom:0 }} type="time" value={form.laiks_no} onChange={e => set("laiks_no", e.target.value)} />
            <span style={{ color:"#9ca3af", padding:"0 4px" }}>—</span>
            <input style={{ ...inp, flex:1, marginBottom:0 }} type="time" value={form.laiks_lidz} onChange={e => set("laiks_lidz", e.target.value)} />
          </div>
          {hours && <div style={{ fontSize:13, color:C, fontWeight:600, marginTop:8 }}>Kopā: {hours}</div>}
        </div>

        <div style={card}>
          <span style={sLbl}>Darba statuss</span>
          <div style={{ display:"flex", gap:8 }}>
            {STATUSI.map(st => {
              const active = form.statuss === st.value;
              return (
                <button key={st.value} onClick={() => set("statuss", st.value)} style={{ flex:1, padding:"12px 6px", borderRadius:10, cursor:"pointer", textAlign:"center", border:active?`2px solid ${st.border}`:"1px solid #e5e7eb", background:active?st.bg:"#fff", color:active?st.color:"#9ca3af", fontWeight:active?600:400, fontSize:12, fontFamily:"inherit" }}>
                  <div style={{ fontSize:18, marginBottom:4 }}>{st.icon}</div>
                  {st.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={card}>
          <span style={sLbl}>Veiktie darbi</span>
          <textarea style={{ ...inp, minHeight:80, resize:"vertical", marginBottom:0 }} placeholder="Apraksti, kādi darbi tika veikti..." value={form.darba_apraksts} onChange={e => set("darba_apraksts", e.target.value)} />
        </div>

        <div style={card}>
          <span style={sLbl}>Foto no objekta</span>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display:"none" }} />
          <div style={{ display:"flex", gap:8, marginBottom:form.foto.length?12:0 }}>
            <button onClick={() => { fileRef.current.removeAttribute("capture"); fileRef.current.click(); }} style={{ flex:1, background:"#f9fafb", border:"1.5px dashed #d1d5db", borderRadius:10, padding:"14px 8px", color:"#6b7280", fontSize:13, cursor:"pointer", fontFamily:"inherit", textAlign:"center" }}>📁 Galerija</button>
            <button onClick={() => { fileRef.current.setAttribute("capture","environment"); fileRef.current.click(); }} style={{ flex:1, background:C+"10", border:`1.5px dashed ${C}`, borderRadius:10, padding:"14px 8px", color:C, fontSize:13, cursor:"pointer", fontFamily:"inherit", textAlign:"center", fontWeight:600 }}>📷 Kamera</button>
          </div>
          {uploading && <div style={{ fontSize:13, color:"#9ca3af", textAlign:"center", padding:"8px 0" }}>Apstrādā...</div>}
          {form.foto.length > 0 && (
            <>
              <div style={{ fontSize:13, color:"#6b7280", marginBottom:8 }}>{form.foto.length} foto pievienoti</div>
              <PhotoGrid photos={form.foto} onRemove={i => set("foto", form.foto.filter((_,j) => j!==i))} />
            </>
          )}
        </div>

        <div style={card}>
          <span style={sLbl}>Materiāli</span>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:14, color:"#374151" }}>Vai tika izmantoti materiāli?</span>
            <Toggle on={form.materiali} onClick={() => set("materiali", !form.materiali)} />
          </div>
          {form.materiali && (
            <div style={{ marginTop:16 }}>
              {form.materiali_saraksts.map((m, i) => (
                <div key={i} style={{ background:"#f9fafb", borderRadius:10, padding:14, marginBottom:10, border:"1px solid #e5e7eb" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:C }}>Materiāls #{i+1}</span>
                    {form.materiali_saraksts.length > 1 && <button onClick={() => set("materiali_saraksts", form.materiali_saraksts.filter((_,j) => j!==i))} style={{ background:"none", border:"none", color:"#ef4444", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✕ Noņemt</button>}
                  </div>
                  <label style={lbl}>Nosaukums</label>
                  <input style={inp} placeholder="Ko nopirka?" value={m.nosaukums} onChange={e => updateMat(i,"nosaukums",e.target.value)} />
                  <label style={lbl}>Veikals</label>
                  <select style={inp} value={m.veikals} onChange={e => updateMat(i,"veikals",e.target.value)}>
                    <option value="">— Izvēlēties —</option>
                    {VEIKALI.map(v => <option key={v}>{v}</option>)}
                  </select>
                  <label style={lbl}>Summa (€)</label>
                  <input style={inp} type="number" placeholder="0.00" value={m.cena} onChange={e => updateMat(i,"cena",e.target.value)} />
                  <label onClick={() => updateMat(i,"kopejsCeks",!m.kopejsCeks)} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", userSelect:"none" }}>
                    <div style={{ width:18, height:18, borderRadius:5, border:m.kopejsCeks?"2px solid #2563eb":"1.5px solid #d1d5db", background:m.kopejsCeks?"#2563eb":"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      {m.kopejsCeks && <span style={{ color:"#fff", fontSize:12, lineHeight:1 }}>✓</span>}
                    </div>
                    <span style={{ fontSize:13, color:"#374151" }}>Šis čeks segts vairākiem objektiem</span>
                  </label>
                  {m.kopejsCeks && (
                    <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"10px 12px", marginTop:10 }}>
                      <label style={{ ...lbl, color:"#2563eb", marginBottom:6 }}>Kuri citi objekti?</label>
                      <input style={{ ...inp, background:"#fff", marginBottom:0 }} placeholder="Brīvības 45, Dzirnavu 12..." value={m.objektiSaraksts||""} onChange={e => updateMat(i,"objektiSaraksts",e.target.value)} />
                    </div>
                  )}
                </div>
              ))}
              <button onClick={() => set("materiali_saraksts", [...form.materiali_saraksts, emptyMat()])} style={{ width:"100%", background:"#fff", border:"1.5px dashed #d1d5db", borderRadius:10, padding:12, color:"#6b7280", fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                + Pievienot materiālu
              </button>
            </div>
          )}
        </div>

        <div style={card}>
          <span style={sLbl}>Papildu piezīmes</span>
          <textarea style={{ ...inp, minHeight:70, resize:"vertical", marginBottom:0 }} placeholder="Jebkas cits..." value={form.pieziimes} onChange={e => set("pieziimes", e.target.value)} />
        </div>

        {!canSubmit && (
          <div style={{ fontSize:13, color:"#d97706", textAlign:"center", marginBottom:8, background:"#fffbeb", border:"1px solid #fde68a", borderRadius:8, padding:"10px 14px" }}>
            Aizpildi: darbinieks, objekts, statuss un darba apraksts
          </div>
        )}
        {cfg.useWA && cfg.waPhone && <div style={{ fontSize:13, color:"#374151", textAlign:"center", marginBottom:6 }}>📱 Atvērsies WhatsApp pēc iesniegšanas</div>}
        {cfg.useTG && cfg.tgToken && <div style={{ fontSize:13, color:"#374151", textAlign:"center", marginBottom:8 }}>✈️ Nosūtīs uz Telegram automātiski</div>}

        <button onClick={canSubmit && !sending ? submit : undefined} style={{ width:"100%", background:canSubmit&&!sending?C:"#e5e7eb", border:"none", borderRadius:12, padding:16, color:canSubmit&&!sending?"#fff":"#9ca3af", fontSize:16, fontWeight:600, cursor:canSubmit&&!sending?"pointer":"not-allowed", fontFamily:"inherit" }}>
          {sending ? "Nosūta..." : "Iesniegt atskaiti"}
        </button>
      </div>
    </div>
  );
}
