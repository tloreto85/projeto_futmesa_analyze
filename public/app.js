"use strict";

const MODEL = {
  version: "2.0",
  angleMin: 17,
  angleMax: 28,
  angleStep: 0.5,
  heightMin: 3.7,
  heightMax: 4.8,
  heightStep: 0.1,
  distanceMin: 20,
  distanceMax: 35,
  weightAngle: 0.5,
  weightHeight: 0.3,
  rasteiroLimit: 0.36,
  retoLimit: 0.58,
  excessLimit: 0.82,
  scoreWidth: 0.35,
  // IE-alvo(d) = base[chute] + slope × (refDistance − d): mais perto do gol, mais elevação.
  target: {
    refDistance: 27.5,
    slope: 0.012,
    base: { Reto: 0.50, Arqueado: 0.68 }
  },
  shotTypes: ["Reto", "Arqueado"],
  // Posições em % da imagem (1191×792). Recalibre aqui se trocar a imagem do campo.
  field: { image: "campo_zonas.png", width: 1191, height: 792, top: 10.9, bottom: 93.8 },
  zones: [
    { id: "orange_blue", name: "Laranja-Azul", label: "20–25 cm", min: 20, max: 25, lines: "Entre as linhas azul e laranja.", left: 18.64, right: 29.64, rgb: "47, 111, 237" },
    { id: "yellow_orange", name: "Amarela-Laranja", label: "25–30 cm", min: 25, max: 30, lines: "Entre as linhas laranja e amarela.", left: 29.64, right: 40.30, rgb: "255, 149, 0" },
    { id: "red_yellow", name: "Vermelha-Amarela", label: "30–35 cm", min: 30, max: 35, lines: "Entre as linhas amarela e vermelha.", left: 40.30, right: 50.38, rgb: "235, 46, 46" }
  ]
};
MODEL.zones.forEach(z => { z.distance = (z.min + z.max) / 2; });

const RESULT_TYPES = [
  { id: "gol", label: "Gol" },
  { id: "trave", label: "Trave" },
  { id: "fora", label: "Fora" },
  { id: "alto", label: "Alto" },
  { id: "baixo", label: "Baixo" }
];

const STORAGE_KEY = "futebolBotaoWebAppV1";
const SCHEMA_VERSION = 2;

/* ---------- Utilidades ---------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function fmt(n, digits = 1) {
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtAngle(a) {
  return `${fmt(a, Number.isInteger(a) ? 0 : 1)}°`;
}

function fmtHeight(h) {
  return `${fmt(h, 1)} mm`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);
}

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function nonNegInt(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function zoneById(id) {
  return MODEL.zones.find(z => z.id === id) || null;
}

function zoneFromDistance(distance) {
  if (!(distance >= MODEL.distanceMin && distance <= MODEL.distanceMax)) return null;
  return MODEL.zones.find(z => distance >= z.min && (distance < z.max || z.max === MODEL.distanceMax)) || null;
}

let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Modelo ---------- */

function normalizeAngle(angle) {
  return (angle - MODEL.angleMin) / (MODEL.angleMax - MODEL.angleMin);
}

function normalizeHeight(height) {
  return (MODEL.heightMax - height) / (MODEL.heightMax - MODEL.heightMin);
}

// O IE descreve só o botão; a distância entra apenas no IE-alvo.
function calculateIE(angle, height) {
  const weights = MODEL.weightAngle + MODEL.weightHeight;
  return (MODEL.weightAngle * normalizeAngle(angle) + MODEL.weightHeight * normalizeHeight(height)) / weights;
}

function targetIE(distance, shotType) {
  const base = MODEL.target.base[shotType] ?? MODEL.target.base.Reto;
  return base + MODEL.target.slope * (MODEL.target.refDistance - distance);
}

function classifyTrajectory(ie) {
  if (ie < MODEL.rasteiroLimit) return "Rasteiro";
  if (ie < MODEL.retoLimit) return "Reto";
  return "Arqueado";
}

function naturalShot(trajectory) {
  return trajectory === "Arqueado" ? "Arqueado" : "Reto";
}

function calculateScore(ie, target) {
  return clamp(100 * (1 - Math.abs(ie - target) / MODEL.scoreWidth), 0, 100);
}

function quality(score) {
  if (score >= 95) return "Excelente";
  if (score >= 90) return "Muito boa";
  if (score >= 80) return "Boa";
  if (score >= 70) return "Utilizável";
  return "Baixa aderência";
}

function evaluate(angle, height, distance, shotType) {
  const ie = calculateIE(angle, height);
  const trajectory = classifyTrajectory(ie);
  const shot = shotType || naturalShot(trajectory);
  const target = targetIE(distance, shot);
  const score = calculateScore(ie, target);
  return {
    angle, height, distance, ie, trajectory, shot, target, score,
    quality: quality(score),
    alert: ie >= MODEL.excessLimit ? "Elevação excessiva / risco de passar alto" : ""
  };
}

function evaluateZone(angle, height, zone, shotType) {
  return { ...evaluate(angle, height, zone.distance, shotType), zoneId: zone.id, zoneName: zone.name, label: zone.label };
}

