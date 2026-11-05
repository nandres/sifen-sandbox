import type { Element } from "@xmldom/xmldom";

import { cdcBody, isCdcCheckDigitValid, isCdcShape, modulo11 } from "./identifiers.js";
import { checkQr } from "./qr.js";
import { hit, type RuleHit } from "./rules.js";
import { verifySignature } from "./signature.js";
import type { Store } from "./store.js";
import { HOUR, parseLocal } from "./time.js";
import { DSIG_NS, MalformedXmlError, SIFEN_NS, XSI_NS, descendant, descendants, parseXml, text } from "./xml.js";
import { SCHEMA_DE, type SchemaSet } from "./xsd.js";

export type DocumentStatus = "Aprobado" | "Aprobado con observación" | "Rechazado";

export interface DocumentOutcome {
  status: DocumentStatus;
  results: RuleHit[];
  cdc?: string;
  digest?: string;
  protAut?: string;
}

export interface ValidationContext {
  store: Store;
  schemas: SchemaSet;
  cscs: ReadonlyMap<string, string>;
  checkCertificateRuc: boolean;
}

const TIPOS_DE: Readonly<Record<string, string>> = {
  "1": "Factura electrónica",
  "2": "Factura electrónica de exportación",
  "3": "Factura electrónica de importación",
  "4": "Autofactura electrónica",
  "5": "Nota de crédito electrónica",
  "6": "Nota de débito electrónica",
  "7": "Nota de remisión electrónica",
  "8": "Comprobante de retención electrónico",
};
const TIPOS_EMISION: Readonly<Record<string, string>> = { "1": "Normal", "2": "Contingencia" };
const SYSTEM_LAUNCH = Date.parse("2018-11-22T00:00:00-03:00");

const rejected = (rejection: RuleHit, cdc?: string, digest?: string): DocumentOutcome => ({
  status: "Rechazado",
  results: [rejection],
  ...(cdc ? { cdc } : {}),
  ...(digest ? { digest } : {}),
});

function checkForm(rde: string): RuleHit | undefined {
  if (rde !== rde.trim() || />\s+</.test(rde)) {
    return hit("0105", "Hay espacios o saltos de línea entre los campos del XML");
  }
  if (/<\/?[\w.-]+:[\w.-]+[\s>/]/.test(rde)) return hit("0106", "Hay elementos con prefijo; deben usar el namespace por defecto");

  const namespaces = [...rde.matchAll(/\sxmlns(?::[\w.-]+)?\s*=\s*["']([^"']*)["']/g)].map((m) => m[1] ?? "");
  const unexpected = namespaces.find((ns) => ![SIFEN_NS, DSIG_NS, XSI_NS].includes(ns));
  return unexpected === undefined ? undefined : hit("0104", `Namespace no esperado: ${unexpected}`);
}

function checkIssuer(de: Element, ctx: ValidationContext, sync: boolean): RuleHit | undefined {
  const ruc = text(de, "dRucEm") ?? "";
  const dv = text(de, "dDVEmi") ?? "";
  if (modulo11(ruc) !== Number(dv)) return hit("1253", `Para el RUC ${ruc} el dígito es ${modulo11(ruc)}, no ${dv}`);

  const entry = ctx.store.ruc(ruc);
  if (!entry.existe) return hit("1250", `RUC ${ruc}`);
  if (!entry.facturaElectronica) return hit("1251", `RUC ${ruc}`);
  if (entry.estado !== "ACT") return hit("1252", `RUC ${ruc} en estado ${entry.estado}`);
  if (sync && !entry.usaServicioSincrono) return hit("1264", `RUC ${ruc}`);
  return undefined;
}

function checkDates(de: Element, now: number): RuleHit | undefined {
  const issued = parseLocal(text(de, "dFeEmiDE"));
  if (issued === undefined) return hit("1150", "dFeEmiDE no se pudo interpretar");
  if (issued < SYSTEM_LAUNCH) return hit("1156");
  if (now - issued > 720 * HOUR) return hit("1150", "La emisión tiene más de 720 horas");
  if (issued - now > 120 * HOUR) return hit("1151", "La emisión está más de 120 horas adelantada");
  return undefined;
}

function checkTimbrado(de: Element, ctx: ValidationContext): RuleHit | undefined {
  const ruc = text(de, "dRucEm") ?? "";
  const numero = text(de, "dNumTim") ?? "";
  const start = parseLocal(text(de, "dFeIniT"));
  const issued = parseLocal(text(de, "dFeEmiDE"));
  if (start !== undefined && issued !== undefined && issued < start) {
    return hit("1103", "La emisión es anterior al inicio de vigencia del timbrado");
  }
  // Sin timbrados cargados se aceptan todos: nada de esto existe fuera de la base de la DNIT.
  const ownTimbrados = [...ctx.store.timbrados.values()].filter((t) => t.ruc === ruc);
  if (ownTimbrados.length === 0) return undefined;
  const found = ownTimbrados.find((t) => t.numero === numero);
  if (!found) return hit("1101", `Timbrado ${numero} no corresponde al RUC ${ruc}`);
  if (!found.activo) return hit("1104", `Timbrado ${numero}`);
  return undefined;
}

export function timbradoKey(de: Element): string {
  return ["iTiDE", "dNumTim", "dNumDoc", "iTipEmi", "dEst", "dPunExp", "dSerieNum"].map((name) => text(de, name) ?? "").join("|");
}

