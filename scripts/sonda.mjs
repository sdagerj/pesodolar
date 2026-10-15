#!/usr/bin/env node
/**
 * Sonda de descubrimiento. No escribe nada: solo averigua qué existe de
 * verdad y lo imprime, para corregir el script de actualización con hechos.
 *
 * Se corre desde GitHub Actions, que sí tiene salida a internet abierta.
 */

async function get(url, ms = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, txt };
  } catch (e) {
    return { ok: false, status: 0, txt: String(e.message || e) };
  } finally { clearTimeout(t); }
}

/* ── 1 · Catálogo de Datos Abiertos ────────────────────────────────── */
async function buscarCatalogo(q) {
  const url = "https://api.us.socrata.com/api/catalog/v1"
            + "?domains=datos.gov.co&search_context=datos.gov.co"
            + "&only=dataset&limit=12&q=" + encodeURIComponent(q);
  const r = await get(url);
  console.log(`\n── Buscando "${q}" en el catálogo`);
  if (!r.ok) { console.log(`   FALLÓ HTTP ${r.status}: ${r.txt.slice(0,160)}`); return []; }
  let d;
  try { d = JSON.parse(r.txt); } catch { console.log("   respuesta no es JSON"); return []; }
  const res = (d.results || []).map(x => ({
    id: x.resource?.id, nombre: x.resource?.name,
    actualizado: String(x.resource?.updatedAt || "").slice(0,10),
    tipo: x.resource?.type,
  }));
  if (!res.length) console.log("   sin resultados");
  res.forEach(x => console.log(`   ${x.id}  [${x.tipo}]  ${x.actualizado}  ${x.nombre}`));
  return res;
}

/* ── 2 · ¿Un dataset es consultable por la API? ─────────────────────── */
async function probarDataset(id, nombre) {
  const r = await get(`https://www.datos.gov.co/resource/${id}.json?$limit=2`);
  if (!r.ok) {
    let msg = r.txt.slice(0,120).replace(/\s+/g," ");
    console.log(`   ✗ ${id}  HTTP ${r.status}  ${msg}`);
    return null;
  }
  let rows;
  try { rows = JSON.parse(r.txt); } catch { console.log(`   ✗ ${id}  no es JSON`); return null; }
  if (!Array.isArray(rows) || !rows.length) { console.log(`   ✗ ${id}  lista vacía`); return null; }
  console.log(`   ✓ ${id}  ${nombre || ""}`);
  console.log(`       columnas: ${JSON.stringify(Object.keys(rows[0]))}`);
  console.log(`       muestra : ${JSON.stringify(rows[0]).slice(0,200)}`);
  return { id, columnas: Object.keys(rows[0]), muestra: rows[0] };
}

/* ── 3 · SOFR: probar varias formas de la URL ───────────────────────── */
async function probarSOFR() {
  const urls = [
    "https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json",
    "https://markets.newyorkfed.org/api/rates/all/latest.json",
    "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json",
    "https://markets.newyorkfed.org/api/rates/sofr/last/1.json",
  ];
  console.log("\n── SOFR · NY Federal Reserve");
  for (const u of urls) {
    const r = await get(u, 15000);
    const corto = u.replace("https://markets.newyorkfed.org/api/rates/", "…/");
    if (!r.ok) { console.log(`   ✗ ${corto}  HTTP ${r.status}  ${r.txt.slice(0,90).replace(/\s+/g," ")}`); continue; }
    console.log(`   ✓ ${corto}`);
    console.log(`       ${r.txt.slice(0,260).replace(/\s+/g," ")}`);
  }
}

/* ── 4 · Respaldo de tipo de cambio ─────────────────────────────────── */
async function probarRespaldo() {
  console.log("\n── Respaldo de tipo de cambio");
  for (const u of ["https://open.er-api.com/v6/latest/USD",
                   "https://api.frankfurter.app/latest?from=USD&to=COP"]) {
    const r = await get(u, 15000);
    if (!r.ok) { console.log(`   ✗ ${u}  HTTP ${r.status}`); continue; }
    let v = "?";
    try { const d = JSON.parse(r.txt); v = d?.rates?.COP ?? "sin COP"; } catch {}
    console.log(`   ✓ ${u}  →  COP = ${v}`);
  }
}

/* ── main ───────────────────────────────────────────────────────────── */
console.log("═══ SONDA DE DESCUBRIMIENTO ═══");

const vistos = new Map();
for (const q of ["IBR indicador bancario de referencia", "DTF deposito termino fijo",
                 "tasa de interes de politica monetaria banco republica",
                 "indice de precios al consumidor IPC inflacion",
                 "tasa de usura interes bancario corriente"]) {
  for (const r of await buscarCatalogo(q)) if (r.id) vistos.set(r.id, r.nombre);
}

console.log(`\n── Probando cuáles de los ${vistos.size} datasets son consultables`);
const buenos = [];
for (const [id, nombre] of vistos) {
  const r = await probarDataset(id, nombre);
  if (r) buenos.push({ ...r, nombre });
}

await probarSOFR();
await probarRespaldo();

console.log(`\n═══ RESUMEN: ${buenos.length} datasets consultables ═══`);
buenos.forEach(b => console.log(`  ${b.id}  ${b.nombre}`));
