// Genera documentos firmados de ejemplo, para probar el simulador sin tener todavía
// firma ni QR resueltos. Los certificados se crean al vuelo: el repositorio no guarda claves.

import { strToU8, zipSync } from "fflate";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";

import { cdcBody, modulo11 } from "./identifiers.js";
import { QR_BASE_TEST, qrHash, qrParameters } from "./qr.js";
import { SOAP12 } from "./soap.js";
import { SIFEN_NS } from "./xml.js";

const DEFAULT_CSC = "ABCD0000000000000000000000000000";
const TEST_LEGEND = "DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA";

export interface Identity {
  keyPem: string;
  certPem: string;
}

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
  emitted: string;
  ruc?: string;
  dv?: string;
  numero?: string;
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
  /** Monto de la factura. Todos los montos se calculan a partir de este, IVA incluido al 10 %. */
  total?: string;
  /** Pone en dTotGralOpe y en el QR un total que no cierra con los ítems. */
  declaredTotal?: string;
  /** Reemplaza dTotIVA en el QR, para documentos armados a mano. */
  qrTotalIva?: string;
  /** Usa la leyenda que pide la Guía de Pruebas en el nombre del emisor y el primer ítem. */
  legend?: boolean;
  /** Sustituye el CDC calculado. */
  cdc?: string;
  /** Altera el XML antes de firmarlo. */
  beforeSign?: (xml: string) => string;
  /** Altera el XML ya firmado. */
  afterSign?: (xml: string) => string;
}

