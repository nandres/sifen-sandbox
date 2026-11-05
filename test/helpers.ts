import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { strToU8, zipSync } from "fflate";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";

import { cdcBody } from "../src/identifiers.js";
import { modulo11 } from "../src/identifiers.js";
import { QR_BASE_TEST, qrHash, qrParameters } from "../src/qr.js";
import { createSandbox, type Sandbox } from "../src/server.js";
import { SOAP12 } from "../src/soap.js";

export const NS = "http://ekuatia.set.gov.py/sifen/xsd";
export const XSD_DIR = resolve("xsd");
export const CSC = "ABCD0000000000000000000000000000";
export const NOW = "2026-11-05T10:00:00";
export const NOW_ISO = `${NOW}-03:00`;

export interface Identity {
  keyPem: string;
  certPem: string;
}

/** Certificado autofirmado generado en cada corrida: el repositorio no guarda claves. */
export function createIdentity(commonName = "PRUEBA", validity = { from: "2020-01-01", to: "2040-01-01" }): Identity {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date(validity.from);
  certificate.validity.notAfter = new Date(validity.to);
  const attributes = [{ name: "commonName", value: commonName }];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return { keyPem: forge.pki.privateKeyToPem(keys.privateKey), certPem: forge.pki.certificateToPem(certificate) };
}

export interface DocumentOptions {
  ruc?: string;
  dv?: string;
  numero?: string;
  emitted?: string;
  signedAt?: string;
  tipoEmision?: string;
  descTipoEmision?: string;
  tipo?: string;
  descTipo?: string;
  timbrado?: string;
  timbradoStart?: string;
  codSeg?: string;
  cscId?: string;
  csc?: string;
  qrBase?: string;
  /** Reemplaza gDatRec; va con qrReceptor. */
  receiverXml?: string;
  qrReceptor?: string;
  total?: string;
  /** Sustituye el CDC calculado. */
  cdc?: string;
  /** Devuelve el XML sin firmar para alterarlo a mano. */
  beforeSign?: (xml: string) => string;
  /** Altera el XML ya firmado. */
  afterSign?: (xml: string) => string;
}

