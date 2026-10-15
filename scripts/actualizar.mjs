#!/usr/bin/env node
/**
 * Escribe datos.json con las tasas que la app no puede buscar sola desde el
 * navegador. Corre en GitHub Actions cada día hábil. Sin dependencias: Node 18+.
 *
 * Reglas de diseño:
 *   1. Cada fuente es independiente: si una falla, las demás siguen.
 *   2. Nunca se borra un dato bueno — si hoy falla, se conserva el anterior.
 *   3. Todo valor pasa por un control de rango antes de aceptarse.
 *   4. El resultado registra qué funcionó y qué no, para que el fallo se vea.
 */
import { readFile, writeFile } from "node:fs/promises";

const SALIDA = new URL("../datos.json", import.meta.url);
const RANGO = { ibr:[0.5,30], dtf:[0.5,30], usura:[10,60], ibc:[5,45], sofr:[0,15], trm:[500,20000] };
const log = (...a) => console.log(...a);

async function jget(url, ms = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} — ${txt.slice(0,200)}`);
    try { return JSON.parse(txt); }
    catch (e) { throw new Error("respuesta no es JSON: " + txt.slice(0,200)); }
  } finally { clearTimeout(t); }
}

/* Sonda: describe lo que devuelve un dataset para poder ver sus columnas
   reales en el registro del job, en vez de adivinarlas. */
async function sondear(id) {
  const url = `https://www.datos.gov.co/resource/${id}.json?$limit=2`;
  try {
    const rows = await jget(url, 15000);
    if (!Array.isArray(rows)) return `  · ${id}: respondió pero no es una lista`;
    if (!rows.length)        return `  · ${id}: lista vacía`;
    return `  · ${id}: columnas = ${JSON.stringify(Object.keys(rows[0]))}\n`
         + `             muestra  = ${JSON.stringify(rows[0]).slice(0,220)}`;
  } catch (e) {
    return `  · ${id}: FALLÓ — ${e.message}`;
  }
}

/** Lee una serie de Socrata sin conocer sus columnas de antemano. */
function leerSerie(rows, rango, pistas = []) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== "object") return null;
  const claves = Object.keys(rows[0]);
  const esFecha = v => /^\d{4}-\d{2}-\d{2}/.test(String(v));
  const kFecha = claves.find(k => /fecha|vigencia|periodo|corte/i.test(k) && esFecha(rows[0][k]))
              || claves.find(k => esFecha(rows[0][k]));
  if (!kFecha) return null;
  const nums = claves.filter(k => k !== kFecha && Number.isFinite(parseFloat(rows[0][k])));
  if (!nums.length) return null;
  let kValor = null;
  for (const p of pistas) { kValor = nums.find(k => p.test(k)); if (kValor) break; }
  kValor = kValor || nums.find(k => /valor|tasa|efectiv|nominal/i.test(k)) || nums[0];
  const norm = rows.map(r => ({ fecha: String(r[kFecha]).slice(0,10), valor: parseFloat(r[kValor]) }))
                   .filter(r => esFecha(r.fecha) && Number.isFinite(r.valor))
                   .sort((a,b) => (a.fecha < b.fecha ? -1 : 1));
  if (!norm.length) return null;
  const u = norm[norm.length-1];
  if (u.valor < rango[0] || u.valor > rango[1]) return null;
  return { valor: u.valor, fecha: u.fecha, campo: kValor };
}

async function deSets(nombre, sets, rango, pistas) {
  for (const id of sets) {
    try {
      const rows = await jget(`https://www.datos.gov.co/resource/${id}.json?$limit=40`);
      const s = leerSerie(rows, rango, pistas);
      if (s) return { ...s, fuente: `datos.gov.co/${id}` };
      const cols = Array.isArray(rows) && rows[0] ? Object.keys(rows[0]) : [];
      log(`     ${nombre}: ${id} respondió pero no se reconoció. Columnas: ${JSON.stringify(cols)}`);
    } catch (e) {
      log(`     ${nombre}: ${id} falló — ${e.message}`);
    }
  }
  return null;
}

const traerIBR = () => deSets("IBR", ["ev8i-uzwt","dj9f-u3if","g4wt-pqf5"], RANGO.ibr, [/overnight|nocturn/i, /\bibr\b/i]);
const traerDTF = () => deSets("DTF", ["gtwv-4pxq"], RANGO.dtf, [/dtf/i, /efectiv/i]);

async function traerSOFR() {
  try {
    const d = await jget("https://markets.newyorkfed.org/api/rates/sofr/last/1.json");
    const r = d?.refRates?.[0], v = parseFloat(r?.percentRate);
    if (Number.isFinite(v) && v >= RANGO.sofr[0] && v <= RANGO.sofr[1])
      return { valor: v, fecha: r.effectiveDate, fuente: "newyorkfed.org" };
  } catch (e) { log(`     SOFR falló — ${e.message}`); }
  return null;
}

