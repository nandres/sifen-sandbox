#!/usr/bin/env node
// Baja los XSD oficiales de SIFEN a ./xsd. No se versionan: son material de la DNIT.
// La DNIT puede cambiar un archivo sin cambiarle el nombre, así que cada descarga se
// compara contra schemas.lock.json y avisa si algo cambió.
//
//   npm run xsd:download
//   npm run xsd:download -- --update-lock

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, process.env.SIFEN_XSD_DIR ?? "xsd");
const LOCK = join(ROOT, "schemas.lock.json");
const BASE = process.env.SIFEN_XSD_BASE_URL ?? "https://ekuatia.set.gov.py/sifen/xsd/";

// Un archivo por servicio; el resto llega siguiendo los include e import.
const ROOTS = [
  "siRecepDE_v150.xsd",
  "WS_SiRecepDE_v150.xsd",
  "WS_SiRecepLoteDE_v141.xsd",
  "WS_SiConsLote_v141.xsd",
  "WS_SiConsDE_v141.xsd",
  "WS_SiConsRUC_v141.xsd",
  "WS_SiRecepEvento_v150.xsd",
];

const LOCATION = /(<(?:[\w-]+:)?(?:include|import)\b[^>]*?\bschemaLocation\s*=\s*)(["'])\s*([^"']+?)\s*\2/g;
const seen = new Map();

async function fetchSchema(url) {
  const name = basename(new URL(url).pathname);
  if (seen.has(name)) return;
  seen.set(name, "");

  const response = await fetch(url, {
    headers: { "User-Agent": "sifen-sandbox" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  const original = await response.text();
  seen.set(name, createHash("sha256").update(original).digest("hex"));

  const locations = [...original.matchAll(LOCATION)].map((m) => m[3]);
  for (const location of new Set(locations)) {
    await fetchSchema(new URL(location, url).toString());
  }

  // Apunta a las copias locales para validar sin red.
  const local = original.replace(
    LOCATION,
    (_all, prefix, quote, location) => `${prefix}${quote}${basename(new URL(location, url).pathname)}${quote}`,
  );
  writeFileSync(join(OUT, name), local);
}

mkdirSync(OUT, { recursive: true });
for (const root of ROOTS) await fetchSchema(new URL(root, BASE).toString());

const hashes = Object.fromEntries([...seen.entries()].sort(([a], [b]) => a.localeCompare(b)));
console.log(`${seen.size} esquemas en ${OUT}`);

if (process.argv.includes("--update-lock") || !existsSync(LOCK)) {
  writeFileSync(
    LOCK,
    `${JSON.stringify({ source: BASE, checkedAt: new Date().toISOString().slice(0, 10), sha256: hashes }, null, 2)}\n`,
  );
  console.log("schemas.lock.json actualizado");
} else {
  const lock = JSON.parse(readFileSync(LOCK, "utf8")).sha256;
  const changed = Object.keys({ ...lock, ...hashes }).filter((name) => lock[name] !== hashes[name]);
  if (changed.length > 0) {
    console.warn(`AVISO: la DNIT cambió estos esquemas desde el último control: ${changed.join(", ")}`);
    console.warn("Revisá las diferencias y, si corresponde, corré: npm run xsd:download -- --update-lock");
    if (process.argv.includes("--strict")) process.exitCode = 1;
  } else {
    console.log("Los esquemas coinciden con schemas.lock.json");
  }
}
