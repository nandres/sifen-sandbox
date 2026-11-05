import { unzipSync, strFromU8 } from "fflate";
import type { Element } from "@xmldom/xmldom";

import { isCdcCheckDigitValid } from "./identifiers.js";
import { hit, type RuleHit } from "./rules.js";
import { element } from "./soap.js";
import { verifySignature } from "./signature.js";
import type { LotItem, RequestLogEntry, RucState, StoredLot } from "./store.js";
import { HOUR, formatProcessDate, parseLocal } from "./time.js";
import { validateDocument, type DocumentOutcome, type ValidationContext } from "./validate.js";
import { SIFEN_NS, descendant, escapeXml, parseXml, rawElement, rawElements, text } from "./xml.js";
import { SCHEMA_WS } from "./xsd.js";

export type ServiceName = "siRecepDE" | "siRecepLoteDE" | "siResultLoteDE" | "siConsDE" | "siConsRUC" | "siRecepEvento";

export interface ServiceDefinition {
  name: ServiceName;
  root: string;
  maxBytes: number;
  oversizeCode: string;
}

const KB = 1000;

export const SERVICES: Readonly<Record<string, ServiceDefinition>> = {
  "/de/ws/sync/recibe.wsdl": { name: "siRecepDE", root: "rEnviDe", maxBytes: 1000 * KB, oversizeCode: "0200" },
  "/de/ws/async/recibe-lote.wsdl": { name: "siRecepLoteDE", root: "rEnvioLote", maxBytes: 10_000 * KB, oversizeCode: "0270" },
  "/de/ws/consultas/consulta-lote.wsdl": { name: "siResultLoteDE", root: "rEnviConsLoteDe", maxBytes: 1000 * KB, oversizeCode: "0320" },
  "/de/ws/consultas/consulta.wsdl": { name: "siConsDE", root: "rEnviConsDeRequest", maxBytes: 1000 * KB, oversizeCode: "0380" },
  "/de/ws/consultas/consulta-ruc.wsdl": { name: "siConsRUC", root: "rEnviConsRUC", maxBytes: 1000 * KB, oversizeCode: "0460" },
  "/de/ws/eventos/evento.wsdl": { name: "siRecepEvento", root: "rEnviEventoDe", maxBytes: 1000 * KB, oversizeCode: "0560" },
};

export interface SandboxContext extends ValidationContext {
  lotDelayMs: number;
}

export interface ServiceResult {
  body: string;
  log: Omit<RequestLogEntry, "at" | "service">;
}

/** El mensaje oficial, más la explicación del simulador cuando hay una. Máximo 255 caracteres. */
function message(result: RuleHit): string {
  const full = result.detail ? `${result.message} [sandbox: ${result.detail}]` : result.message;
  return escapeXml(full.slice(0, 255));
}

const resProc = (result: RuleHit): string =>
  `<gResProc><dCodRes>${result.code}</dCodRes><dMsgRes>${message(result)}</dMsgRes></gResProc>`;

function protDe(outcome: DocumentOutcome, now: number): string {
  return (
    `<rProtDe>` +
    (outcome.cdc ? `<Id>${outcome.cdc}</Id>` : "") +
    `<dFecProc>${formatProcessDate(now)}</dFecProc>` +
    (outcome.digest ? `<dDigVal>${escapeXml(outcome.digest)}</dDigVal>` : "") +
    `<dEstRes>${outcome.status}</dEstRes>` +
    (outcome.protAut ? `<dProtAut>${outcome.protAut}</dProtAut>` : "") +
    outcome.results.map(resProc).join("") +
    `</rProtDe>`
  );
}

/** Respuesta de cada servicio cuando el pedido se rechaza antes de llegar a procesarse. */
export function rejectionBody(service: ServiceName, rejection: RuleHit, now: number): string {
  const date = formatProcessDate(now);
  switch (service) {
    case "siRecepDE":
      return element("rRetEnviDe", protDe({ status: "Rechazado", results: [rejection] }, now));
    case "siRecepLoteDE":
      return element(
        "rResEnviLoteDe",
        `<dFecProc>${date}</dFecProc><dCodRes>${rejection.code}</dCodRes><dMsgRes>${message(rejection)}</dMsgRes><dTpoProces>1</dTpoProces>`,
      );
    case "siResultLoteDE":
      return element(
        "rResEnviConsLoteDe",
        `<dFecProc>${date}</dFecProc><dCodResLot>${rejection.code}</dCodResLot><dMsgResLot>${message(rejection)}</dMsgResLot>`,
      );
    case "siConsDE":
      return element(
        "rEnviConsDeResponse",
        `<dFecProc>${date}</dFecProc><dCodRes>${rejection.code}</dCodRes><dMsgRes>${message(rejection)}</dMsgRes>`,
      );
    case "siConsRUC":
      return element("rResEnviConsRUC", `<dCodRes>${rejection.code}</dCodRes><dMsgRes>${message(rejection)}</dMsgRes>`);
    case "siRecepEvento":
      return element(
        "rRetEnviEventoDe",
        `<dFecProc>${date}</dFecProc><gResProcEVe><dEstRes>Rechazado</dEstRes><id>0</id>${resProc(rejection)}</gResProcEVe>`,
      );
  }
}