function clean(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

/** Factura electrónica mínima, en el orden de DE_v150.xsd, firmada y con su QR. */
export function buildDocument(identity: Identity, options: DocumentOptions): { xml: string; cdc: string } {
  const ruc = options.ruc ?? "80000001";
  const dv = options.dv ?? String(modulo11(ruc));
  const emitted = options.emitted;
  const numero = options.numero ?? "0000001";
  const tipo = options.tipo ?? "1";
  const tipoEmision = options.tipoEmision ?? "1";
  const codSeg = options.codSeg ?? "000000001";
  const emisor = options.legend ? TEST_LEGEND : "EMPRESA DE PRUEBA S.A.";
  const producto = options.legend ? TEST_LEGEND : "SERVICIO DE PRUEBA";

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
  const cdc = options.cdc ?? `${body}${modulo11(body)}`;

  const total = options.total ?? "110000";
  const amount = Number(total);
  const base = amount / 1.1;
  const vat = base * 0.1;
  const itemBase = clean(base);
  const itemVat = clean(vat);
  const totalVat = String(Math.round(vat));
  const totalBase = String(Math.round(base));
  const declared = options.declaredTotal ?? total;

  const unsignedDe =
    `<DE Id="${cdc}"><dDVId>${cdc[43]}</dDVId><dFecFirma>${options.signedAt ?? emitted}</dFecFirma><dSisFact>1</dSisFact>` +
    `<gOpeDE><iTipEmi>${tipoEmision}</iTipEmi><dDesTipEmi>${options.descTipoEmision ?? (tipoEmision === "2" ? "Contingencia" : "Normal")}</dDesTipEmi><dCodSeg>${codSeg}</dCodSeg></gOpeDE>` +
    `<gTimb><iTiDE>${tipo}</iTiDE><dDesTiDE>${options.descTipo ?? "Factura electrónica"}</dDesTiDE><dNumTim>${options.timbrado ?? "12345678"}</dNumTim><dEst>001</dEst><dPunExp>001</dPunExp><dNumDoc>${numero}</dNumDoc><dFeIniT>${options.timbradoStart ?? "2024-01-01"}</dFeIniT></gTimb>` +
    `<gDatGralOpe><dFeEmiDE>${emitted}</dFeEmiDE>` +
    `<gOpeCom><iTipTra>1</iTipTra><dDesTipTra>Venta de mercadería</dDesTipTra><iTImp>1</iTImp><dDesTImp>IVA</dDesTImp><cMoneOpe>PYG</cMoneOpe><dDesMoneOpe>Guarani</dDesMoneOpe></gOpeCom>` +
    `<gEmis><dRucEm>${ruc}</dRucEm><dDVEmi>${dv}</dDVEmi><iTipCont>2</iTipCont><dNomEmi>${emisor}</dNomEmi><dDirEmi>CALLE PRUEBA 123</dDirEmi><dNumCas>123</dNumCas><cDepEmi>1</cDepEmi><dDesDepEmi>CAPITAL</dDesDepEmi><cCiuEmi>1</cCiuEmi><dDesCiuEmi>ASUNCION (DISTRITO)</dDesCiuEmi><dTelEmi>021000000</dTelEmi><dEmailE>prueba@example.com</dEmailE>` +
    `<gActEco><cActEco>62010</cActEco><dDesActEco>DESARROLLO DE SOFTWARE</dDesActEco></gActEco></gEmis>` +
    (options.receiverXml ??
      `<gDatRec><iNatRec>1</iNatRec><iTiOpe>1</iTiOpe><cPaisRec>PRY</cPaisRec><dDesPaisRe>Paraguay</dDesPaisRe><iTiContRec>2</iTiContRec><dRucRec>80000002</dRucRec><dDVRec>${modulo11("80000002")}</dDVRec><dNomRec>CLIENTE DE PRUEBA S.A.</dNomRec></gDatRec>`) +
    `</gDatGralOpe>` +
    `<gDtipDE><gCamFE><iIndPres>1</iIndPres><dDesIndPres>Operación presencial</dDesIndPres></gCamFE>` +
    `<gCamCond><iCondOpe>1</iCondOpe><dDCondOpe>Contado</dDCondOpe><gPaConEIni><iTiPago>1</iTiPago><dDesTiPag>Efectivo</dDesTiPag><dMonTiPag>${total}</dMonTiPag><cMoneTiPag>PYG</cMoneTiPag><dDMoneTiPag>Guarani</dDMoneTiPag></gPaConEIni></gCamCond>` +
    `<gCamItem><dCodInt>A1</dCodInt><dDesProSer>${producto}</dDesProSer><cUniMed>77</cUniMed><dDesUniMed>UNI</dDesUniMed><dCantProSer>1</dCantProSer>` +
    `<gValorItem><dPUniProSer>${total}</dPUniProSer><dTotBruOpeItem>${total}</dTotBruOpeItem><gValorRestaItem><dDescItem>0</dDescItem><dDescGloItem>0</dDescGloItem><dAntPreUniIt>0</dAntPreUniIt><dAntGloPreUniIt>0</dAntGloPreUniIt><dTotOpeItem>${total}</dTotOpeItem></gValorRestaItem></gValorItem>` +
    `<gCamIVA><iAfecIVA>1</iAfecIVA><dDesAfecIVA>Gravado IVA</dDesAfecIVA><dPropIVA>100</dPropIVA><dTasaIVA>10</dTasaIVA><dBasGravIVA>${itemBase}</dBasGravIVA><dLiqIVAItem>${itemVat}</dLiqIVAItem><dBasExe>0</dBasExe></gCamIVA></gCamItem></gDtipDE>` +
    `<gTotSub><dSubExe>0</dSubExe><dSubExo>0</dSubExo><dSub5>0</dSub5><dSub10>${total}</dSub10><dTotOpe>${total}</dTotOpe><dTotDesc>0</dTotDesc><dTotDescGlotem>0</dTotDescGlotem><dTotAntItem>0</dTotAntItem><dTotAnt>0</dTotAnt><dPorcDescTotal>0</dPorcDescTotal><dDescTotal>0</dDescTotal><dAnticipo>0</dAnticipo><dRedon>0</dRedon><dTotGralOpe>${declared}</dTotGralOpe><dIVA5>0</dIVA5><dIVA10>${totalVat}</dIVA10><dLiqTotIVA5>0</dLiqTotIVA5><dLiqTotIVA10>0</dLiqTotIVA10><dTotIVA>${totalVat}</dTotIVA><dBaseGrav5>0</dBaseGrav5><dBaseGrav10>${totalBase}</dBaseGrav10><dTBasGraIVA>${totalBase}</dTBasGraIVA></gTotSub>` +
    `</DE>`;

  let unsigned = `<rDE xmlns="${SIFEN_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SIFEN_NS} siRecepDE_v150.xsd"><dVerFor>150</dVerFor>${unsignedDe}</rDE>`;
  if (options.beforeSign) unsigned = options.beforeSign(unsigned);

  const { signed, digest } = signElement(unsigned, "DE", identity);

  const cscId = options.cscId ?? "0001";
  const parameters = qrParameters(
    {
      cdc,
      fechaEmision: emitted,
      receptor: options.qrReceptor ?? "dRucRec=80000002",
      totalGeneral: declared,
      totalIva: options.qrTotalIva ?? totalVat,
      items: 1,
      digest,
    },
    cscId,
  );
  const url = `${options.qrBase ?? QR_BASE_TEST}${parameters}&cHashQR=${qrHash(parameters, options.csc ?? DEFAULT_CSC)}`;
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

export const envelope = (inner: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${SOAP12}"><soap:Header/><soap:Body>${inner}</soap:Body></soap:Envelope>`;

export const recibeRequest = (rde: string, dId = "1"): string =>
  envelope(`<rEnviDe xmlns="${SIFEN_NS}"><dId>${dId}</dId><xDE>${rde}</xDE></rEnviDe>`);

export const loteRequest = (documents: string[], dId = "2"): string => {
  const zipped = zipSync({ "lote.xml": strToU8(`<rLoteDE xmlns="${SIFEN_NS}">${documents.join("")}</rLoteDE>`) });
  return envelope(`<rEnvioLote xmlns="${SIFEN_NS}"><dId>${dId}</dId><xDE>${Buffer.from(zipped).toString("base64")}</xDE></rEnvioLote>`);
};

export interface Scenario {
  name: string;
  description: string;
  path: string;
  expected: string;
  options?: Partial<DocumentOptions>;
  /** El ejemplo arma un lote de 3 facturas válidas. */
  lot?: boolean;
}

const RECIBE = "/de/ws/sync/recibe.wsdl";

export const SCENARIOS: readonly Scenario[] = [
  { name: "factura-valida", description: "Factura correcta", path: RECIBE, expected: "0260" },
  {
    name: "firma-alterada",
    description: "Contenido cambiado después de firmar",
    path: RECIBE,
    expected: "0141",
    options: { afterSign: (xml) => xml.replace("<dNumCas>123</dNumCas>", "<dNumCas>124</dNumCas>") },
  },
  { name: "total-incorrecto", description: "Total general que no cierra con los ítems", path: RECIBE, expected: "2365", options: { declaredTotal: "110001" } },
  { name: "qr-incorrecto", description: "QR calculado con otro CSC", path: RECIBE, expected: "2501", options: { csc: "OTRO0000000000000000000000000000" } },
  { name: "qr-produccion", description: "QR que apunta a la consulta de producción", path: RECIBE, expected: "2502", options: { qrBase: "https://ekuatia.set.gov.py/consultas/qr?" } },
  { name: "ruc-incorrecto", description: "Dígito verificador del RUC equivocado", path: RECIBE, expected: "1253", options: { dv: "9" } },
  { name: "contingencia", description: "Emisión en contingencia, todavía no habilitada", path: RECIBE, expected: "1050", options: { tipoEmision: "2" } },
  { name: "lote-valido", description: "Lote de 3 facturas correctas", path: "/de/ws/async/recibe-lote.wsdl", expected: "0300", lot: true },
];

export const SAMPLE_NOTICE = "documento ficticio sin valor fiscal";

export class SampleGenerator {
  private identity: Identity | undefined;
  private sequence = 0;

  /** Hora local de Paraguay de un instante, sin zona horaria, como pide el formato del DE. */
  private localDate(now: number): string {
    return new Date(now - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
  }

  private document(now: number, options: Partial<DocumentOptions> = {}): string {
    this.identity ??= createIdentity("CERTIFICADO DE PRUEBA - SIFEN SANDBOX");
    this.sequence += 1;
    return buildDocument(this.identity, {
      emitted: this.localDate(now),
      numero: String(this.sequence).padStart(7, "0"),
      codSeg: String(100_000_000 + this.sequence),
      legend: true,
      ...options,
    }).xml;
  }

  /** Arma el sobre SOAP listo para enviar. Cada llamada usa un número nuevo, así no se duplica. */
  request(scenario: Scenario, now: number): string {
    if (scenario.lot) return loteRequest([this.document(now), this.document(now), this.document(now)]);
    return recibeRequest(this.document(now, scenario.options));
  }

  describe(scenario: Scenario): Omit<Scenario, "options" | "lot"> {
    const { options: _options, lot: _lot, ...rest } = scenario;
    return rest;
  }
}
