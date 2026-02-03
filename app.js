// =====================
// Helpers
// =====================
const $ = (sel) => document.querySelector(sel);
const nowISO = () => new Date().toISOString();
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });

function showOnly(name) {
  ["login","desk","register","tv","user","admin"].forEach(n => {
    $(`#screen-${n}`).classList.toggle("hidden", n !== name);
  });

  $("#topbar").classList.toggle("hidden", !db.session);
  if (!db.session) return;

  const desk = db.session.deskId ? ` • ${deskLabel(db.session.deskId)}` : "";
  $("#whoami").textContent = `${db.session.name} • ${db.session.username} • ${db.session.roleName}${desk}`;

  applyNavVisibility();
}

// =====================
// Config: Tipos de senha
// =====================
const TICKET_TYPES = [
  { key:"PREFERENCIAL", label:"Preferencial", prefix:"P" },
  { key:"NORMAL",       label:"Normal",       prefix:"N" },
  { key:"IDOSO",        label:"Idoso (60+)",  prefix:"I" },
  { key:"PCD",          label:"PCD",          prefix:"D" },
  { key:"GESTANTE",     label:"Gestante",     prefix:"G" },
  { key:"LACTANTE",     label:"Lactante",     prefix:"L" },
  { key:"AUTISTA",      label:"TEA",          prefix:"T" },
  { key:"PROTOCOLO",    label:"Protocolo",    prefix:"R" },
  { key:"INFORMACOES",  label:"Informações",  prefix:"F" },
  { key:"CERTIDOES",    label:"Certidões",    prefix:"C" },
];
const TYPE_MAP = Object.fromEntries(TICKET_TYPES.map(t => [t.key, t]));

// =====================
// Permissões (RBAC)
// =====================
const PERMS = [
  { key: "VIEW_TV", label: "Ver TV" },
  { key: "ISSUE_TICKET", label: "Gerar senha" },

  { key: "CALL_NEXT", label: "Chamar próxima (2N:1P)" },
  { key: "CALL_SPECIFIC", label: "Chamar específica" },
  { key: "FINISH_CANCEL", label: "Finalizar/Cancelar" },
  { key: "CONFIG_POLICY", label: "Configurar proporção (N por P)" },

  { key: "MANAGE_USERS", label: "Gerenciar usuários" },   // base RBAC (não tem UI completa aqui)
  { key: "RESET_PASSWORD", label: "Resetar senha" },      // base RBAC (não tem UI completa aqui)
  { key: "MANAGE_ROLES", label: "Gerenciar perfis" },     // base RBAC (não tem UI completa aqui)
  { key: "VIEW_AUDIT", label: "Ver auditoria" },

  { key: "MANAGE_DESKS", label: "Gerenciar guichês" },
];

// =====================
// Audio + Voice
// =====================
function beep(times = 2, duration = 0.09, gap = 0.08) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let t = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.05;
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + duration);
      t += duration + gap;
    }
  } catch {}
}
function speakPT(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {}
}
function announceCall(call, settings) {
  if (!call) return;
  if (settings.soundOn) beep(2);
  if (settings.voiceOn) {
    const spoken = call.ticketCode.split("").join(" ");
    speakPT(`Senha ${spoken}. Dirigir-se ao ${deskLabel(call.desk)}.`);
  }
}

// =====================
// DB (localStorage)
// =====================
const STORAGE_KEY = "db_painel_senhas_rbac_desks";