/** Si el rDE hereda el namespace de quien lo envuelve, se lo declara para validarlo aislado. */
function withNamespace(raw: string): string {
  const tagEnd = raw.indexOf(">");
  if (/\sxmlns\s*=/.test(raw.slice(0, tagEnd))) return raw;
  const nameEnd = raw.search(/[\s>/]/);
  return `${raw.slice(0, nameEnd)} xmlns="${SIFEN_NS}"${raw.slice(nameEnd)}`;
}

async function recibe(raw: string, dId: string | undefined, ctx: SandboxContext): Promise<ServiceResult> {
  const rde = rawElement(raw, "rDE");
  const now = ctx.store.now();
  if (!rde) {
    const rejection = hit("0101", "xDE no contiene rDE");
    return { body: rejectionBody("siRecepDE", rejection, now), log: { ...idOf(dId), status: "Rechazado", results: [rejection] } };
  }
  const outcome = await validateDocument(withNamespace(rde), ctx, { sync: true });
  return {
    body: element("rRetEnviDe", protDe(outcome, now)),
    log: { ...idOf(dId), ...(outcome.cdc ? { cdc: outcome.cdc } : {}), status: outcome.status, results: outcome.results },
  };
}

const idOf = (dId: string | undefined): { dId?: string } => (dId ? { dId } : {});

function decodeLot(payload: Element): { documents: string[] } | { rejection: RuleHit } {
  const encoded = text(payload, "xDE")?.replace(/\s+/g, "") ?? "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return { rejection: hit("0301", "xDE no es Base64") };
  let files;
  try {
    files = unzipSync(new Uint8Array(Buffer.from(encoded, "base64")));
  } catch {
    return { rejection: hit("0301", "xDE no es un archivo ZIP válido") };
  }
  const content = Object.values(files)[0];
  if (!content) return { rejection: hit("0301", "El ZIP está vacío") };
  const xml = strFromU8(content);
  if (!/<(?:[\w.-]+:)?rLoteDE[\s>]/.test(xml)) return { rejection: hit("0301", "El contenido del ZIP debe tener la raíz rLoteDE") };
  const documents = rawElements(xml, "rDE").map(withNamespace);
  if (documents.length === 0) return { rejection: hit("0301", "El lote no contiene DE") };
  if (documents.length > 50) return { rejection: hit("0301", `El lote tiene ${documents.length} DE; el máximo es 50`) };
  return { documents };
}

function recibeLote(payload: Element, dId: string | undefined, ctx: SandboxContext): ServiceResult {
  const { store } = ctx;
  const now = store.now();
  const decoded = decodeLot(payload);
  if ("rejection" in decoded) {
    return {
      body: rejectionBody("siRecepLoteDE", decoded.rejection, now),
      log: { ...idOf(dId), status: "Rechazado", results: [decoded.rejection] },
    };
  }
  const id = store.nextLotId();
  store.lots.set(id, { id, documents: decoded.documents, receivedAt: Date.now(), readyAt: Date.now() + ctx.lotDelayMs });
  const received = hit("0300");
  return {
    body: element(
      "rResEnviLoteDe",
      `<dFecProc>${formatProcessDate(now)}</dFecProc><dCodRes>${received.code}</dCodRes><dMsgRes>${message(received)}</dMsgRes>` +
        `<dProtConsLote>${id}</dProtConsLote><dTpoProces>${Math.max(1, Math.round(ctx.lotDelayMs / 1000))}</dTpoProces>`,
    ),
    log: { ...idOf(dId), status: "Aprobado", results: [received] },
  };
}

const lotProcessing = new WeakMap<StoredLot, Promise<void>>();

