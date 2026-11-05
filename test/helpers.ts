import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import {
  buildDocument as buildSample,
  createIdentity,
  envelope,
  loteRequest,
  recibeRequest,
  signElement,
  type DocumentOptions,
  type Identity,
} from "../src/sample.js";
import { createSandbox, type Sandbox } from "../src/server.js";

export { createIdentity, envelope, loteRequest, recibeRequest, signElement, type Identity };

export const NS = "http://ekuatia.set.gov.py/sifen/xsd";
export const XSD_DIR = resolve("xsd");
export const NOW = "2026-11-05T10:00:00";
export const NOW_ISO = `${NOW}-03:00`;

export const buildDocument = (identity: Identity, options: Partial<DocumentOptions> = {}): { xml: string; cdc: string } =>
  buildSample(identity, { emitted: NOW, ...options });

export function buildCancelEvent(identity: Identity, cdc: string, signedAt = NOW): string {
  const unsigned =
    `<rGesEve xmlns="${NS}"><rEve Id="1"><dFecFirma>${signedAt}</dFecFirma><dVerFor>150</dVerFor>` +
    `<gGroupTiEvt><rGeVeCan><Id>${cdc}</Id><mOtEve>Prueba de cancelacion</mOtEve></rGeVeCan></gGroupTiEvt></rEve></rGesEve>`;
  return signElement(unsigned, "rEve", identity).signed;
}

export const consultaLoteRequest = (lot: string): string =>
  envelope(`<rEnviConsLoteDe xmlns="${NS}"><dId>3</dId><dProtConsLote>${lot}</dProtConsLote></rEnviConsLoteDe>`);

export const consultaLotePorCdcRequest = (cdc: string): string =>
  envelope(`<rEnviConsLoteDe xmlns="${NS}"><dId>3</dId><dCDC>${cdc}</dCDC></rEnviConsLoteDe>`);

export const consultaRequest = (cdc: string): string =>
  envelope(`<rEnviConsDeRequest xmlns="${NS}"><dId>4</dId><dCDC>${cdc}</dCDC></rEnviConsDeRequest>`);

export const consultaRucRequest = (ruc: string): string =>
  envelope(`<rEnviConsRUC xmlns="${NS}"><dId>5</dId><dRUCCons>${ruc}</dRUCCons></rEnviConsRUC>`);

export const eventoRequest = (event: string): string =>
  envelope(`<rEnviEventoDe xmlns="${NS}"><dId>6</dId><dEvReg><gGroupGesEve>${event}</gGroupGesEve></dEvReg></rEnviEventoDe>`);

export const PATHS = {
  recibe: "/de/ws/sync/recibe.wsdl",
  lote: "/de/ws/async/recibe-lote.wsdl",
  consultaLote: "/de/ws/consultas/consulta-lote.wsdl",
  consulta: "/de/ws/consultas/consulta.wsdl",
  consultaRuc: "/de/ws/consultas/consulta-ruc.wsdl",
  evento: "/de/ws/eventos/evento.wsdl",
} as const;

export interface Running {
  sandbox: Sandbox;
  base: string;
  post: (path: string, body: string) => Promise<{ status: number; body: string }>;
  control: (path: string, data?: unknown) => Promise<{ status: number; json: any }>;
  close: () => Promise<void>;
}

export async function start(lotDelayMs = 0): Promise<Running> {
  const sandbox = createSandbox({ xsdDirectory: XSD_DIR, lotDelayMs });
  const server: Server = createServer(sandbox.listener);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  sandbox.store.setClock(NOW_ISO);
  return {
    sandbox,
    base,
    async post(path, body) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
        body,
      });
      return { status: response.status, body: await response.text() };
    },
    async control(path, data) {
      const response = await fetch(`${base}/__sandbox${path}`, data === undefined ? {} : { method: "POST", body: JSON.stringify(data) });
      return { status: response.status, json: await response.json() };
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Saca el contenido de un campo de la respuesta. */
export const field = (xml: string, name: string): string | undefined => new RegExp(`<(?:ns2:)?${name}>([^<]*)</(?:ns2:)?${name}>`).exec(xml)?.[1];
export const fields = (xml: string, name: string): string[] => [...xml.matchAll(new RegExp(`<(?:ns2:)?${name}>([^<]*)</(?:ns2:)?${name}>`, "g"))].map((m) => m[1] ?? "");