function defaultDB() {
  const counters = Object.fromEntries(TICKET_TYPES.map(t => [t.key, 0]));

  const roles = [
    {
      id: "role_admin_master",
      name: "Admin Master",
      perms: PERMS.map(p => p.key),
      allowedTicketTypes: ["*"],
      requiresDesk: false,
    },
    {
      id: "role_atendente",
      name: "Atendente",
      perms: ["VIEW_TV", "CALL_NEXT", "CALL_SPECIFIC", "FINISH_CANCEL"],
      allowedTicketTypes: ["*"],
      requiresDesk: true,
    },
    {
      id: "role_user",
      name: "Usuário",
      perms: ["VIEW_TV", "ISSUE_TICKET"],
      allowedTicketTypes: ["*"],
      requiresDesk: false,
    },
    {
      id: "role_tc",
      name: "TC",
      perms: ["VIEW_TV", "ISSUE_TICKET"],
      allowedTicketTypes: ["CERTIDOES", "PROTOCOLO"],
      requiresDesk: false,
    },
  ];

  return {
    roles,
    users: [
      {
        id:"u_master",
        name:"Administrador",
        username:"admin",
        password:"admin123",
        roleId:"role_admin_master",
        blocked:false,
        extraPerms:[],
        revokedPerms:[],
        allowedTicketTypesOverride:null
      },
      {
        id:"u_att",
        name:"Atendente 1",
        username:"atendente",
        password:"1234",
        roleId:"role_atendente",
        blocked:false,
        extraPerms:[],
        revokedPerms:[],
        allowedTicketTypesOverride:null
      },
    ],
    desks: [
      { id:"G1", name:"Guichê 01" },
      { id:"G2", name:"Guichê 02" },
      { id:"G3", name:"Guichê 03" },
      { id:"G4", name:"Guichê 04" },
    ],
    deskSessions: { G1: null, G2: null, G3: null, G4: null },

    ticketCounters: counters,
    tickets: [],
    calls: [],
    currentCall: null,
    session: null, // {userId, username, name, roleId, roleName, deskId?}
    tvSettings: { soundOn:true, voiceOn:true },
    callPolicy: { normalPerPreferential: 2, normalSinceLastPreferential: 0 },
    audit: [],
  };
}

