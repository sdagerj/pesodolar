#!/usr/bin/env node
/** Descubrir qué servicios expone totoro.banrep.gov.co */

async function get(url, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json,*/*" } });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, txt, tipo: (r.headers.get("content-type")||"").split(";")[0] };
  } catch (e) { return { ok:false, status:0, txt:String(e.message||e), tipo:"" };
  } finally { clearTimeout(t); }
}

const BASE = "https://totoro.banrep.gov.co/estadisticas-economicas/rest/consultaDatosService/";

const servicios = [
  "consultaMercadoCambiario", "consultaTasaIntervencion", "consultaTasasIntervencion",
  "consultaTasaPoliticaMonetaria", "consultaTasasInteres", "consultaIBR", "consultaIbr",
  "consultaTasaIBR", "consultaIPC", "consultaInflacion", "consultaIndicePrecios",
  "consultaDTF", "consultaTasasCaptacion", "consultaTRM", "consultaIndicadores",
  "consultaSeries", "consultaDatos", "consultaTasaUsura",
];

console.log("═══ Servicios en totoro.banrep.gov.co ═══\n");
const vivos = [];
for (const s of servicios) {
  const r = await get(BASE + s);
  const marca = r.ok ? "✓" : "✗";
  let extra = "";
  if (r.ok) {
    extra = ` · ${r.tipo} · ${r.txt.length}b · ${r.txt.slice(0,150).replace(/\s+/g," ")}`;
    vivos.push(s);
  } else {
    extra = ` · HTTP ${r.status}`;
  }
  console.log(`  ${marca} ${s.padEnd(32)}${extra}`);
}

console.log("\n═══ Rutas de índice / catálogo ═══\n");
for (const u of [
  "https://totoro.banrep.gov.co/estadisticas-economicas/rest/",
  "https://totoro.banrep.gov.co/estadisticas-economicas/rest/consultaDatosService",
  "https://totoro.banrep.gov.co/estadisticas-economicas/rest/application.wadl",
  "https://totoro.banrep.gov.co/estadisticas-economicas/catalogo",
  "https://totoro.banrep.gov.co/estadisticas-economicas/",
]) {
  const r = await get(u);
  console.log(`  ${r.ok?"✓":"✗"} ${u.replace("https://totoro.banrep.gov.co","")}  HTTP ${r.status} · ${r.tipo} · ${r.txt.length}b`);
  if (r.ok && r.txt.length < 4000) console.log(`      ${r.txt.slice(0,500).replace(/\s+/g," ")}`);
  else if (r.ok) {
    // buscar nombres de servicio dentro del HTML/JS
    const m = [...new Set((r.txt.match(/consulta[A-Z][A-Za-z]+/g) || []))];
    if (m.length) console.log(`      menciona: ${m.slice(0,25).join(", ")}`);
  }
}

console.log("\n═══ Forma del servicio que sí responde ═══\n");
const r = await get(BASE + "consultaMercadoCambiario");
if (r.ok) {
  try {
    const d = JSON.parse(r.txt);
    console.log(`  tipo: ${Array.isArray(d) ? "lista de " + d.length : typeof d}`);
    console.log(`  primeros 3: ${JSON.stringify(d.slice(0,3))}`);
    console.log(`  últimos 3 : ${JSON.stringify(d.slice(-3))}`);
    const ult = d[d.length-1];
    if (Array.isArray(ult) && ult.length >= 2)
      console.log(`  último punto: ${new Date(Number(ult[0])).toISOString()} → ${ult[1]}`);
  } catch (e) { console.log("  no parseable:", e.message); }
}
