#!/usr/bin/env node
/** Buscar fuentes automáticas para tasa BanRep, IBR e inflación. */

async function get(url, ms = 20000, headers = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*", ...headers } });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, txt, tipo: r.headers.get("content-type") || "" };
  } catch (e) { return { ok: false, status: 0, txt: String(e.message || e), tipo: "" };
  } finally { clearTimeout(t); }
}

console.log("═══ 1 · Catálogo de Datos Abiertos ═══");
for (const q of ["tasa intervencion banco de la republica politica monetaria",
                 "indice precios consumidor IPC variacion anual DANE",
                 "inflacion mensual anual colombia",
                 "indicador bancario de referencia IBR overnight"]) {
  const u = "https://api.us.socrata.com/api/catalog/v1?domains=datos.gov.co"
          + "&search_context=datos.gov.co&only=dataset&limit=6&q=" + encodeURIComponent(q);
  const r = await get(u);
  console.log(`\n  "${q}"`);
  if (!r.ok) { console.log(`    fallo HTTP ${r.status}`); continue; }
  try {
    const d = JSON.parse(r.txt);
    const res = d.results || [];
    if (!res.length) console.log("    sin resultados");
    for (const x of res) {
      const id = x.resource?.id, nom = x.resource?.name;
      const p = await get(`https://www.datos.gov.co/resource/${id}.json?$limit=1`, 12000);
      let marca = `HTTP ${p.status}`;
      if (p.ok) { try { const rows = JSON.parse(p.txt);
        marca = Array.isArray(rows) && rows[0] ? "✓ " + JSON.stringify(Object.keys(rows[0])).slice(0,150) : "vacío";
      } catch { marca = "no JSON"; } }
      console.log(`    ${id}  ${String(nom).slice(0,55)}`);
      console.log(`       ${marca}`);
    }
  } catch { console.log("    respuesta no parseable"); }
}

console.log("\n\n═══ 2 · Servicios del Banco de la República ═══");
const candidatos = [
  "https://suameca.banrep.gov.co/buscador-de-series/rest/buscadorSeriesRestService/buscarSeries",
  "https://suameca.banrep.gov.co/estadisticas-economicas/rest/consultaDatosService/consultaMercadoCambiario",
  "https://totoro.banrep.gov.co/estadisticas-economicas/rest/consultaDatosService/consultaMercadoCambiario",
  "https://www.banrep.gov.co/estadisticas/trm",
  "https://suameca.banrep.gov.co/estadisticas-economicas/catalogo",
];
for (const u of candidatos) {
  const r = await get(u, 15000);
  console.log(`\n  ${u.replace("https://","").slice(0,75)}`);
  console.log(`    HTTP ${r.status} · ${r.tipo.slice(0,40)} · ${r.txt.length} bytes`);
  if (r.ok) console.log(`    ${r.txt.slice(0,220).replace(/\s+/g," ")}`);
}

console.log("\n\n═══ 3 · Otras fuentes de inflación y tasa de política ═══");
const otras = [
  ["Banco Mundial · inflación CO", "https://api.worldbank.org/v2/country/COL/indicator/FP.CPI.TOTL.ZG?format=json&per_page=3&mrv=3"],
  ["Banco Mundial · tasa de interés real", "https://api.worldbank.org/v2/country/COL/indicator/FR.INR.RINR?format=json&mrv=2"],
  ["DANE · índice IPC (archivo)", "https://www.dane.gov.co/files/operaciones/IPC/anex-IPC-IndiceInflacion-sep2026.xlsx"],
];
for (const [nombre, u] of otras) {
  const r = await get(u, 15000);
  console.log(`\n  ${nombre}`);
  console.log(`    HTTP ${r.status} · ${r.txt.length} bytes`);
  if (r.ok) console.log(`    ${r.txt.slice(0,300).replace(/\s+/g," ")}`);
}