async function traerTRM() {
  try {
    const rows = await jget("https://www.datos.gov.co/resource/32sa-8pi3.json"
      + "?$order=" + encodeURIComponent("vigenciadesde DESC") + "&$limit=1");
    const v = parseFloat(rows?.[0]?.valor);
    if (Number.isFinite(v) && v > RANGO.trm[0] && v < RANGO.trm[1])
      return { valor: v, fecha: String(rows[0].vigenciadesde).slice(0,10), fuente: "datos.gov.co/32sa-8pi3" };
  } catch (e) { log(`     TRM falló — ${e.message}`); }
  return null;
}

/**
 * Usura e IBC: la Superintendencia Financiera los certifica por resolución y
 * los publica en HTML, no en una API. Se busca el porcentaje en la página de
 * comunicados. Es la fuente más frágil: si cambia la maqueta, deja de
 * encontrar el número y el valor anterior se conserva.
 */
async function traerUsuraIBC() {
  const url = "https://www.superfinanciera.gov.co/publicaciones/10829/"
            + "sala-de-prensacomunicados-de-prensa-interes-bancario-corriente-10829/";
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; pesodolar/1.0)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const html = (await r.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    const pct = (re, rango) => {
      const m = html.match(re);
      if (!m) return null;
      const v = parseFloat(String(m[1]).replace(",", "."));
      return Number.isFinite(v) && v >= rango[0] && v <= rango[1] ? v : null;
    };
    const hoy = new Date().toISOString().slice(0,10);
    const usura = pct(/usura[^%]{0,120}?(\d{1,2}[.,]\d{1,2})\s*%/i, RANGO.usura);
    const ibc   = pct(/(?:inter[eé]s\s+bancario\s+corriente|IBC)[^%]{0,120}?(\d{1,2}[.,]\d{1,2})\s*%/i, RANGO.ibc);
    return {
      usura: usura != null ? { valor: usura, fecha: hoy, fuente: "superfinanciera.gov.co" } : null,
      ibc:   ibc   != null ? { valor: ibc,   fecha: hoy, fuente: "superfinanciera.gov.co" } : null,
    };
  } catch (e) { log(`     Usura/IBC falló — ${e.message}`); return { usura: null, ibc: null }; }
}

async function main() {
  let previo = {};
  try { previo = JSON.parse(await readFile(SALIDA, "utf8")); }
  catch (e) { log("Sin datos.json previo; se creará uno nuevo."); }

  const [ibr, dtf, sofr, trm, sfc] = await Promise.all([
    traerIBR(), traerDTF(), traerSOFR(), traerTRM(), traerUsuraIBC(),
  ]);

  const nuevos = { trm, ibr, dtf, sofr, usura: sfc.usura, ibc: sfc.ibc };
  const salida = { actualizado: new Date().toISOString(), tasas: {}, estado: {} };

  for (const [k, v] of Object.entries(nuevos)) {
    const antes = previo?.tasas?.[k] || null;
    if (v) {
      salida.tasas[k] = v; salida.estado[k] = "ok";
      log(`  OK   ${k.padEnd(6)} ${v.valor}  (${v.fecha}, ${v.fuente})`);
    } else if (antes) {
      salida.tasas[k] = antes; salida.estado[k] = "sin_actualizar";
      log(`  ---  ${k.padEnd(6)} sin dato hoy; se conserva ${antes.valor} de ${antes.fecha}`);
    } else {
      salida.estado[k] = "sin_dato";
      log(`  X    ${k.padEnd(6)} sin dato y sin valor previo`);
    }
  }

  // Lo que ninguna fuente entrega se deja tal cual, para no perder ediciones manuales
  for (const [k, v] of Object.entries(previo?.tasas || {}))
    if (!(k in salida.tasas)) { salida.tasas[k] = v; salida.estado[k] = "manual"; }

  await writeFile(SALIDA, JSON.stringify(salida, null, 2) + "\n");
  log("\ndatos.json escrito.");

  // Sonda de esquemas: deja en el registro las columnas reales de cada
  // dataset, para poder corregir los lectores con datos y no suponiendo.
  if (process.env.SONDEAR === "1") {
    log("\n── Sonda de esquemas ──");
    for (const id of ["ev8i-uzwt","dj9f-u3if","g4wt-pqf5","gtwv-4pxq","32sa-8pi3"])
      log(await sondear(id));
  }

  if (Object.values(salida.estado).filter(s => s === "ok").length === 0) {
    console.error("Ninguna fuente respondió.");
    process.exit(1);
  }
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
