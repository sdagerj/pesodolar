#!/usr/bin/env node
/**
 * Escribe datos.json con las tasas que la app no puede buscar sola desde el
 * navegador. Corre en GitHub Actions cada día hábil. Sin dependencias.
 *
 * Todas las fuentes de aquí fueron verificadas ejecutando scripts/sonda.mjs
 * contra los servicios reales. No hay identificadores ni rutas supuestas.
 *
 * Reglas:
 *   1. Cada fuente es independiente: si una falla, las demás siguen.
 *   2. Nunca se borra un dato bueno — si hoy falla, se conserva el anterior.
 *   3. Todo valor pasa por un control de rango antes de aceptarse.
 *   4. Cada fallo deja su causa exacta en el registro del job.
 */
import { readFile, writeFile } from "node:fs/promises";

const SALIDA = new URL("../datos.json", import.meta.url);
const R = "https://www.datos.gov.co/resource/";

const RANGO = {
  trm:   [500, 20000],
  sofr:  [0, 15],
  ibc:   [5, 45],
  usura: [10, 70],
  cdt90: [0.5, 30],
};

const log = (...a) => console.log(...a);
const q = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const enRango = (v, r) => Number.isFinite(v) && v >= r[0] && v <= r[1];

async function jget(url, ms = 25000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} — ${txt.slice(0, 160).replace(/\s+/g, " ")}`);
    try { return JSON.parse(txt); }
    catch { throw new Error("respuesta no es JSON: " + txt.slice(0, 160)); }
  } finally { clearTimeout(t); }
}

/* "19.06%" -> 19.06 ; "10,27" -> 10.27 */
const aNumero = v => {
  const n = parseFloat(String(v ?? "").replace("%", "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};

/* ── TRM oficial ─────────────────────────────────────────────────────
   Dataset verificado: columnas valor, unidad, vigenciadesde, vigenciahasta. */
async function traerTRM() {
  try {
    const rows = await jget(R + "32sa-8pi3.json?" + q({ "$order": "vigenciadesde DESC", "$limit": "1" }));
    const v = aNumero(rows?.[0]?.valor);
    if (enRango(v, RANGO.trm))
      return { valor: v, fecha: String(rows[0].vigenciadesde).slice(0, 10), fuente: "datos.gov.co/32sa-8pi3" };
    log(`     TRM: valor fuera de rango o ilegible: ${rows?.[0]?.valor}`);
  } catch (e) { log(`     TRM fallo — ${e.message}`); }
  return null;
}

/* ── SOFR ────────────────────────────────────────────────────────────
   La ruta lleva /secured/: sin ese segmento la API responde 400. */
async function traerSOFR() {
  try {
    const d = await jget("https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json", 15000);
    const r = d?.refRates?.[0];
    const v = aNumero(r?.percentRate);
    if (enRango(v, RANGO.sofr))
      return { valor: v, fecha: r.effectiveDate, fuente: "newyorkfed.org" };
    log(`     SOFR: respuesta sin percentRate utilizable`);
  } catch (e) { log(`     SOFR fallo — ${e.message}`); }
  return null;
}

/* ── IBC y usura ─────────────────────────────────────────────────────
   La Superintendencia Financiera certifica el Interes Bancario Corriente
   por resolucion y lo publica en pare-7x5i, por modalidad. La que aplica a
   credito de consumo y comercial ordinario es "CONSUMO Y ORDINARIO".
   La usura es IBC x 1,5 por regla legal, asi que se calcula en vez de
   rasparla de una pagina HTML. */
async function traerIBCyUsura() {
  try {
    const rows = await jget(R + "pare-7x5i.json?" + q({
      "$where": "upper(modalidad) like '%CONSUMO Y ORDINARIO%'",
      "$order": "vigencia_desde DESC",
      "$limit": "1",
    }));
    const r = rows?.[0];
    const ibc = aNumero(r?.interes_bancario_corriente);
    if (!enRango(ibc, RANGO.ibc)) {
      log(`     IBC: valor fuera de rango o ilegible: ${r?.interes_bancario_corriente}`);
      return { ibc: null, usura: null };
    }
    const fecha = String(r.vigencia_desde).slice(0, 10);
    const usura = Math.round(ibc * 1.5 * 100) / 100;
    const comun = { fecha, fuente: "datos.gov.co/pare-7x5i · SFC" };
    return {
      ibc: { valor: ibc, ...comun, modalidad: r.modalidad,
             vigencia_hasta: String(r.vigencia_hasta || "").slice(0, 10) },
      usura: enRango(usura, RANGO.usura)
        ? { valor: usura, ...comun, nota: "IBC x 1,5 (regla legal)" } : null,
    };
  } catch (e) { log(`     IBC/usura fallo — ${e.message}`); }
  return { ibc: null, usura: null };
}

/* ── Tasa promedio de CDT a 90 dias ──────────────────────────────────
   Misma definicion que la DTF: promedio de las captaciones por CDT a 90
   dias, ponderado por monto, sobre la ultima fecha de corte publicada. */
async function traerCDT90() {
  try {
    const f = await jget(R + "axk9-g2nh.json?" + q({ "$select": "max(fechacorte) AS f" }));
    const ultima = String(f?.[0]?.f || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ultima)) throw new Error("no se pudo leer la ultima fecha de corte");

    const rows = await jget(R + "axk9-g2nh.json?" + q({
      "$select": "tasa, monto",
      "$where": `fechacorte='${ultima}T00:00:00.000' AND monto > 0 AND upper(descripcion) like '%90 DIAS%'`,
      "$limit": "1000",
    }));

    let sumaMonto = 0, sumaProd = 0, n = 0;
    for (const r of rows || []) {
      const t = aNumero(r.tasa), m = aNumero(r.monto);
      if (t != null && m != null && m > 0 && t > 0 && t < 60) { sumaMonto += m; sumaProd += t * m; n++; }
    }
    if (!n || sumaMonto <= 0) throw new Error("ninguna emision de CDT a 90 dias utilizable");

    const prom = Math.round((sumaProd / sumaMonto) * 10000) / 10000;
    if (!enRango(prom, RANGO.cdt90)) throw new Error(`promedio fuera de rango: ${prom}`);
    return { valor: prom, fecha: ultima, fuente: "datos.gov.co/axk9-g2nh · SFC",
             nota: `promedio ponderado por monto de ${n} emisiones de CDT a 90 dias` };
  } catch (e) { log(`     CDT 90 dias fallo — ${e.message}`); }
  return null;
}

/* ── Orquestacion ────────────────────────────────────────────────────── */
async function main() {
  let previo = {};
  try { previo = JSON.parse(await readFile(SALIDA, "utf8")); }
  catch { log("Sin datos.json previo; se creara uno nuevo."); }

  log("Consultando fuentes...");
  const [trm, sofr, sfc, cdt90] = await Promise.all([
    traerTRM(), traerSOFR(), traerIBCyUsura(), traerCDT90(),
  ]);

  /* La DTF desaparece el 1-ene-2027 y se reemplaza por el IBR a 3 meses.
     Mientras tanto el promedio de CDT a 90 dias es su misma definicion,
     asi que se publica bajo ambos nombres para que la app lo encuentre. */
  const nuevos = { trm, sofr, ibc: sfc.ibc, usura: sfc.usura, cdt90, dtf: cdt90 };

  const salida = { actualizado: new Date().toISOString(), tasas: {}, estado: {} };
  for (const [k, v] of Object.entries(nuevos)) {
    const antes = previo?.tasas?.[k] || null;
    if (v) {
      salida.tasas[k] = v; salida.estado[k] = "ok";
      log(`  OK   ${k.padEnd(6)} ${String(v.valor).padStart(9)}  (${v.fecha}, ${v.fuente})`);
    } else if (antes) {
      salida.tasas[k] = antes; salida.estado[k] = "sin_actualizar";
      log(`  ---  ${k.padEnd(6)} sin dato hoy; se conserva ${antes.valor} de ${antes.fecha}`);
    } else {
      salida.estado[k] = "sin_dato";
      log(`  X    ${k.padEnd(6)} sin dato y sin valor previo`);
    }
  }

  for (const [k, v] of Object.entries(previo?.tasas || {}))
    if (!(k in salida.tasas)) { salida.tasas[k] = v; salida.estado[k] = "manual"; }

  await writeFile(SALIDA, JSON.stringify(salida, null, 2) + "\n");
  log("\ndatos.json escrito.");

  const ok = Object.values(salida.estado).filter(s => s === "ok").length;
  log(`${ok} de ${Object.keys(nuevos).length} fuentes respondieron.`);
  if (ok === 0) { console.error("Ninguna fuente respondio."); process.exit(1); }
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