function loadDB() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const db = defaultDB();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    return db;
  }
  const db = JSON.parse(raw);

  db.roles = db.roles || defaultDB().roles;
  db.users = db.users || defaultDB().users;
  db.desks = db.desks || defaultDB().desks;
  db.deskSessions = db.deskSessions || { G1:null, G2:null, G3:null, G4:null };
  db.ticketCounters = db.ticketCounters || Object.fromEntries(TICKET_TYPES.map(t => [t.key, 0]));
  db.tvSettings = db.tvSettings || { soundOn:true, voiceOn:true };
  db.callPolicy = db.callPolicy || { normalPerPreferential:2, normalSinceLastPreferential:0 };
  db.audit = db.audit || [];

  db.users.forEach(u => {
    u.blocked = !!u.blocked;
    u.extraPerms = u.extraPerms || [];
    u.revokedPerms = u.revokedPerms || [];
    if (typeof u.allowedTicketTypesOverride === "undefined") u.allowedTicketTypesOverride = null;
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  return db;
}

let db = loadDB();
function saveDB(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }

function audit(action, meta = {}) {
  db.audit.unshift({ at: nowISO(), by: db.session?.username || "system", action, meta });
  db.audit = db.audit.slice(0, 250);
  saveDB();
}

// =====================
// RBAC helpers
// =====================
function getRole(roleId){ return db.roles.find(r => r.id === roleId) || null; }
function currentUser(){
  if (!db.session) return null;
  return db.users.find(u => u.id === db.session.userId) || null;
}
function effectivePermsForUser(user){
  const role = getRole(user.roleId);
  const base = new Set(role?.perms || []);
  (user.extraPerms||[]).forEach(p => base.add(p));
  (user.revokedPerms||[]).forEach(p => base.delete(p));
  return base;
}
function hasPerm(permKey){
  const u = currentUser();
  if (!u) return false;
  return effectivePermsForUser(u).has(permKey);
}
function allowedTicketTypesForUser(user){
  if (user.allowedTicketTypesOverride && user.allowedTicketTypesOverride.length) return user.allowedTicketTypesOverride;
  const role = getRole(user.roleId);
  return role?.allowedTicketTypes || ["*"];
}
function isTicketTypeAllowed(user, typeKey){
  const allowed = allowedTicketTypesForUser(user);
  return allowed.includes("*") || allowed.includes(typeKey);
}
function roleRequiresDesk(roleId){
  const r = getRole(roleId);
  return !!r?.requiresDesk;
}

// =====================
// Desk helpers
// =====================
function deskLabel(deskId){ return db.desks.find(d => d.id === deskId)?.name || "Guichê"; }
function deskOptionsHtml(){
  return db.desks.map(d => {
    const occ = db.deskSessions?.[d.id];
    const occUser = occ ? db.users.find(u => u.id === occ) : null;
    const suffix = occUser ? ` (ocupado: ${occUser.username})` : "";
    return `<option value="${d.id}">${d.name}${suffix}</option>`;
  }).join("");
}

// =====================
// Auth (com passo extra de guichê)
// =====================
function login(username, password) {
  const u = db.users.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (!u) return { ok:false, msg:"Usuário inválido" };
  if (u.blocked) return { ok:false, msg:"Usuário bloqueado" };
  if (u.password !== password) return { ok:false, msg:"Senha inválida" };

  const role = getRole(u.roleId);
  db.session = {
    userId: u.id,
    username: u.username,
    name: u.name,
    roleId: u.roleId,
    roleName: role?.name || "—",
    deskId: null
  };
  saveDB();
  audit("login", { username: u.username, role: role?.name });

  if (roleRequiresDesk(u.roleId)) return { ok:true, needsDesk:true };
  return { ok:true, needsDesk:false };
}

function logout() {
  if (db.session?.deskId) {
    const deskId = db.session.deskId;
    if (db.deskSessions?.[deskId] === db.session.userId) {
      db.deskSessions[deskId] = null;
    }
  }
  audit("logout");
  db.session = null;
  saveDB();
  showOnly("login");
}

function confirmDeskForSession(deskId) {
  const user = currentUser();
  if (!user) return { ok:false, msg:"Sem sessão" };

  if (!roleRequiresDesk(user.roleId)) {
    db.session.deskId = null;
    saveDB();
    return { ok:true };
  }

  const occupiedBy = db.deskSessions?.[deskId];
  if (occupiedBy && occupiedBy !== user.id) {
    return { ok:false, msg:"Guichê ocupado" };
  }

  if (db.session.deskId && db.deskSessions[db.session.deskId] === user.id) {
    db.deskSessions[db.session.deskId] = null;
  }

  db.deskSessions[deskId] = user.id;
  db.session.deskId = deskId;
  saveDB();
  audit("desk_login", { deskId });
  return { ok:true };
}

// =====================
// Tickets / Atendimento
// =====================
function nextCode(typeKey){
  db.ticketCounters[typeKey] = (db.ticketCounters[typeKey] || 0) + 1;
  const n = String(db.ticketCounters[typeKey]).padStart(3,"0");
  const prefix = TYPE_MAP[typeKey]?.prefix || "X";
  saveDB();
  return `${prefix}${n}`;
}

function issueTicket(typeKey){
  const u = currentUser();
  if (!u) return { ok:false, msg:"Sem sessão" };
  if (!hasPerm("ISSUE_TICKET")) return { ok:false, msg:"Sem permissão" };
  if (!isTicketTypeAllowed(u, typeKey)) return { ok:false, msg:"Tipo não permitido" };

  const t = {
    id: crypto.randomUUID(),
    code: nextCode(typeKey),
    type: typeKey,
    userId: u.id,
    status: "WAITING",
    createdAt: nowISO(),
    calledAt: null,
    desk: null
  };
  db.tickets.unshift(t);
  saveDB();
  audit("issue_ticket", { code: t.code, type: typeKey });
  return { ok:true, ticket:t };
}

function waitingByType(typeKey){
  return db.tickets
    .filter(t => t.status === "WAITING" && t.type === typeKey)
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function pickNextTicket(){
  const k = db.callPolicy.normalPerPreferential;
  const wantsP = db.callPolicy.normalSinceLastPreferential >= k;
  const pref = waitingByType("PREFERENCIAL");
  const norm = waitingByType("NORMAL");
  if (!pref.length && !norm.length) return null;
  if (wantsP) return pref[0] || norm[0] || null;
  return norm[0] || pref[0] || null;
}

function callTicket(ticketCode, deskId){
  if (!hasPerm("CALL_SPECIFIC")) return { ok:false, msg:"Sem permissão" };

  const t = db.tickets.find(x => x.code === ticketCode);
  if (!t) return { ok:false, msg:"Senha não encontrada" };
  if (t.status !== "WAITING") return { ok:false, msg:"Senha não está aguardando" };

  t.status = "CALLED";
  t.calledAt = nowISO();
  t.desk = deskId;

  if (t.type === "PREFERENCIAL") db.callPolicy.normalSinceLastPreferential = 0;
  if (t.type === "NORMAL") db.callPolicy.normalSinceLastPreferential += 1;

  const call = { ticketCode: t.code, desk: deskId, at: t.calledAt };
  db.calls.unshift(call);
  db.currentCall = call;
  saveDB();
  audit("call_specific", { code: t.code, desk: deskId });

  return { ok:true, call };
}

function callNext(deskId){
  if (!hasPerm("CALL_NEXT")) return { ok:false, msg:"Sem permissão" };
  const t = pickNextTicket();
  if (!t) return { ok:false, msg:"Sem NORMAL/PREFERENCIAL aguardando" };

  t.status = "CALLED";
  t.calledAt = nowISO();
  t.desk = deskId;

  if (t.type === "PREFERENCIAL") db.callPolicy.normalSinceLastPreferential = 0;
  if (t.type === "NORMAL") db.callPolicy.normalSinceLastPreferential += 1;

  const call = { ticketCode: t.code, desk: deskId, at: t.calledAt };
  db.calls.unshift(call);
  db.currentCall = call;
  saveDB();
  audit("call_next", { code: t.code, desk: deskId });

  return { ok:true, call };
}

function recallCurrent(){
  if (!db.currentCall) return { ok:false, msg:"Sem chamada ativa" };
  if (!hasPerm("CALL_NEXT") && !hasPerm("CALL_SPECIFIC")) return { ok:false, msg:"Sem permissão" };

  const call = { ...db.currentCall, at: nowISO() };
  db.calls.unshift(call);
  db.currentCall = call;
  saveDB();
  audit("recall", { code: call.ticketCode });
  return { ok:true, call };
}

function finishCurrent(){
  if (!db.currentCall) return { ok:false, msg:"Sem chamada ativa" };
  if (!hasPerm("FINISH_CANCEL")) return { ok:false, msg:"Sem permissão" };

  const code = db.currentCall.ticketCode;
  const t = db.tickets.find(x => x.code === code);
  if (t) t.status = "DONE";
  db.currentCall = null;
  saveDB();
  audit("finish", { code });
  return { ok:true };
}

function cancelCurrent(){
  if (!db.currentCall) return { ok:false, msg:"Sem chamada ativa" };
  if (!hasPerm("FINISH_CANCEL")) return { ok:false, msg:"Sem permissão" };

  const code = db.currentCall.ticketCode;
  const t = db.tickets.find(x => x.code === code);
  if (t) t.status = "CANCELED";
  db.currentCall = null;
  saveDB();
  audit("cancel", { code });
  return { ok:true };
}

// =====================
// Nav visibility
// =====================
function applyNavVisibility(){
  const tvBtn = document.querySelector('[data-go="tv"]');
  const userBtn = document.querySelector('[data-go="user"]');
  const adminBtn = document.querySelector('[data-go="admin"]');

  tvBtn.disabled = !hasPerm("VIEW_TV");
  userBtn.disabled = !hasPerm("ISSUE_TICKET");

  const adminOk = hasPerm("CALL_NEXT") || hasPerm("CALL_SPECIFIC") || hasPerm("FINISH_CANCEL") ||
                  hasPerm("MANAGE_USERS") || hasPerm("RESET_PASSWORD") || hasPerm("MANAGE_ROLES") ||
                  hasPerm("VIEW_AUDIT") || hasPerm("CONFIG_POLICY") || hasPerm("MANAGE_DESKS");
  adminBtn.disabled = !adminOk;
}

// =====================
// Render: TV
// =====================
function renderTV(){
  db = loadDB();
  const cur = db.currentCall;

  const queue = TICKET_TYPES.map(t => {
    const n = db.tickets.filter(x => x.status === "WAITING" && x.type === t.key).length;
    return `<div class="item"><div>${t.label}</div><div class="badge">${n}</div></div>`;
  }).join("");

  const last = db.calls.slice(0, 8).map(c => `
    <div class="item">
      <div><strong>${c.ticketCode}</strong> <span class="badge">${deskLabel(c.desk)}</span></div>
      <div class="badge">${fmtTime(c.at)}</div>
    </div>
  `).join("");

  $("#screen-tv").innerHTML = `
    <div class="grid grid-3">
      <section class="card">
        <div class="hd"><h2>TV</h2><span class="badge">Ao vivo</span></div>
        <div class="bd">
          <div class="small">Chamada</div>
          <div class="big">${cur ? cur.ticketCode : "—"}</div>
          <div class="desk">${cur ? deskLabel(cur.desk) : "Aguardando"}</div>

          <div class="row" style="margin-top:12px">
            <label class="badge" style="display:flex;gap:8px;align-items:center;cursor:pointer; flex:0 0 auto">
              <input id="tvSound" type="checkbox" ${db.tvSettings.soundOn ? "checked":""}/> Som
            </label>
            <label class="badge" style="display:flex;gap:8px;align-items:center;cursor:pointer; flex:0 0 auto">
              <input id="tvVoice" type="checkbox" ${db.tvSettings.voiceOn ? "checked":""}/> Voz
            </label>
            <button id="tvTest" class="navbtn ghost" type="button" style="flex:1">Testar</button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="hd"><h2>Fila</h2></div>
        <div class="bd"><div class="list">${queue}</div></div>
      </section>

      <section class="card">
        <div class="hd"><h2>Últimas</h2></div>
        <div class="bd"><div class="list">${last || ""}</div></div>
      </section>
    </div>
  `;

  $("#tvSound").onchange = (e) => { db.tvSettings.soundOn = e.target.checked; saveDB(); };
  $("#tvVoice").onchange = (e) => { db.tvSettings.voiceOn = e.target.checked; saveDB(); };
  $("#tvTest").onclick = () => announceCall({ ticketCode:"P001", desk:"G2", at: nowISO() }, db.tvSettings);

  const prev = window.__lastCallKey;
  const key = cur ? `${cur.ticketCode}-${cur.desk}-${cur.at}` : "none";
  if (prev && prev !== key && cur) announceCall(cur, db.tvSettings);
  window.__lastCallKey = key;

  clearInterval(window.__tvInt);
  window.__tvInt = setInterval(() => {
    if (!$("#screen-tv").classList.contains("hidden")) renderTV();
  }, 1200);
}

// =====================
// Render: User
// =====================
function ticketTypeOptionsForUser(user){
  const role = getRole(user.roleId);
  const allowed = user.allowedTicketTypesOverride?.length ? user.allowedTicketTypesOverride : (role?.allowedTicketTypes || ["*"]);
  const types = allowed.includes("*") ? TICKET_TYPES : TICKET_TYPES.filter(t => allowed.includes(t.key));
  return types.map(t => `<option value="${t.key}">${t.label}</option>`).join("");
}

function renderUser(){
  db = loadDB();
  const u = currentUser();
  const opts = ticketTypeOptionsForUser(u);

  const mine = db.tickets
    .filter(t => t.userId === u.id)
    .slice(0, 10)
    .map(t => `
      <div class="item">
        <div><strong>${t.code}</strong> <span class="badge">${TYPE_MAP[t.type]?.label || t.type}</span></div>
        <div class="badge">${t.status}</div>
      </div>
    `).join("");

  $("#screen-user").innerHTML = `
    <div class="grid grid-2">
      <section class="card">
        <div class="hd"><h2>Retirar senha</h2><span class="badge">${u.username}</span></div>
        <div class="bd">
          <div class="field">
            <label>Tipo</label>
            <select id="userType">${opts}</select>
          </div>
          <button id="btnIssue" class="btn" type="button">Gerar senha</button>
          <div id="userMsg" class="msg hidden"></div>
        </div>
      </section>

      <section class="card">
        <div class="hd"><h2>Minhas senhas</h2></div>
        <div class="bd"><div class="list">${mine || ""}</div></div>
      </section>
    </div>
  `;

  $("#btnIssue").onclick = () => {
    const r = issueTicket($("#userType").value);
    const box = $("#userMsg");
    box.classList.remove("hidden");
    box.textContent = r.ok ? `Senha: ${r.ticket.code}` : r.msg;
    renderUser();
  };
}

// =====================
// Render: Admin
// =====================
function renderAdmin(){
  db = loadDB();
  const u = currentUser();
  const isMaster = u?.roleId === "role_admin_master";
  const isAtendente = u?.roleId === "role_atendente";

  const tabs = [];
  if (hasPerm("CALL_NEXT") || hasPerm("CALL_SPECIFIC") || hasPerm("FINISH_CANCEL") || hasPerm("CONFIG_POLICY")) {
    tabs.push({key:"atendimento", label:"Atendimento"});
  }
  if (isMaster && hasPerm("MANAGE_DESKS")) tabs.push({key:"guiches", label:"Guichês"});
  if (isMaster && hasPerm("VIEW_AUDIT")) tabs.push({key:"auditoria", label:"Auditoria"});

  const currentTab = window.__adminTab && tabs.some(t => t.key === window.__adminTab) ? window.__adminTab : tabs[0]?.key || "atendimento";

  $("#screen-admin").innerHTML = `
    <section class="card">
      <div class="hd"><h2>Admin</h2><span class="badge">${u.username}</span></div>
      <div class="bd">
        <div class="tabs">
          ${tabs.map(t => `<button class="tab ${t.key===currentTab?"active":""}" data-tab="${t.key}">${t.label}</button>`).join("")}
        </div>
        <div style="margin-top:14px" id="adminBody"></div>
      </div>
    </section>
  `;

  $("#screen-admin").querySelectorAll("[data-tab]").forEach(b => {
    b.onclick = () => { window.__adminTab = b.getAttribute("data-tab"); renderAdmin(); };
  });

  if (currentTab === "atendimento") renderAdminAtendimento(isMaster, isAtendente);
  if (currentTab === "guiches") renderAdminGuiches();
  if (currentTab === "auditoria") renderAdminAuditoria();
}

function renderAdminAtendimento(isMaster, isAtendente){
  db = loadDB();
  const cur = db.currentCall;

  const deskSelectHtml = isAtendente
    ? `<div class="badge">${deskLabel(db.session.deskId)}</div>`
    : `<select id="admDesk">${db.desks.map(d => `<option value="${d.id}">${d.name}</option>`).join("")}</select>`;

  const ratioHtml = (hasPerm("CONFIG_POLICY") && isMaster)
    ? `
      <div class="field">
        <label>Proporção (N por P)</label>
        <select id="admRatio">
          <option value="1" ${db.callPolicy.normalPerPreferential===1?"selected":""}>1</option>
          <option value="2" ${db.callPolicy.normalPerPreferential===2?"selected":""}>2</option>
          <option value="3" ${db.callPolicy.normalPerPreferential===3?"selected":""}>3</option>
          <option value="4" ${db.callPolicy.normalPerPreferential===4?"selected":""}>4</option>
        </select>
      </div>
    ` : "";

  $("#adminBody").innerHTML = `
    <div class="grid grid-2">
      <div>
        <div class="field">
          <label>Guichê</label>
          ${deskSelectHtml}
        </div>

        ${ratioHtml}

        <div class="row">
          <button id="admNext" class="navbtn" type="button" ${hasPerm("CALL_NEXT")?"":"disabled"}>Chamar próxima</button>
          <button id="admRecall" class="navbtn ghost" type="button" ${(hasPerm("CALL_NEXT")||hasPerm("CALL_SPECIFIC"))?"":"disabled"}>Rechamar</button>
        </div>

        <div class="row" style="margin-top:10px">
          <button id="admDone" class="navbtn" type="button" ${hasPerm("FINISH_CANCEL") && cur ? "" : "disabled"}>Finalizar</button>
          <button id="admCancel" class="navbtn" type="button" ${hasPerm("FINISH_CANCEL") && cur ? "" : "disabled"}>Cancelar</button>
        </div>

        <div class="field" style="margin-top:12px">
          <label>Chamar específica</label>
          <div class="row" style="width:100%">
            <input id="admCallCode" placeholder="ex: P001"/>
            <button id="admCallBtn" class="navbtn" type="button" ${hasPerm("CALL_SPECIFIC")?"":"disabled"}>Chamar</button>
          </div>
        </div>

        <div id="admMsg" class="msg hidden"></div>
      </div>

      <div>
        <div class="small">Chamada</div>
        <div class="big" style="font-size:52px">${cur ? cur.ticketCode : "—"}</div>
        <div class="desk">${cur ? deskLabel(cur.desk) : "Aguardando"}</div>
      </div>
    </div>
  `;

  const msg = (t) => { $("#admMsg").classList.remove("hidden"); $("#admMsg").textContent = t; };

  const desk = () => {
    if (isAtendente) return db.session.deskId;
    return $("#admDesk").value;
  };

  const ratio = $("#admRatio");
  if (ratio) {
    ratio.onchange = (e) => {
      db.callPolicy.normalPerPreferential = Number(e.target.value);
      saveDB();
      audit("set_policy_ratio", { value: db.callPolicy.normalPerPreferential });
    };
  }

  $("#admNext").onclick = () => {
    const r = callNext(desk());
    msg(r.ok ? `Chamando ${r.call.ticketCode}` : r.msg);
    renderAdmin();
  };
  $("#admRecall").onclick = () => {
    const r = recallCurrent();
    msg(r.ok ? `Rechamada ${r.call.ticketCode}` : r.msg);
    renderAdmin();
  };
  $("#admDone").onclick = () => {
    const r = finishCurrent();
    msg(r.ok ? "Finalizado" : r.msg);
    renderAdmin();
  };
  $("#admCancel").onclick = () => {
    const r = cancelCurrent();
    msg(r.ok ? "Cancelado" : r.msg);
    renderAdmin();
  };
  $("#admCallBtn").onclick = () => {
    const code = $("#admCallCode").value.trim().toUpperCase();
    const r = callTicket(code, desk());
    msg(r.ok ? `Chamando ${r.call.ticketCode}` : r.msg);
    renderAdmin();
  };
}

function renderAdminGuiches(){
  db = loadDB();

  const items = db.desks.map(d => {
    const occId = db.deskSessions?.[d.id];
    const occUser = occId ? db.users.find(u => u.id === occId) : null;
    return `
      <div class="item">
        <div>
          <strong>${d.name}</strong>
          <span class="badge">${occUser ? occUser.username : "livre"}</span>
        </div>
        <div class="row" style="flex:0 0 auto">
          <button class="navbtn ghost" data-clear="${d.id}" type="button" ${occUser ? "" : "disabled"}>Liberar</button>
        </div>
      </div>
    `;
  }).join("");

  $("#adminBody").innerHTML = `
    <div class="list">${items}</div>
    <div class="msg" style="margin-top:12px">
      “Liberar” remove a ocupação do guichê (útil se o atendente fechou o navegador e ficou preso).
    </div>
  `;

  $("#screen-admin").querySelectorAll("[data-clear]").forEach(btn => {
    btn.onclick = () => {
      const deskId = btn.getAttribute("data-clear");
      db.deskSessions[deskId] = null;
      saveDB();
      audit("clear_desk", { deskId });
      renderAdmin();
    };
  });
}

function renderAdminAuditoria(){
  db = loadDB();
  const items = db.audit.slice(0, 25).map(a => `
    <div class="item">
      <div><strong>${a.action}</strong> <span class="badge">${a.by}</span></div>
      <span class="badge">${fmtTime(a.at)}</span>
    </div>
  `).join("");
  $("#adminBody").innerHTML = `<div class="list">${items || ""}</div>`;
}

// =====================
// Cadastro simples (cria Usuário)
// =====================
function userExists(username){
  return db.users.some(u => u.username.toLowerCase() === username.toLowerCase());
}
function registerSelf(){
  const name = $("#regName").value.trim();
  const username = $("#regUsername").value.trim();
  const password = $("#regPassword").value.trim();

  const box = $("#regMsg");
  box.classList.remove("hidden");

  if (!name || !username || !password) { box.textContent = "Preencha todos os campos"; return; }
  if (userExists(username)) { box.textContent = "Usuário já existe"; return; }

  db.users.push({
    id: crypto.randomUUID(),
    name, username, password,
    roleId: "role_user",
    blocked:false, extraPerms:[], revokedPerms:[], allowedTicketTypesOverride:null
  });
  saveDB();
  audit("self_register", { username });

  box.textContent = "Conta criada";
  showOnly("login");
  $("#loginUsername").value = username;
  $("#loginPassword").value = "";
}

// =====================
// Tela de escolher guichê
// =====================
function renderDeskChooser(){
  db = loadDB();
  $("#deskSelect").innerHTML = deskOptionsHtml();
  $("#deskMsg").classList.add("hidden");
  showOnly("desk");

  $("#btnDeskConfirm").onclick = () => {
    const deskId = $("#deskSelect").value;
    const r = confirmDeskForSession(deskId);
    if (!r.ok) {
      $("#deskMsg").classList.remove("hidden");
      $("#deskMsg").textContent = r.msg;
      return;
    }
    showOnly("admin");
    renderAdmin();
  };

  $("#btnDeskLogout").onclick = () => logout();
}

// =====================
// Nav binds + Boot
// =====================
function bindNav(){
  document.querySelectorAll("[data-go]").forEach(btn => {
    btn.onclick = () => {
      if (!db.session) return;

      const to = btn.getAttribute("data-go");
      if (to === "tv") { if (!hasPerm("VIEW_TV")) return; showOnly("tv"); return renderTV(); }
      if (to === "user") { if (!hasPerm("ISSUE_TICKET")) return; showOnly("user"); return renderUser(); }
      if (to === "admin") {
        if (roleRequiresDesk(db.session.roleId) && !db.session.deskId) return renderDeskChooser();
        showOnly("admin"); return renderAdmin();
      }
    };
  });
  $("#btnLogout").onclick = () => logout();

  // TV rápida (sem sessão)
  $("#btnGoTVQuick").onclick = () => {
    // Permite abrir a TV sem login. (Útil para monitor)
    // Obs: sem session => topbar fica oculto.
    showOnly("tv");
    renderTV();
  };

  // reset local
  $("#btnResetLocal").onclick = () => {
    if (!confirm("Isso vai apagar os dados locais (localStorage). Continuar?")) return;
    localStorage.removeItem(STORAGE_KEY);
    db = loadDB();
    window.__lastCallKey = null;
    window.__adminTab = null;
    showOnly("login");
  };
}

function boot(){
  bindNav();

  $("#btnLogin").onclick = () => {
    db = loadDB();
    const u = $("#loginUsername").value.trim();
    const p = $("#loginPassword").value.trim();

    const res = login(u, p);
    const box = $("#loginMsg");

    if (!res.ok) {
      box.classList.remove("hidden");
      box.textContent = res.msg;
      return;
    }
    box.classList.add("hidden");

    if (res.needsDesk) return renderDeskChooser();

    const isOps = hasPerm("CALL_NEXT") || hasPerm("CALL_SPECIFIC") || hasPerm("FINISH_CANCEL") || hasPerm("MANAGE_DESKS");
    if (isOps) { showOnly("admin"); renderAdmin(); }
    else { showOnly("user"); renderUser(); }
  };

  $("#btnGoRegister").onclick = () => showOnly("register");
  $("#btnBackLogin").onclick = () => showOnly("login");
  $("#btnRegister").onclick = () => registerSelf();

  // restore
  if (db.session) {
    if (roleRequiresDesk(db.session.roleId) && !db.session.deskId) {
      return renderDeskChooser();
    }
    if (db.session.deskId && db.deskSessions?.[db.session.deskId] && db.deskSessions[db.session.deskId] !== db.session.userId) {
      db.session.deskId = null;
      saveDB();
      return renderDeskChooser();
    }

    const isOps = hasPerm("CALL_NEXT") || hasPerm("CALL_SPECIFIC") || hasPerm("FINISH_CANCEL") || hasPerm("MANAGE_DESKS");
    if (isOps) { showOnly("admin"); renderAdmin(); }
    else { showOnly("user"); renderUser(); }
  } else {
    showOnly("login");
  }
}

boot();