function processLot(lot: StoredLot, ctx: SandboxContext): Promise<void> {
  const running = lotProcessing.get(lot);
  if (running) return running;
  const work = (async () => {
    const types = new Set(lot.documents.map((doc) => /<iTiDE>(\d+)<\/iTiDE>/.exec(doc)?.[1] ?? ""));
    if (types.size > 1) {
      lot.code = "0363";
      lot.results = [];
      return;
    }
    const results: LotItem[] = [];
    // De a uno, para que dos DE del mismo lote se puedan detectar como duplicados.
    for (const document of lot.documents) {
      const outcome = await validateDocument(document, ctx, { sync: false });
      results.push({
        id: outcome.cdc ?? "0",
        status: outcome.status,
        ...(outcome.protAut ? { protAut: outcome.protAut } : {}),
        results: outcome.results,
      });
    }
    lot.code = "0362";
    lot.results = results;
  })();
  lotProcessing.set(lot, work);
  return work;
}

async function consultaLote(payload: Element, dId: string | undefined, ctx: SandboxContext): Promise<ServiceResult> {
  const now = ctx.store.now();
  const lot = ctx.store.lots.get(text(payload, "dProtConsLote") ?? "");
  const finish = (rejection: RuleHit): ServiceResult => ({
    body: rejectionBody("siResultLoteDE", rejection, now),
    log: { ...idOf(dId), status: rejection.effect === "R" ? "Rechazado" : "Aprobado", results: [rejection] },
  });
  if (!lot) return finish(hit("0360"));
  if (Date.now() < lot.readyAt) return finish(hit("0361"));

  await processLot(lot, ctx);
  const result = hit(lot.code ?? "0361");
  if (result.code !== "0362") return finish(result);

  const items = (lot.results ?? [])
    .map(
      (item) =>
        `<gResProcLote><id>${item.id}</id><dEstRes>${item.status}</dEstRes>` +
        (item.protAut ? `<dProtAut>${item.protAut}</dProtAut>` : "") +
        item.results.slice(0, 5).map(resProc).join("") +
        `</gResProcLote>`,
    )
    .join("");
  return {
    body: element(
      "rResEnviConsLoteDe",
      `<dFecProc>${formatProcessDate(now)}</dFecProc><dCodResLot>${result.code}</dCodResLot><dMsgResLot>${message(result)}</dMsgResLot>${items}`,
    ),
    log: { ...idOf(dId), status: "Aprobado", results: (lot.results ?? []).flatMap((item) => item.results) },
  };
}

function consulta(payload: Element, dId: string | undefined, ctx: SandboxContext): ServiceResult {
  const now = ctx.store.now();
  const cdc = text(payload, "dCDC") ?? "";
  const stored = ctx.store.documents.get(cdc);
  const result = hit(stored ? "0422" : "0420");
  const container = stored
    ? `<xContenDE>${escapeXml(`<rContDe>${stored.xml}<dProtAut>${stored.protAut}</dProtAut></rContDe>`)}</xContenDE>`
    : "";
  return {
    body: element(
      "rEnviConsDeResponse",
      `<dFecProc>${formatProcessDate(now)}</dFecProc><dCodRes>${result.code}</dCodRes><dMsgRes>${message(result)}</dMsgRes>${container}`,
    ),
    log: { ...idOf(dId), cdc, status: stored ? "Aprobado" : "Rechazado", results: [result] },
  };
}

const RUC_STATES: Readonly<Record<RucState, string>> = {
  ACT: "ACTIVO",
  CAN: "CANCELADO",
  CDE: "CANCELADO DEFINITIVO",
  SUS: "SUSPENSION TEMPORAL",
  BLQ: "BLOQUEADO",
};

function consultaRuc(payload: Element, dId: string | undefined, ctx: SandboxContext): ServiceResult {
  const ruc = text(payload, "dRUCCons") ?? "";
  const entry = ctx.store.ruc(ruc);
  const result = hit(!entry.existe ? "0500" : !entry.puedeConsultar ? "0501" : "0502");
  const container =
    result.code === "0502"
      ? `<xContRUC><dRUCCons>${escapeXml(ruc)}</dRUCCons><dRazCons>${escapeXml(entry.razonSocial)}</dRazCons>` +
        `<dCodEstCons>${entry.estado}</dCodEstCons><dDesEstCons>${RUC_STATES[entry.estado]}</dDesEstCons>` +
        `<dRUCFactElec>${entry.facturaElectronica ? "S" : "N"}</dRUCFactElec></xContRUC>`
      : "";
  return {
    body: element("rResEnviConsRUC", `<dCodRes>${result.code}</dCodRes><dMsgRes>${message(result)}</dMsgRes>${container}`),
    log: { ...idOf(dId), status: result.code === "0502" ? "Aprobado" : "Rechazado", results: [result] },
  };
}