/** Factura electrónica mínima, en el orden de DE_v150.xsd, firmada y con su QR. */
export function buildDocument(identity: Identity, options: DocumentOptions = {}): { xml: string; cdc: string } {
  const ruc = options.ruc ?? "80000001";
  const dv = options.dv ?? String(modulo11(ruc));
  const emitted = options.emitted ?? NOW;
  const numero = options.numero ?? "0000001";
  const tipo = options.tipo ?? "1";
  const tipoEmision = options.tipoEmision ?? "1";
  const codSeg = options.codSeg ?? "000000001";
  const body = cdcBody({
    iTiDE: tipo,
    dRucEm: ruc,
    dDVEmi: dv,
    dEst: "001",
    dPunExp: "001",
    dNumDoc: numero,
    iTipCont: "2",
    fecha: emitted.slice(0, 10).replaceAll("-", ""),
    iTipEmi: tipoEmision,
    dCodSeg: codSeg,
  });
  const dvId = String(modulo11(body));
  const cdc = options.cdc ?? `${body}${dvId}`;

  const unsignedDe =
    `<DE Id="${cdc}"><dDVId>${cdc[43]}</dDVId><dFecFirma>${options.signedAt ?? emitted}</dFecFirma><dSisFact>1</dSisFact>` +
    `<gOpeDE><iTipEmi>${tipoEmision}</iTipEmi><dDesTipEmi>${options.descTipoEmision ?? (tipoEmision === "2" ? "Contingencia" : "Normal")}</dDesTipEmi><dCodSeg>${codSeg}</dCodSeg></gOpeDE>` +
    `<gTimb><iTiDE>${tipo}</iTiDE><dDesTiDE>${options.descTipo ?? "Factura electrónica"}</dDesTiDE><dNumTim>${options.timbrado ?? "12345678"}</dNumTim><dEst>001</dEst><dPunExp>001</dPunExp><dNumDoc>${numero}</dNumDoc><dFeIniT>${options.timbradoStart ?? "2024-01-01"}</dFeIniT></gTimb>` +
    `<gDatGralOpe><dFeEmiDE>${emitted}</dFeEmiDE>` +
    `<gOpeCom><iTipTra>1</iTipTra><dDesTipTra>Venta de mercadería</dDesTipTra><iTImp>1</iTImp><dDesTImp>IVA</dDesTImp><cMoneOpe>PYG</cMoneOpe><dDesMoneOpe>Guarani</dDesMoneOpe></gOpeCom>` +
    `<gEmis><dRucEm>${ruc}</dRucEm><dDVEmi>${dv}</dDVEmi><iTipCont>2</iTipCont><dNomEmi>EMPRESA DE PRUEBA S.A.</dNomEmi><dDirEmi>CALLE PRUEBA 123</dDirEmi><dNumCas>123</dNumCas><cDepEmi>1</cDepEmi><dDesDepEmi>CAPITAL</dDesDepEmi><cCiuEmi>1</cCiuEmi><dDesCiuEmi>ASUNCION (DISTRITO)</dDesCiuEmi><dTelEmi>021000000</dTelEmi><dEmailE>prueba@example.com</dEmailE>` +
    `<gActEco><cActEco>62010</cActEco><dDesActEco>DESARROLLO DE SOFTWARE</dDesActEco></gActEco></gEmis>` +
    (options.receiverXml ?? `<gDatRec><iNatRec>1</iNatRec><iTiOpe>1</iTiOpe><cPaisRec>PRY</cPaisRec><dDesPaisRe>Paraguay</dDesPaisRe><iTiContRec>2</iTiContRec><dRucRec>80000002</dRucRec><dDVRec>${modulo11("80000002")}</dDVRec><dNomRec>CLIENTE DE PRUEBA S.A.</dNomRec></gDatRec>`) +
    `</gDatGralOpe>` +
    `<gDtipDE><gCamFE><iIndPres>1</iIndPres><dDesIndPres>Operación presencial</dDesIndPres></gCamFE>` +
    `<gCamCond><iCondOpe>1</iCondOpe><dDCondOpe>Contado</dDCondOpe><gPaConEIni><iTiPago>1</iTiPago><dDesTiPag>Efectivo</dDesTiPag><dMonTiPag>110000</dMonTiPag><cMoneTiPag>PYG</cMoneTiPag><dDMoneTiPag>Guarani</dDMoneTiPag></gPaConEIni></gCamCond>` +
    `<gCamItem><dCodInt>A1</dCodInt><dDesProSer>SERVICIO DE PRUEBA</dDesProSer><cUniMed>77</cUniMed><dDesUniMed>UNI</dDesUniMed><dCantProSer>1</dCantProSer>` +
    `<gValorItem><dPUniProSer>110000</dPUniProSer><dTotBruOpeItem>110000</dTotBruOpeItem><gValorRestaItem><dDescItem>0</dDescItem><dDescGloItem>0</dDescGloItem><dAntPreUniIt>0</dAntPreUniIt><dAntGloPreUniIt>0</dAntGloPreUniIt><dTotOpeItem>110000</dTotOpeItem></gValorRestaItem></gValorItem>` +
    `<gCamIVA><iAfecIVA>1</iAfecIVA><dDesAfecIVA>Gravado IVA</dDesAfecIVA><dPropIVA>100</dPropIVA><dTasaIVA>10</dTasaIVA><dBasGravIVA>100000</dBasGravIVA><dLiqIVAItem>10000</dLiqIVAItem><dBasExe>0</dBasExe></gCamIVA></gCamItem></gDtipDE>` +
    `<gTotSub><dSubExe>0</dSubExe><dSubExo>0</dSubExo><dSub5>0</dSub5><dSub10>110000</dSub10><dTotOpe>110000</dTotOpe><dTotDesc>0</dTotDesc><dTotDescGlotem>0</dTotDescGlotem><dTotAntItem>0</dTotAntItem><dTotAnt>0</dTotAnt><dPorcDescTotal>0</dPorcDescTotal><dDescTotal>0</dDescTotal><dAnticipo>0</dAnticipo><dRedon>0</dRedon><dTotGralOpe>${options.total ?? "110000"}</dTotGralOpe><dIVA5>0</dIVA5><dIVA10>10000</dIVA10><dLiqTotIVA5>0</dLiqTotIVA5><dLiqTotIVA10>0</dLiqTotIVA10><dTotIVA>10000</dTotIVA><dBaseGrav5>0</dBaseGrav5><dBaseGrav10>100000</dBaseGrav10><dTBasGraIVA>100000</dTBasGraIVA></gTotSub>` +
    `</DE>`;

  let unsigned = `<rDE xmlns="${NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${NS} siRecepDE_v150.xsd"><dVerFor>150</dVerFor>${unsignedDe}</rDE>`;
  if (options.beforeSign) unsigned = options.beforeSign(unsigned);

  const { signed, digest } = signElement(unsigned, "DE", identity);

  const cscId = options.cscId ?? "0001";
  const parameters = qrParameters(
    {
      cdc,
      fechaEmision: emitted,
      receptor: options.qrReceptor ?? "dRucRec=80000002",
      totalGeneral: options.total ?? "110000",
      totalIva: "10000",
      items: 1,
      digest,
    },
    cscId,
  );
  const url = `${options.qrBase ?? QR_BASE_TEST}${parameters}&cHashQR=${qrHash(parameters, options.csc ?? CSC)}`;
  let xml = signed.replace("</rDE>", `<gCamFuFD><dCarQR>${url.replaceAll("&", "&amp;")}</dCarQR></gCamFuFD></rDE>`);
  if (options.afterSign) xml = options.afterSign(xml);
  return { xml, cdc };
}