function validateConfig(angle, height) {
  if (!(angle >= MODEL.angleMin && angle <= MODEL.angleMax)) {
    throw new Error(`Ângulo deve estar entre ${MODEL.angleMin}° e ${MODEL.angleMax}°.`);
  }
  if (Math.abs(angle / MODEL.angleStep - Math.round(angle / MODEL.angleStep)) > 1e-9) {
    throw new Error(`Ângulo deve variar de ${fmt(MODEL.angleStep, 1)} em ${fmt(MODEL.angleStep, 1)} grau.`);
  }
  if (!(height >= MODEL.heightMin && height <= MODEL.heightMax)) {
    throw new Error(`Altura deve estar entre ${fmt(MODEL.heightMin)} e ${fmt(MODEL.heightMax)} mm.`);
  }
}

function angleGrid() {
  const list = [];
  for (let a = MODEL.angleMin; a <= MODEL.angleMax + 1e-9; a += MODEL.angleStep) list.push(+a.toFixed(1));
  return list;
}

function heightGrid() {
  const list = [];
  for (let h = MODEL.heightMin; h <= MODEL.heightMax + 1e-9; h += MODEL.heightStep) list.push(+h.toFixed(1));
  return list;
}

function getTheoreticalRecommendations(zone, shotType, limit = 5) {
  const candidates = [];
  for (const angle of angleGrid()) {
    for (const height of heightGrid()) {
      const r = evaluateZone(angle, height, zone, shotType);
      if (r.trajectory === shotType) candidates.push(r);
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const c of candidates) {
    const tooClose = selected.some(s => Math.abs(c.angle - s.angle) < 2 && Math.abs(c.height - s.height) < 0.2);
    if (!tooClose) selected.push(c);
    if (selected.length >= limit) break;
  }
  return selected;
}

function scoreColor(score, alpha = 1) {
  const hue = 120 * clamp(score, 0, 100) / 100;
  return `hsla(${hue}, 70%, 38%, ${alpha})`;
}

function pillClass(score) {
  if (score >= 90) return "good";
  if (score >= 70) return "warn";
  return "low";
}

function scoreCell(score) {
  return `<strong>${fmt(score)}%</strong>
    <div class="scorebar" aria-hidden="true"><span style="width:${score}%;background:${scoreColor(score)}"></span></div>`;
}

/* ---------- Estado ---------- */

function defaultState() {
  return { version: SCHEMA_VERSION, profile: { shotType: "", zones: [] }, buttons: [], tests: [] };
}

function isValidButton(b) {
  return b && typeof b === "object" && b.id && b.name &&
    Number.isFinite(Number(b.angle)) && Number.isFinite(Number(b.height));
}

function normalizeTest(t) {
  if (!t || typeof t !== "object") return null;
  const distance = Number(t.distance);
  if (!Number.isFinite(distance) || !t.buttonId) return null;
  let counts;
  let unclassified = 0;
  if (t.counts && typeof t.counts === "object") {
    counts = Object.fromEntries(RESULT_TYPES.map(r => [r.id, nonNegInt(t.counts[r.id])]));
    unclassified = nonNegInt(t.unclassified);
  } else {
    // Testes da v1 tinham só tentativas e acertos; o restante fica como "não classificado".
    const attempts = nonNegInt(t.attempts);
    const hits = Math.min(nonNegInt(t.hits), attempts);
    counts = Object.fromEntries(RESULT_TYPES.map(r => [r.id, 0]));
    counts.gol = hits;
    unclassified = attempts - hits;
  }
  return {
    id: String(t.id || uid()),
    createdAt: t.createdAt || new Date().toISOString(),
    buttonId: String(t.buttonId),
    buttonName: String(t.buttonName || ""),
    angle: Number(t.angle),
    height: Number(t.height),
    distance,
    zoneId: zoneFromDistance(distance)?.id || t.zoneId || "",
    shotType: MODEL.shotTypes.includes(t.shotType) ? t.shotType : "Reto",
    counts,
    unclassified
  };
}

function normalizeState(parsed) {
  const base = defaultState();
  if (!parsed || typeof parsed !== "object") return base;
  const profile = parsed.profile && typeof parsed.profile === "object" ? parsed.profile : base.profile;
  return {
    version: SCHEMA_VERSION,
    profile: {
      shotType: MODEL.shotTypes.includes(profile.shotType) ? profile.shotType : "",
      zones: Array.isArray(profile.zones) ? profile.zones.filter(zoneById) : []
    },
    buttons: Array.isArray(parsed.buttons)
      ? parsed.buttons.filter(isValidButton).map(b => ({
          id: String(b.id),
          name: String(b.name).slice(0, 40),
          angle: Number(b.angle),
          height: Number(b.height),
          createdAt: b.createdAt || new Date().toISOString()
        }))
      : [],
    tests: Array.isArray(parsed.tests) ? parsed.tests.map(normalizeTest).filter(Boolean) : []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast("Não foi possível salvar no navegador. Exporte um backup.");
  }
}

function replaceState(next) {
  Object.assign(state, next);
  saveState();
}

const state = loadState();

function testAttempts(t) {
  return RESULT_TYPES.reduce((s, r) => s + t.counts[r.id], 0) + t.unclassified;
}

function testTheoretical(t) {
  return evaluate(t.angle, t.height, t.distance, t.shotType);
}

/* ---------- Campo ---------- */

function mountFieldMaps() {
  const f = MODEL.field;
  document.querySelectorAll("[data-field-map]").forEach(map => {
    const isHeatmap = map.dataset.fieldMap === "heatmap";
    const alt = map.dataset.alt || "Campo de futebol de botão com as zonas de chute";
    map.innerHTML = `<img src="${f.image}" alt="${escapeHtml(alt)}" width="${f.width}" height="${f.height}" />` +
      MODEL.zones.map(z => `
        <div class="zone-overlay${isHeatmap ? " score-overlay" : ""}" data-zone-overlay="${z.id}"
          style="left:${z.left}%;width:${z.right - z.left}%;top:${f.top}%;height:${f.bottom - f.top}%;--zone-rgb:${z.rgb}">
          <span>${z.label}</span>
        </div>`).join("");
  });
}

function setFieldZones(mapName, zoneIds = [], options = {}) {
  const map = document.querySelector(`[data-field-map="${mapName}"]`);
  if (!map) return;
  const activeSet = new Set(zoneIds.filter(Boolean));
  const secondary = new Set(options.secondary || []);
  map.querySelectorAll("[data-zone-overlay]").forEach(el => {
    const id = el.dataset.zoneOverlay;
    el.classList.toggle("active", activeSet.has(id));
    el.classList.toggle("secondary-active", !activeSet.has(id) && secondary.has(id));
  });
}

function resetHeatmap() {
  const map = document.querySelector('[data-field-map="heatmap"]');
  if (!map) return;
  map.querySelectorAll("[data-zone-overlay]").forEach(el => {
    const zone = zoneById(el.dataset.zoneOverlay);
    el.classList.remove("active");
    el.style.background = "";
    el.innerHTML = `<span>${zone.label}</span>`;
  });
  document.getElementById("heatmap-result").innerHTML = "";
}

function renderHeatmap(results) {
  const map = document.querySelector('[data-field-map="heatmap"]');
  if (!map) return;
  const byId = Object.fromEntries(results.map(r => [r.zoneId, r]));
  map.querySelectorAll("[data-zone-overlay]").forEach(el => {
    const r = byId[el.dataset.zoneOverlay];
    if (!r) return;
    el.classList.add("active");
    el.style.background = scoreColor(r.score, 0.75);
    el.innerHTML = `<span>${r.label}<span class="field-score-label">${fmt(r.score, 0)}%</span></span>`;
  });
}

/* ---------- Navegação ---------- */

const VIEW_IDS = [...document.querySelectorAll(".view")].map(v => v.id);

function currentViewFromHash() {
  const id = location.hash.replace(/^#\/?/, "");
  return VIEW_IDS.includes(id) ? id : "dashboard";
}

function navigate(viewId) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === viewId));
  document.querySelectorAll(".nav-btn").forEach(link => {
    const active = link.dataset.view === viewId;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

window.addEventListener("hashchange", () => navigate(currentViewFromHash()));

/* ---------- Estrutura gerada a partir do MODEL ---------- */

function renderStaticFromModel() {
  document.getElementById("model-badge").textContent = `Modelo v${MODEL.version}`;
  const combos = angleGrid().length * heightGrid().length;
  document.getElementById("hero-title").textContent =
    `${MODEL.zones.length} zonas, ${combos} configurações de botão`;
  document.getElementById("hero-stats").innerHTML = `
    <div><strong>${MODEL.angleMin}°–${MODEL.angleMax}°</strong><span>Ângulo (passo ${fmt(MODEL.angleStep)}°)</span></div>
    <div><strong>${fmt(MODEL.heightMin)}–${fmt(MODEL.heightMax)} mm</strong><span>Altura</span></div>
    <div><strong>${MODEL.distanceMin}–${MODEL.distanceMax} cm</strong><span>Distância</span></div>`;

  document.getElementById("zone-cards").innerHTML = MODEL.zones.map(z => `
    <article class="card zone-card" style="--zone-rgb:${z.rgb}">
      <h3>${z.label}</h3>
      <p class="muted">${z.lines}</p>
      <dl>
        <div><dt>IE-alvo reto</dt><dd>${fmt(targetIE(z.distance, "Reto"), 2)}</dd></div>
        <div><dt>IE-alvo arqueado</dt><dd>${fmt(targetIE(z.distance, "Arqueado"), 2)}</dd></div>
      </dl>
    </article>`).join("");

  document.getElementById("profile-zone-checks").innerHTML = MODEL.zones.map(z =>
    `<label class="check"><input type="checkbox" name="profile-zone" value="${z.id}"> ${z.label}</label>`).join("");

  document.getElementById("test-counts").innerHTML = RESULT_TYPES.map(r => `
    <label>${r.label}
      <input type="number" min="0" step="1" value="0" inputmode="numeric" data-count="${r.id}" />
    </label>`).join("");

  document.querySelectorAll("[data-angle-input]").forEach(el => {
    el.min = MODEL.angleMin; el.max = MODEL.angleMax; el.step = MODEL.angleStep;
  });
  document.querySelectorAll("[data-height-input]").forEach(el => {
    el.min = MODEL.heightMin; el.max = MODEL.heightMax; el.step = MODEL.heightStep;
  });
  const distance = document.getElementById("test-distance");
  distance.min = MODEL.distanceMin;
  distance.max = MODEL.distanceMax;

  const zoneOptions = MODEL.zones.map(z => `<option value="${z.id}">${z.label} — ${z.name}</option>`).join("");
  document.querySelectorAll("[data-zone-select]").forEach(el => {
    el.innerHTML = (el.dataset.zoneSelect === "all" ? `<option value="">Todas</option>` : "") + zoneOptions;
  });
}

function renderButtonSelects() {
  const options = state.buttons.map(b =>
    `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)} — ${fmtAngle(b.angle)} / ${fmtHeight(b.height)}</option>`).join("");
  document.querySelectorAll("[data-button-select]").forEach(el => {
    const previous = el.value;
    const empty = el.dataset.buttonSelect === "all" ? `<option value="">Todos</option>` : `<option value="">Selecione</option>`;
    el.innerHTML = empty + options;
    if (state.buttons.some(b => b.id === previous)) el.value = previous;
  });
}

/* ---------- Visão geral ---------- */

function renderQuickEvaluation(angle, height, shotType) {
  validateConfig(angle, height);
  const results = MODEL.zones.map(z => evaluateZone(angle, height, z, shotType)).sort((a, b) => b.score - a.score);
  const first = results[0];
  document.getElementById("quick-eval-result").innerHTML = `
    <p class="result-summary">IE do botão: <strong>${fmt(first.ie, 3)}</strong> · trajetória natural <strong>${first.trajectory}</strong>
      · avaliado como chute <strong>${first.shot}</strong>${first.alert ? ` · <span class="pill low">${first.alert}</span>` : ""}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Zona</th><th>IE-alvo</th><th>Score</th><th>Qualidade</th></tr></thead>
      <tbody>${results.map((r, i) => `
        <tr>
          <td>${i === 0 ? '<span aria-label="Melhor zona">★</span> ' : ""}${r.label}</td>
          <td>${fmt(r.target, 2)}</td>
          <td>${scoreCell(r.score)}</td>
          <td><span class="pill ${pillClass(r.score)}">${r.quality}</span></td>
        </tr>`).join("")}
      </tbody>
    </table></div>`;

  const secondary = results.slice(1).filter(r => first.score - r.score <= 5).map(r => r.zoneId);
  setFieldZones("dashboard", [first.zoneId], { secondary });
  document.getElementById("dashboard-field-legend").innerHTML =
    `Melhor zona estimada: <strong>${first.label}</strong> — chute ${first.shot}, score <strong>${fmt(first.score)}%</strong>.` +
    (secondary.length ? ` Também próxima: ${secondary.map(id => zoneById(id).label).join(", ")}.` : "");
}

document.getElementById("quick-eval-form").addEventListener("submit", e => {
  e.preventDefault();
  try {
    renderQuickEvaluation(
      Number(document.getElementById("quick-angle").value),
      Number(document.getElementById("quick-height").value),
      document.getElementById("quick-shot").value
    );
  } catch (err) {
    toast(err.message);
  }
});

/* ---------- Perfil ---------- */

function updateProfileField() {
  const ids = [...document.querySelectorAll('input[name="profile-zone"]:checked')].map(cb => cb.value);
  setFieldZones("profile", ids);
}

function renderProfile() {
  document.getElementById("profile-shot").value = state.profile.shotType || "";
  document.querySelectorAll('input[name="profile-zone"]').forEach(cb => {
    cb.checked = state.profile.zones.includes(cb.value);
  });
  updateProfileField();
  renderProfileRecommendations();
}

function renderProfileRecommendations() {
  const host = document.getElementById("profile-recommendations");
  const { shotType, zones } = state.profile;
  if (!shotType || zones.length === 0) {
    host.innerHTML = `<div class="empty">Configure seu perfil para receber recomendações personalizadas.</div>`;
    return;
  }
  host.innerHTML = `<div class="compare-grid">${zones.map(zoneById).filter(Boolean).map(zone => {
    const recs = getTheoreticalRecommendations(zone, shotType, 3);
    const real = state.buttons
      .map(btn => ({ btn, r: evaluateZone(btn.angle, btn.height, zone, shotType) }))
      .filter(x => x.r.trajectory === shotType)
      .sort((a, b) => b.r.score - a.r.score)[0];
    return `
      <div class="compare-card">
        <h4>${zone.label} — ${zone.name}</h4>
        <p class="muted">Chute ${shotType} · IE-alvo ${fmt(targetIE(zone.distance, shotType), 2)}</p>
        <ol>${recs.map(r => `<li>${fmtAngle(r.angle)} / ${fmtHeight(r.height)} — ${fmt(r.score)}%</li>`).join("") || "<li>Nenhuma combinação compatível.</li>"}</ol>
        <p>${real
          ? `Melhor botão real: <strong>${escapeHtml(real.btn.name)}</strong> — ${fmt(real.r.score)}%`
          : "Nenhum botão real com essa trajetória cadastrado."}</p>
      </div>`;
  }).join("")}</div>`;
}

document.getElementById("profile-zone-checks").addEventListener("change", updateProfileField);

document.getElementById("profile-form").addEventListener("submit", e => {
  e.preventDefault();
  const shotType = document.getElementById("profile-shot").value;
  const zones = [...document.querySelectorAll('input[name="profile-zone"]:checked')].map(x => x.value);
  if (!shotType || zones.length === 0) return toast("Informe o chute preferido e ao menos uma zona.");
  state.profile = { shotType, zones };
  saveState();
  renderProfileRecommendations();
  toast("Perfil salvo.");
});

/* ---------- Botões ---------- */

let editingButtonId = null;

function setEditingButton(btn) {
  editingButtonId = btn ? btn.id : null;
  document.getElementById("button-form-title").textContent = btn ? `Editando: ${btn.name}` : "Novo botão";
  document.getElementById("button-submit").textContent = btn ? "Salvar alterações" : "Cadastrar";
  document.getElementById("button-cancel").hidden = !btn;
  const form = document.getElementById("button-form");
  if (btn) {
    document.getElementById("button-name").value = btn.name;
    document.getElementById("button-angle").value = btn.angle;
    document.getElementById("button-height").value = btn.height;
    document.getElementById("button-name").focus();
  } else {
    form.reset();
  }
}

function renderButtons() {
  const host = document.getElementById("buttons-table");
  if (state.buttons.length === 0) {
    host.innerHTML = `<div class="empty">Nenhum botão cadastrado.</div>`;
  } else {
    host.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Ângulo</th><th>Altura</th><th>IE</th><th>Trajetória</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${state.buttons.map(btn => {
          const ie = calculateIE(btn.angle, btn.height);
          return `<tr>
            <td>${escapeHtml(btn.name)}</td>
            <td>${fmtAngle(btn.angle)}</td>
            <td>${fmtHeight(btn.height)}</td>
            <td>${fmt(ie, 3)}</td>
            <td>${classifyTrajectory(ie)}</td>
            <td class="actions">
              <button class="secondary" type="button" data-edit-button="${escapeHtml(btn.id)}">Editar</button>
              <button class="danger" type="button" data-delete-button="${escapeHtml(btn.id)}">Remover</button>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`;
  }
  renderButtonSelects();
  renderCompareSelector();
}

document.getElementById("buttons-table").addEventListener("click", e => {
  const editId = e.target.closest("[data-edit-button]")?.dataset.editButton;
  const deleteId = e.target.closest("[data-delete-button]")?.dataset.deleteButton;
  if (editId) {
    setEditingButton(state.buttons.find(b => b.id === editId));
    return;
  }
  if (!deleteId) return;
  const btn = state.buttons.find(b => b.id === deleteId);
  const testCount = state.tests.filter(t => t.buttonId === deleteId).length;
  const message = testCount
    ? `Remover "${btn.name}" e os ${testCount} teste(s) registrados com ele?`
    : `Remover "${btn.name}"?`;
  if (!confirm(message)) return;
  state.buttons = state.buttons.filter(b => b.id !== deleteId);
  state.tests = state.tests.filter(t => t.buttonId !== deleteId);
  if (editingButtonId === deleteId) setEditingButton(null);
  saveState();
  refreshAll();
  toast("Botão removido.");
});

document.getElementById("button-cancel").addEventListener("click", () => setEditingButton(null));

document.getElementById("button-form").addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("button-name").value.trim();
  const angle = Number(document.getElementById("button-angle").value);
  const height = Number(document.getElementById("button-height").value);
  try {
    if (!name) throw new Error("Informe um nome.");
    const duplicate = state.buttons.some(b => b.id !== editingButtonId && b.name.toLowerCase() === name.toLowerCase());
    if (duplicate) throw new Error("Já existe um botão com esse nome.");
    validateConfig(angle, height);
    if (editingButtonId) {
      const btn = state.buttons.find(b => b.id === editingButtonId);
      Object.assign(btn, { name, angle, height });
      state.tests.forEach(t => { if (t.buttonId === btn.id) t.buttonName = name; });
      toast("Botão atualizado. Testes antigos mantêm a configuração da época.");
    } else {
      state.buttons.push({ id: uid(), name, angle, height, createdAt: new Date().toISOString() });
      toast("Botão cadastrado.");
    }
    saveState();
    setEditingButton(null);
    refreshAll();
  } catch (err) {
    toast(err.message);
  }
});

function updateButtonsField() {
  const zone = zoneById(document.getElementById("real-best-zone").value);
  setFieldZones("buttons", zone ? [zone.id] : []);
  if (zone) document.getElementById("buttons-field-legend").innerHTML = `<strong>${zone.label}</strong> — ${zone.name}.`;
}

document.getElementById("real-best-zone").addEventListener("change", updateButtonsField);

document.getElementById("real-best-btn").addEventListener("click", () => {
  const zone = zoneById(document.getElementById("real-best-zone").value);
  const host = document.getElementById("real-best-result");
  if (!state.buttons.length) {
    host.innerHTML = `<div class="empty">Cadastre seus botões primeiro.</div>`;
    return;
  }
  const ranked = state.buttons
    .map(btn => ({ btn, r: evaluateZone(btn.angle, btn.height, zone) }))
    .sort((a, b) => b.r.score - a.r.score);
  host.innerHTML = `
    <p class="result-summary"><strong>Mais indicado:</strong> ${escapeHtml(ranked[0].btn.name)} — chute ${ranked[0].r.shot}, ${fmt(ranked[0].r.score)}%</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Rank</th><th>Botão</th><th>Trajetória</th><th>Score</th></tr></thead>
      <tbody>${ranked.map((x, i) => `<tr>
        <td>${i + 1}</td><td>${escapeHtml(x.btn.name)}</td><td>${x.r.trajectory}</td><td>${scoreCell(x.r.score)}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
});

/* ---------- Comparador ---------- */

function renderCompareSelector() {
  const host = document.getElementById("compare-selector");
  if (state.buttons.length < 2) {
    host.innerHTML = `<div class="empty">Cadastre ao menos dois botões.</div>`;
    return;
  }
  host.innerHTML = state.buttons.map(btn => `
    <label class="check"><input type="checkbox" name="compare-button" value="${escapeHtml(btn.id)}">
      ${escapeHtml(btn.name)} (${fmtAngle(btn.angle)} / ${fmtHeight(btn.height)})</label>`).join("");
}

document.getElementById("compare-btn").addEventListener("click", () => {
  const ids = [...document.querySelectorAll('input[name="compare-button"]:checked')].map(x => x.value);
  const selected = state.buttons.filter(b => ids.includes(b.id));
  const host = document.getElementById("compare-result");
  if (selected.length < 2) {
    host.innerHTML = `<div class="empty">Selecione ao menos dois botões.</div>`;
    return;
  }
  host.innerHTML = `<div class="compare-grid">${selected.map(btn => {
    const results = MODEL.zones.map(z => evaluateZone(btn.angle, btn.height, z));
    const best = results.reduce((a, b) => (b.score > a.score ? b : a));
    return `
      <div class="compare-card">
        <h4>${escapeHtml(btn.name)}</h4>
        <p class="muted">${fmtAngle(btn.angle)} / ${fmtHeight(btn.height)} · IE ${fmt(best.ie, 3)} · ${best.trajectory}</p>
        <p><strong>Melhor zona:</strong> ${best.label} — ${fmt(best.score)}%</p>
        ${results.map(r => `
          <div class="compare-row">
            <div><strong>${r.label}</strong> — ${fmt(r.score)}%</div>
            <div class="scorebar" aria-hidden="true"><span style="width:${r.score}%;background:${scoreColor(r.score)}"></span></div>
            <small class="muted">${r === best ? "Melhor zona" : `Perda vs. melhor: ${fmt(best.score - r.score)} pontos`}</small>
          </div>`).join("")}
      </div>`;
  }).join("")}</div>`;
});

/* ---------- Mapa de utilização ---------- */

document.getElementById("heatmap-button").addEventListener("change", resetHeatmap);

document.getElementById("heatmap-btn").addEventListener("click", () => {
  const btn = state.buttons.find(b => b.id === document.getElementById("heatmap-button").value);
  resetHeatmap();
  const host = document.getElementById("heatmap-result");
  if (!btn) {
    host.innerHTML = `<div class="empty">Selecione um botão.</div>`;
    return;
  }
  const results = MODEL.zones.map(z => evaluateZone(btn.angle, btn.height, z));
  renderHeatmap(results);
  host.innerHTML = `
    <h3>${escapeHtml(btn.name)} — ${fmtAngle(btn.angle)} / ${fmtHeight(btn.height)}</h3>
    <p class="muted">IE ${fmt(results[0].ie, 3)} · trajetória ${results[0].trajectory} · cada faixa é colorida pelo score do chute ${results[0].shot}.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Zona</th><th>IE-alvo</th><th>Score</th><th>Qualidade</th></tr></thead>
      <tbody>${results.map(r => `<tr>
        <td>${r.label}</td><td>${fmt(r.target, 2)}</td><td>${scoreCell(r.score)}</td>
        <td><span class="pill ${pillClass(r.score)}">${r.quality}</span></td>
      </tr>`).join("")}</tbody>
    </table></div>`;
});

/* ---------- Configurador ---------- */

function updateConfiguratorField() {
  const zone = zoneById(document.getElementById("inverse-zone").value);
  const shot = document.getElementById("inverse-shot").value;
  setFieldZones("configurator", zone ? [zone.id] : []);
  if (zone) {
    document.getElementById("config-field-legend").innerHTML =
      `<strong>${zone.label}</strong> — ${zone.name} · chute ${shot} · IE-alvo ${fmt(targetIE(zone.distance, shot), 2)}.`;
  }
}

document.getElementById("inverse-zone").addEventListener("change", updateConfiguratorField);
document.getElementById("inverse-shot").addEventListener("change", updateConfiguratorField);

document.getElementById("inverse-form").addEventListener("submit", e => {
  e.preventDefault();
  const zone = zoneById(document.getElementById("inverse-zone").value);
  const shot = document.getElementById("inverse-shot").value;
  const limit = clamp(Number(document.getElementById("inverse-limit").value) || 5, 1, 12);
  const recs = getTheoreticalRecommendations(zone, shot, limit);
  document.getElementById("inverse-result").innerHTML = recs.length ? `
    <h3>${zone.label} + chute ${shot}</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Rank</th><th>Ângulo</th><th>Altura</th><th>IE</th><th>Score</th><th>Qualidade</th></tr></thead>
      <tbody>${recs.map((r, i) => `<tr>
        <td>${i + 1}</td><td>${fmtAngle(r.angle)}</td><td>${fmtHeight(r.height)}</td><td>${fmt(r.ie, 3)}</td>
        <td>${scoreCell(r.score)}</td><td><span class="pill ${pillClass(r.score)}">${r.quality}</span></td>
      </tr>`).join("")}</tbody>
    </table></div>` : `<div class="empty">Nenhuma configuração compatível.</div>`;
});

/* ---------- Testes ---------- */

function readCounts() {
  return Object.fromEntries([...document.querySelectorAll("[data-count]")].map(el => [el.dataset.count, nonNegInt(el.value)]));
}

function updateAttemptsTotal() {
  const total = Object.values(readCounts()).reduce((s, n) => s + n, 0);
  document.getElementById("test-attempts-total").textContent = total;
}

function updateTestDistanceField() {
  const distance = Number(document.getElementById("test-distance").value);
  const zone = zoneFromDistance(distance);
  setFieldZones("tests", zone ? [zone.id] : []);
  const legend = document.getElementById("test-field-legend");
  legend.innerHTML = zone
    ? `<strong>${fmt(distance)} cm</strong> → zona <strong>${zone.label}</strong> (${zone.name}).`
    : `Informe uma distância entre ${MODEL.distanceMin} e ${MODEL.distanceMax} cm.`;
}

document.getElementById("test-counts").addEventListener("input", updateAttemptsTotal);
document.getElementById("test-distance").addEventListener("input", updateTestDistanceField);

document.getElementById("test-form").addEventListener("submit", e => {
  e.preventDefault();
  const btn = state.buttons.find(b => b.id === document.getElementById("test-button").value);
  if (!btn) return toast("Selecione um botão cadastrado.");
  const distance = Number(document.getElementById("test-distance").value);
  const zone = zoneFromDistance(distance);
  if (!zone) return toast(`A distância deve estar entre ${MODEL.distanceMin} e ${MODEL.distanceMax} cm.`);
  const counts = readCounts();
  if (Object.values(counts).reduce((s, n) => s + n, 0) === 0) return toast("Informe ao menos uma tentativa.");

  state.tests.push({
    id: uid(),
    createdAt: new Date().toISOString(),
    buttonId: btn.id,
    buttonName: btn.name,
    angle: btn.angle,
    height: btn.height,
    distance,
    zoneId: zone.id,
    shotType: document.getElementById("test-shot").value,
    counts,
    unclassified: 0
  });
  saveState();
  document.querySelectorAll("[data-count]").forEach(el => { el.value = 0; });
  updateAttemptsTotal();
  renderTests();
  toast("Teste registrado.");
});

function renderTests() {
  const host = document.getElementById("tests-table");
  if (!state.tests.length) {
    host.innerHTML = `<div class="empty">Nenhum teste registrado.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Data</th><th>Botão</th><th>Distância</th><th>Chute</th>
        ${RESULT_TYPES.map(r => `<th>${r.label}</th>`).join("")}
        <th>Total</th><th>Gols %</th><th>Teórico</th><th><span class="sr-only">Ações</span></th>
      </tr></thead>
      <tbody>${[...state.tests].reverse().map(t => {
        const attempts = testAttempts(t);
        return `<tr>
          <td>${new Date(t.createdAt).toLocaleDateString("pt-BR")}</td>
          <td>${escapeHtml(t.buttonName)}</td>
          <td>${fmt(t.distance)} cm</td>
          <td>${t.shotType}</td>
          ${RESULT_TYPES.map(r => `<td>${t.counts[r.id]}</td>`).join("")}
          <td>${attempts}${t.unclassified ? ` <small class="muted" title="Teste antigo: ${t.unclassified} erro(s) sem classificação">*</small>` : ""}</td>
          <td>${fmt(100 * t.counts.gol / attempts)}%</td>
          <td>${fmt(testTheoretical(t).score)}%</td>
          <td><button class="danger" type="button" data-delete-test="${escapeHtml(t.id)}">Excluir</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    ${state.tests.some(t => t.unclassified) ? `<p class="muted small">* Testes da versão anterior: os erros não foram separados por tipo.</p>` : ""}`;
}

document.getElementById("tests-table").addEventListener("click", e => {
  const id = e.target.closest("[data-delete-test]")?.dataset.deleteTest;
  if (!id || !confirm("Excluir este teste?")) return;
  state.tests = state.tests.filter(t => t.id !== id);
  saveState();
  renderTests();
  toast("Teste excluído.");
});

/* ---------- Score real ---------- */

function rankMap(items, key) {
  const sorted = [...items].sort((a, b) => b[key] - a[key]);
  return new Map(sorted.map((x, i) => [x.buttonId, i + 1]));
}

document.getElementById("eff-btn").addEventListener("click", () => {
  const buttonId = document.getElementById("eff-button").value;
  const zoneId = document.getElementById("eff-zone").value;
  const shot = document.getElementById("eff-shot").value;
  const filtered = state.tests.filter(t =>
    (!buttonId || t.buttonId === buttonId) && (!zoneId || t.zoneId === zoneId) && (!shot || t.shotType === shot));
  const host = document.getElementById("eff-result");
  if (!filtered.length) {
    host.innerHTML = `<div class="empty">Nenhum teste para esse filtro.</div>`;
    return;
  }

  const totals = Object.fromEntries(RESULT_TYPES.map(r => [r.id, 0]));
  let unclassified = 0;
  const groups = new Map();
  for (const t of filtered) {
    RESULT_TYPES.forEach(r => { totals[r.id] += t.counts[r.id]; });
    unclassified += t.unclassified;
    const attempts = testAttempts(t);
    const g = groups.get(t.buttonId) || { buttonId: t.buttonId, name: t.buttonName, attempts: 0, goals: 0, theoSum: 0 };
    g.attempts += attempts;
    g.goals += t.counts.gol;
    g.theoSum += testTheoretical(t).score * attempts;
    groups.set(t.buttonId, g);
  }
  const attempts = Object.values(totals).reduce((s, n) => s + n, 0) + unclassified;
  const rows = [...groups.values()].map(g => ({ ...g, real: 100 * g.goals / g.attempts, theo: g.theoSum / g.attempts }));
  const theoRank = rankMap(rows, "theo");
  const realRank = rankMap(rows, "real");
  rows.sort((a, b) => realRank.get(a.buttonId) - realRank.get(b.buttonId));

  const misses = ["trave", "fora", "alto", "baixo"].map(id => ({ id, label: RESULT_TYPES.find(r => r.id === id).label, n: totals[id] }));
  const classifiedMisses = misses.reduce((s, m) => s + m.n, 0);
  let tendency = "";
  if (totals.alto + totals.baixo >= 5) {
    if (totals.alto >= 2 * totals.baixo) tendency = "Os chutes tendem a passar <strong>alto</strong>: prefira botões com IE menor (menos ângulo ou mais altura).";
    else if (totals.baixo >= 2 * totals.alto) tendency = "Os chutes tendem a sair <strong>baixo</strong>: prefira botões com IE maior (mais ângulo ou menos altura).";
  }
  const agree = rows.length > 1 && rows.every(r => theoRank.get(r.buttonId) === realRank.get(r.buttonId));

  host.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><strong>${attempts}</strong><span>Tentativas</span></div>
      <div class="stat"><strong>${totals.gol}</strong><span>Gols</span></div>
      <div class="stat"><strong>${fmt(100 * totals.gol / attempts)}%</strong><span>Aproveitamento real</span></div>
      <div class="stat"><strong>${groups.size}</strong><span>Botões no filtro</span></div>
    </div>

    <h3 class="spaced">Distribuição dos erros</h3>
    ${classifiedMisses ? `<div class="miss-bars">${misses.map(m => `
      <div class="miss-row">
        <span>${m.label}</span>
        <div class="scorebar" aria-hidden="true"><span style="width:${100 * m.n / classifiedMisses}%;background:#66727f"></span></div>
        <span>${m.n}</span>
      </div>`).join("")}</div>` : `<p class="muted">Sem erros classificados neste filtro.</p>`}
    ${tendency ? `<p class="hint">${tendency}</p>` : ""}

    <h3 class="spaced">Ordem real × teórica</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Botão</th><th>Tentativas</th><th>Gols %</th><th>Score teórico</th><th>Rank real</th><th>Rank teórico</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${escapeHtml(r.name)}</td><td>${r.attempts}</td><td>${fmt(r.real)}%</td><td>${fmt(r.theo)}%</td>
        <td>${realRank.get(r.buttonId)}º</td>
        <td>${theoRank.get(r.buttonId)}º${theoRank.get(r.buttonId) !== realRank.get(r.buttonId) ? ' <span class="pill warn">diverge</span>' : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${rows.length > 1 ? `<p class="hint">${agree
      ? "A ordem real dos botões confirma a ordem prevista pelo modelo."
      : "A ordem real difere da prevista. Com mais tentativas, isso indica que o modelo precisa de recalibração para a sua mesa."}</p>` : ""}`;
});

/* ---------- Backup ---------- */

document.getElementById("export-json").addEventListener("click", () => {
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(`futebol-de-botao-${date}.json`, JSON.stringify(state, null, 2), "application/json");
});

function csvCell(v) {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

document.getElementById("export-csv").addEventListener("click", () => {
  if (!state.tests.length) return toast("Nenhum teste para exportar.");
  const header = ["data", "botao", "angulo", "altura_mm", "distancia_cm", "zona", "chute", ...RESULT_TYPES.map(r => r.id), "nao_classificado", "total", "score_teorico"];
  const lines = state.tests.map(t => [
    t.createdAt, t.buttonName, t.angle, t.height, t.distance, zoneById(t.zoneId)?.label || "", t.shotType,
    ...RESULT_TYPES.map(r => t.counts[r.id]), t.unclassified, testAttempts(t), testTheoretical(t).score.toFixed(1)
  ].map(csvCell).join(";"));
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(`testes-${date}.csv`, "\uFEFF" + [header.join(";"), ...lines].join("\n"), "text/csv;charset=utf-8");
});

document.getElementById("import-json").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const next = normalizeState(JSON.parse(await file.text()));
    const summary = `${next.buttons.length} botão(ões) e ${next.tests.length} teste(s)`;
    if (!confirm(`Substituir os dados atuais por ${summary}?`)) return;
    replaceState(next);
    setEditingButton(null);
    refreshAll();
    toast(`Backup importado: ${summary}.`);
  } catch {
    toast("Arquivo inválido. Use um backup exportado por este app.");
  }
});

document.getElementById("clear-all").addEventListener("click", () => {
  if (!confirm("Apagar perfil, botões e testes deste navegador? Essa ação não pode ser desfeita.")) return;
  replaceState(defaultState());
  setEditingButton(null);
  refreshAll();
  toast("Dados apagados.");
});

/* ---------- Inicialização ---------- */

function refreshAll() {
  renderProfile();
  renderButtons();
  renderTests();
  resetHeatmap();
  document.getElementById("real-best-result").innerHTML = "";
  document.getElementById("compare-result").innerHTML = "";
  document.getElementById("eff-result").innerHTML = "";
}

renderStaticFromModel();
mountFieldMaps();
navigate(currentViewFromHash());
updateButtonsField();
updateConfiguratorField();
updateTestDistanceField();
renderQuickEvaluation(23, 4.2, "");
refreshAll();