interface EventResult {
  id: string;
  status: "Aprobado" | "Rechazado";
  protAut?: string;
  result: RuleHit;
}

function cancelDocument(raw: string, ctx: SandboxContext): EventResult {
  const document = parseXml(raw);
  const rEve = descendant(document, "rEve") as Element;
  const eventId = rEve.getAttribute("Id") ?? text(rEve, "Id") ?? "";
  const cancel = descendant(rEve, "rGeVeCan");
  const cdc = (cancel && text(cancel, "Id")) ?? "";
  // El id de la respuesta es el del evento, no el CDC (MT §9.5.3, GRSch032).
  const reject = (result: RuleHit): EventResult => ({ id: eventId || "0", status: "Rechazado", result });

  if (!cancel) {
    // El XSD admite otros eventos; se avisa en vez de aprobarlos sin simularlos.
    throw new UnsupportedEventError();
  }
  if (text(rEve, "dVerFor") !== "150") return reject(hit("4000"));

  const signature = verifySignature(raw, eventId);
  if (signature.rejection) return reject(signature.rejection);
  if (!isCdcCheckDigitValid(cdc)) return reject(hit("4001", `CDC ${cdc}`));

  const { store } = ctx;
  const stored = store.documents.get(cdc);
  if (!stored) return reject(hit("4002"));
  if (stored.cancelled) return reject(hit("4003"));

  const signed = parseLocal(text(rEve, "dFecFirma"));
  if (signed !== undefined && signed > store.now()) return reject(hit("4008"));
  const limitHours = stored.tipo === "1" ? 48 : 168;
  if (signed !== undefined && signed - stored.approvedAt > limitHours * HOUR) {
    return reject(hit(stored.tipo === "1" ? "4009" : "4010", `Pasaron más de ${limitHours} horas desde la aprobación`));
  }
  stored.cancelled = true;
  return { id: eventId, status: "Aprobado", protAut: store.nextProtAut(), result: hit("0600") };
}

export class UnsupportedEventError extends Error {
  constructor() {
    super("Este simulador solo implementa el evento de cancelación (rGeVeCan)");
  }
}

function evento(raw: string, dId: string | undefined, ctx: SandboxContext): ServiceResult {
  const events = rawElements(raw, "rGesEve");
  const results = events.map((event) => cancelDocument(withNamespace(event), ctx));
  const body = results
    .map(
      (item) =>
        `<gResProcEVe><dEstRes>${item.status}</dEstRes>` +
        (item.protAut ? `<dProtAut>${item.protAut}</dProtAut>` : "") +
        `<id>${item.id}</id>${resProc(item.result)}</gResProcEVe>`,
    )
    .join("");
  return {
    body: element("rRetEnviEventoDe", `<dFecProc>${formatProcessDate(ctx.store.now())}</dFecProc>${body}`),
    log: {
      ...idOf(dId),
      status: results.every((item) => item.status === "Aprobado") ? "Aprobado" : "Rechazado",
      results: results.map((item) => item.result),
    },
  };
}

export async function runService(
  definition: ServiceDefinition,
  rawBody: string,
  payload: Element,
  ctx: SandboxContext,
): Promise<ServiceResult> {
  const now = ctx.store.now();
  const dId = text(payload, "dId");
  const schema = await ctx.schemas.validate(SCHEMA_WS[definition.root] as string, payload.toString());
  if (!schema.valid) {
    const rejection = hit("0100", schema.errors[0]?.slice(0, 200));
    return {
      body: rejectionBody(definition.name, rejection, now),
      log: { ...idOf(dId), status: "Rechazado", results: [rejection] },
    };
  }
  switch (definition.name) {
    case "siRecepDE":
      return recibe(rawBody, dId, ctx);
    case "siRecepLoteDE":
      return recibeLote(payload, dId, ctx);
    case "siResultLoteDE":
      return consultaLote(payload, dId, ctx);
    case "siConsDE":
      return consulta(payload, dId, ctx);
    case "siConsRUC":
      return consultaRuc(payload, dId, ctx);
    case "siRecepEvento":
      return evento(rawBody, dId, ctx);
  }
}