/** Valida un rDE en el orden del manual y registra el documento si queda aprobado. */
export async function validateDocument(rde: string, ctx: ValidationContext, options: { sync: boolean }): Promise<DocumentOutcome> {
  const form = checkForm(rde);
  if (form) return rejected(form);

  let document;
  try {
    document = parseXml(rde);
  } catch (error) {
    if (error instanceof MalformedXmlError) return rejected(hit("0160", error.message.slice(0, 200)));
    throw error;
  }
  if (document.documentElement?.localName !== "rDE") return rejected(hit("0101", "La raíz debe ser rDE"));

  const version = text(document, "dVerFor");
  if (version !== undefined && version !== "150") return rejected(hit("0163", `dVerFor es ${version}; se simula la versión 150`));

  const schema = await ctx.schemas.validate(SCHEMA_DE, rde);
  if (!schema.valid) return rejected(hit("0100", schema.errors[0]?.slice(0, 240)));

  const de = descendant(document, "DE") as Element;
  const cdc = de.getAttribute("Id") ?? "";

  const signature = verifySignature(rde, cdc);
  if (signature.rejection) return rejected(signature.rejection, isCdcShape(cdc) ? cdc : undefined);
  const digest = signature.digest ?? "";
  if (ctx.checkCertificateRuc && !(signature.certificateSubject ?? "").includes(text(de, "dRucEm") ?? "")) {
    return rejected(hit("0142", signature.certificateSubject), cdc, digest);
  }

  if (!isCdcCheckDigitValid(cdc)) return rejected(hit("1003", `CDC ${cdc}`), cdc, digest);
  const issuedText = text(de, "dFeEmiDE") ?? "";
  const body = cdcBody({
    iTiDE: text(de, "iTiDE") ?? "",
    dRucEm: text(de, "dRucEm") ?? "",
    dDVEmi: text(de, "dDVEmi") ?? "",
    dEst: text(de, "dEst") ?? "",
    dPunExp: text(de, "dPunExp") ?? "",
    dNumDoc: text(de, "dNumDoc") ?? "",
    iTipCont: text(de, "iTipCont") ?? "",
    fecha: issuedText.slice(0, 10).replaceAll("-", ""),
    iTipEmi: text(de, "iTipEmi") ?? "",
    dCodSeg: text(de, "dCodSeg") ?? "",
  });
  if (body !== cdc.slice(0, 43)) {
    return rejected(hit("1000", `El CDC debería empezar con ${body}`), cdc, digest);
  }

  const tipoEmision = text(de, "iTipEmi") ?? "";
  if (tipoEmision === "2") return rejected(hit("1050", "La contingencia todavía no está habilitada"), cdc, digest);
  const descEmision = text(de, "dDesTipEmi");
  if (descEmision !== TIPOS_EMISION[tipoEmision]) {
    return rejected(hit("1051", `Para ${tipoEmision} es "${TIPOS_EMISION[tipoEmision] ?? ""}"`), cdc, digest);
  }
  const tipo = text(de, "iTiDE") ?? "";
  const descTipo = text(de, "dDesTiDE");
  if (descTipo !== TIPOS_DE[tipo]) return rejected(hit("1100", `Para ${tipo} es "${TIPOS_DE[tipo] ?? ""}"`), cdc, digest);

  const { store } = ctx;
  if (store.documents.has(cdc)) return rejected(hit("1001", `CDC ${cdc}`), cdc, digest);
  const key = timbradoKey(de);
  const duplicateOf = store.timbradoKeys.get(key);
  if (duplicateOf) return rejected(hit("1002", `Coincide con el CDC ${duplicateOf}`), cdc, digest);

  const now = store.now();
  const signed = parseLocal(text(de, "dFecFirma"));
  if (signed !== undefined && signed > now) return rejected(hit("1004"), cdc, digest);

  const dates = checkDates(de, now);
  if (dates) return rejected(dates, cdc, digest);
  const issuer = checkIssuer(de, ctx, options.sync);
  if (issuer) return rejected(issuer, cdc, digest);
  const timbrado = checkTimbrado(de, ctx);
  if (timbrado) return rejected(timbrado, cdc, digest);

  const receiver = text(de, "dRucRec");
  const qr = checkQr(
    text(document, "dCarQR"),
    {
      cdc,
      fechaEmision: issuedText,
      receptor: receiver ? `dRucRec=${receiver}` : `dNumIDRec=${text(de, "dNumIDRec") ?? "0"}`,
      totalGeneral: text(de, "dTotGralOpe") ?? "0",
      totalIva: text(de, "dTotIVA") ?? "0",
      items: descendants(de, "gCamItem").length,
      digest,
    },
    ctx.cscs,
  );
  if (qr) return rejected(qr, cdc, digest);

  const results: RuleHit[] = [];
  if (signed !== undefined && now - signed > 72 * HOUR) {
    results.push(hit("1005", "Pasaron más de 72 horas desde la firma"));
  }
  const status: DocumentStatus = results.length > 0 ? "Aprobado con observación" : "Aprobado";
  if (results.length === 0) results.push(hit("0260"));

  const protAut = store.nextProtAut();
  store.documents.set(cdc, {
    cdc,
    xml: rde,
    digest,
    protAut,
    status,
    ruc: text(de, "dRucEm") ?? "",
    tipo,
    approvedAt: now,
    cancelled: false,
  });
  store.timbradoKeys.set(key, cdc);
  return { status, results, cdc, digest, protAut };
}
