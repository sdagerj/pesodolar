#!/usr/bin/env node
/** Sonda enfocada: ver la forma exacta de los dos datasets que sí sirven. */

async function jget(url, ms = 25000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} — ${txt.slice(0,150)}`);
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}
const R = "https://www.datos.gov.co/resource/";
const q = o => Object.entries(o).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/* ── TIBC: interés bancario corriente (base legal de la usura) ─────── */
console.log("═══ pare-7x5i · Tasa de Interés Bancario Corriente ═══\n");
try {
  const mods = await jget(R + "pare-7x5i.json?" + q({
    "$select": "modalidad, count(*) AS n, max(vigencia_desde) AS ultima",
    "$group": "modalidad", "$order": "n DESC",
  }));
  console.log("Modalidades disponibles:");
  mods.forEach(m => console.log(`   ${String(m.n).padStart(4)} registros · última ${String(m.ultima).slice(0,10)} · ${m.modalidad}`));
} catch (e) { console.log("  fallo agrupando:", e.message); }

try {
  const ult = await jget(R + "pare-7x5i.json?" + q({
    "$order": "vigencia_desde DESC", "$limit": "8",
  }));
  console.log("\nÚltimos 8 registros (cualquier modalidad):");
  ult.forEach(r => console.log(`   ${String(r.vigencia_desde).slice(0,10)} → ${String(r.vigencia_hasta).slice(0,10)}  `
    + `${String(r.interes_bancario_corriente).padStart(8)}  ${r.modalidad}`));
} catch (e) { console.log("  fallo:", e.message); }

/* ── Captación: de aquí sale el promedio de CDT ─────────────────────── */
console.log("\n\n═══ axk9-g2nh · Tasas de captación / mercado monetario ═══\n");
try {
  const u = await jget(R + "axk9-g2nh.json?" + q({
    "$select": "nombre_unidad_de_captura, count(*) AS n, max(fechacorte) AS ultima",
    "$group": "nombre_unidad_de_captura", "$order": "n DESC", "$limit": "15",
  }));
  console.log("Unidades de captura:");
  u.forEach(x => console.log(`   ${String(x.n).padStart(6)} · última ${String(x.ultima).slice(0,10)} · ${x.nombre_unidad_de_captura}`));
} catch (e) { console.log("  fallo:", e.message); }

try {
  const f = await jget(R + "axk9-g2nh.json?" + q({ "$select":"max(fechacorte) AS f" }));
  const ultima = String(f[0].f).slice(0,10);
  console.log(`\nÚltima fecha de corte: ${ultima}`);

  const desc = await jget(R + "axk9-g2nh.json?" + q({
    "$select": "descripcion, count(*) AS n, sum(monto) AS monto",
    "$where": `fechacorte='${ultima}T00:00:00.000'`,
    "$group": "descripcion", "$order": "monto DESC", "$limit": "14",
  }));
  console.log("\nDescripciones en esa fecha (por monto):");
  desc.forEach(d => console.log(`   ${String(d.n).padStart(4)} · ${Number(d.monto||0).toExponential(3).padStart(11)} · ${d.descripcion}`));

  // Promedio ponderado de CDT a 90 días, que es lo que mide la DTF
  const cdt = await jget(R + "axk9-g2nh.json?" + q({
    "$where": `fechacorte='${ultima}T00:00:00.000' AND monto > 0 AND upper(descripcion) like '%90%'`,
    "$select": "descripcion, tasa, monto", "$limit": "400",
  }));
  console.log(`\nRegistros que mencionan 90 (días): ${cdt.length}`);
  if (cdt.length) {
    let sm = 0, sp = 0;
    cdt.forEach(r => { const t = parseFloat(r.tasa), m = parseFloat(r.monto);
                       if (isFinite(t) && isFinite(m) && m > 0) { sm += m; sp += t*m; } });
    console.log(`   promedio ponderado por monto = ${(sp/sm).toFixed(4)}`);
    console.log(`   ejemplos: ${cdt.slice(0,3).map(r => `${r.descripcion}=${r.tasa}`).join(" | ")}`);
  }
} catch (e) { console.log("  fallo:", e.message); }