export function signElement(xml: string, localName: string, identity: Identity): { signed: string; digest: string } {
  const signer = new SignedXml({
    privateKey: identity.keyPem,
    publicCert: identity.certPem,
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  });
  signer.addReference({
    xpath: `//*[local-name(.)='${localName}']`,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
  });
  signer.computeSignature(xml, { location: { reference: `//*[local-name(.)='${localName}']`, action: "after" } });
  const signed = signer.getSignedXml();
  const digest = /<DigestValue>([^<]+)<\/DigestValue>/.exec(signed)?.[1] ?? "";
  return { signed, digest };
}

export function buildCancelEvent(identity: Identity, cdc: string, signedAt = NOW): string {
  const unsigned =
    `<rGesEve xmlns="${NS}"><rEve Id="1"><dFecFirma>${signedAt}</dFecFirma><dVerFor>150</dVerFor>` +
    `<gGroupTiEvt><rGeVeCan><Id>${cdc}</Id><mOtEve>Prueba de cancelacion</mOtEve></rGeVeCan></gGroupTiEvt></rEve></rGesEve>`;
  return signElement(unsigned, "rEve", identity).signed;
}

export const envelope = (inner: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${SOAP12}"><soap:Header/><soap:Body>${inner}</soap:Body></soap:Envelope>`;

export const recibeRequest = (rde: string, dId = "1"): string =>
  envelope(`<rEnviDe xmlns="${NS}"><dId>${dId}</dId><xDE>${rde}</xDE></rEnviDe>`);

export const loteRequest = (documents: string[], dId = "2"): string => {
  const zipped = zipSync({ "lote.xml": strToU8(`<rLoteDE xmlns="${NS}">${documents.join("")}</rLoteDE>`) });
  return envelope(`<rEnvioLote xmlns="${NS}"><dId>${dId}</dId><xDE>${Buffer.from(zipped).toString("base64")}</xDE></rEnvioLote>`);
};

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
