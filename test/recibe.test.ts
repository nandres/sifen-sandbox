import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { modulo11 } from "../src/identifiers.js";
import { SchemaSet } from "../src/xsd.js";
import { PATHS, XSD_DIR, buildDocument, createIdentity, envelope, field, recibeRequest, start, type Identity, type Running } from "./helpers.js";

let sandbox: Running;
let identity: Identity;

beforeAll(async () => {
  identity = createIdentity();
  sandbox = await start();
});
afterAll(() => sandbox.close());
beforeEach(async () => {
  sandbox.sandbox.store.reset();
  sandbox.sandbox.store.setClock("2026-11-05T10:00:00-03:00");
});

const send = async (options: Parameters<typeof buildDocument>[1] = {}) => {
  const { xml, cdc } = buildDocument(identity, options);
  const response = await sandbox.post(PATHS.recibe, recibeRequest(xml));
  return { ...response, cdc, code: field(response.body, "dCodRes"), status_: field(response.body, "dEstRes") };
};

describe("documento válido", () => {
  it("el documento de prueba cumple el XSD oficial", async () => {
    const { xml } = buildDocument(identity);
    const result = await new SchemaSet(XSD_DIR).validate("siRecepDE_v150.xsd", xml);
    expect(result.errors).toEqual([]);
  });

  it("aprueba con 0260 y devuelve protocolo, CDC y digest", async () => {
    const result = await send();
    expect(result.status).toBe(200);
    expect(result.code).toBe("0260");
    expect(result.status_).toBe("Aprobado");
    expect(field(result.body, "Id")).toBe(result.cdc);
    expect(field(result.body, "dProtAut")).toMatch(/^\d{10}$/);
    expect(field(result.body, "dDigVal")).toBeTruthy();
  });

  it("la respuesta cumple el esquema oficial del servicio", async () => {
    const { body } = await send();
    const inner = /<ns2:rRetEnviDe[\s\S]*<\/ns2:rRetEnviDe>/.exec(body)?.[0] ?? "";
    const result = await new SchemaSet(XSD_DIR).validate("WS_SiRecepDE_v150.xsd", inner);
    expect(result.errors).toEqual([]);
  });

  it("responde con el prefijo ns2, como las respuestas reales de la Guía", async () => {
    const { body } = await send();
    expect(body).toContain('<ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">');
    expect(body).toContain("<ns2:dCodRes>0260</ns2:dCodRes>");
  });

  it("acepta pedidos con prefijo en el envoltorio, como los ejemplos de la Guía", async () => {
    const { xml } = buildDocument(identity);
    const request =
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsd="http://ekuatia.set.gov.py/sifen/xsd"><soap:Header/><soap:Body>' +
      `<xsd:rEnviDe><xsd:dId>1</xsd:dId><xsd:xDE>${xml}</xsd:xDE></xsd:rEnviDe></soap:Body></soap:Envelope>`;
    const response = await sandbox.post(PATHS.recibe, request);
    expect(field(response.body, "dCodRes")).toBe("0260");
  });

  it("anota en el historial la leyenda del ambiente oficial de pruebas", async () => {
    await send();
    const { json } = await sandbox.control("/requests");
    expect(json[0].notes[0]).toContain("SIN VALOR COMERCIAL");
  });

  it("identifica la respuesta como simulada", async () => {
    const { xml } = buildDocument(identity);
    const response = await fetch(`${sandbox.base}${PATHS.recibe}`, { method: "POST", body: recibeRequest(xml) });
    expect(response.headers.get("x-sifen-sandbox")).toBe("simulated");
  });

  it("acepta la ruta con el error de tipeo del manual (.wsd)", async () => {
    const { xml } = buildDocument(identity);
    const response = await sandbox.post("/de/ws/sync/recibe.wsd", recibeRequest(xml));
    expect(field(response.body, "dCodRes")).toBe("0260");
  });
});

describe("forma del mensaje", () => {
  it("0160 si el XML está malformado", async () => {
    const response = await sandbox.post(PATHS.recibe, "<soap:Envelope><roto");
    expect(field(response.body, "dCodRes")).toBe("0160");
  });

  it("0101 si la raíz no corresponde al servicio", async () => {
    const response = await sandbox.post(PATHS.recibe, envelope(`<otra xmlns="x"/>`));
    expect(field(response.body, "dCodRes")).toBe("0101");
  });

  it("0107 si la codificación no es UTF-8", async () => {
    const response = await sandbox.post(PATHS.recibe, `<?xml version="1.0" encoding="ISO-8859-1"?><a/>`);
    expect(field(response.body, "dCodRes")).toBe("0107");
  });

  it("0200 si supera los 1000 KB", async () => {
    const response = await sandbox.post(PATHS.recibe, `<a>${"x".repeat(1_000_001)}</a>`);
    expect(field(response.body, "dCodRes")).toBe("0200");
  });

  it("0105 si hay espacios entre campos", async () => {
    const result = await send({ afterSign: (xml) => xml.replace("<dVerFor>", "\n  <dVerFor>") });
    expect(result.code).toBe("0105");
  });

  it("0106 si se usa un prefijo", async () => {
    const result = await send({ afterSign: (xml) => xml.replace("<dVerFor>150</dVerFor>", "<x:dVerFor xmlns:x='http://ekuatia.set.gov.py/sifen/xsd'>150</x:dVerFor>") });
    expect(result.code).toBe("0106");
  });

  it("0160 si el DE no cumple el esquema, como el ejemplo de la Guía, y dice por qué", async () => {
    const result = await send({ afterSign: (xml) => xml.replace("<dSisFact>1</dSisFact>", "") });
    expect(result.code).toBe("0160");
    expect(field(result.body, "dMsgRes")).toContain("sandbox:");
  });

  it("0163 si la versión no es 150", async () => {
    const result = await send({ afterSign: (xml) => xml.replace("<dVerFor>150</dVerFor>", "<dVerFor>141</dVerFor>") });
    expect(result.code).toBe("0163");
  });
});

describe("firma", () => {
  it("0141 si se altera el contenido firmado", async () => {
    const result = await send({ afterSign: (xml) => xml.replace("SERVICIO DE PRUEBA", "SERVICIO ALTERADO") });
    expect(result.code).toBe("0141");
  });

  it("0141 si se altera el valor de la firma", async () => {
    const result = await send({ afterSign: (xml) => xml.replace(/<SignatureValue>.{8}/, "<SignatureValue>AAAAAAAA") });
    expect(result.code).toBe("0141");
  });

  it.each([
    ["Signature Method", /SignatureMethod Algorithm="[^"]+"/, 'SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"'],
    ["Digest Method", /DigestMethod Algorithm="[^"]+"/, 'DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"'],
    ["Canonicalization Method", /CanonicalizationMethod Algorithm="[^"]+"/, 'CanonicalizationMethod Algorithm="urn:otro"'],
  ])("0140 si %s no es el previsto (NT 16)", async (name, from, to) => {
    const result = await send({ afterSign: (xml) => xml.replace(from, to) });
    expect(result.code).toBe("0140");
    expect(field(result.body, "dMsgRes")).toContain(name);
  });

  it("0120 si el certificado no es válido (NT 16)", async () => {
    const result = await send({ afterSign: (xml) => xml.replace(/<X509Certificate>[^<]+/, "<X509Certificate>AAAA") });
    expect(result.code).toBe("0120");
  });

  it("2450 si el certificado estaba vencido al firmar (NT 16)", async () => {
    const expired = createIdentity("VENCIDO", { from: "2020-01-01", to: "2021-01-01" });
    const { xml } = buildDocument(expired);
    const response = await sandbox.post(PATHS.recibe, recibeRequest(xml));
    expect(field(response.body, "dCodRes")).toBe("2450");
  });

  it("0140 si la referencia no apunta al CDC", async () => {
    const result = await send({ afterSign: (xml) => xml.replace(/URI="#\d+"/, 'URI="#1"') });
    expect(result.code).toBe("0140");
  });
});

describe("CDC", () => {
  it("1003 si el dígito verificador está mal", async () => {
    const { cdc } = buildDocument(identity);
    const wrong = `${cdc.slice(0, 43)}${(Number(cdc[43]) + 1) % 10}`;
    expect((await send({ cdc: wrong })).code).toBe("1003");
  });

  it("1000 si no coincide con los campos", async () => {
    const { cdc } = buildDocument(identity);
    const other = buildDocument(identity, { numero: "0000099" }).cdc;
    expect(other).not.toBe(cdc);
    const result = await send({ cdc: other, beforeSign: (xml) => xml.replace("<dNumDoc>0000001</dNumDoc>", "<dNumDoc>0000002</dNumDoc>") });
    expect(result.code).toBe("1000");
  });

  it("1001 si se manda dos veces el mismo", async () => {
    expect((await send()).code).toBe("0260");
    expect((await send()).code).toBe("1001");
  });

  it("1002 si repite timbrado y número con otro CDC", async () => {
    expect((await send()).code).toBe("0260");
    expect((await send({ codSeg: "000000002" })).code).toBe("1002");
  });
});

describe("fechas", () => {
  it("1004 si la firma es posterior a la hora de SIFEN", async () => {
    expect((await send({ signedAt: "2026-11-05T10:00:01" })).code).toBe("1004");
  });

  it("1150 si la emisión tiene más de 720 horas", async () => {
    expect((await send({ emitted: "2026-10-05T09:59:00" })).code).toBe("1150");
  });

  it("acepta exactamente 720 horas", async () => {
    const result = await send({ emitted: "2026-10-06T10:00:00" });
    expect(result.code).toBe("1005");
    expect(result.status_).toBe("Aprobado con observación");
  });

  it("1151 si la emisión está más de 120 horas adelantada", async () => {
    expect((await send({ emitted: "2026-11-10T10:00:01", signedAt: "2026-11-05T09:00:00" })).code).toBe("1151");
  });

  it("1156 si es anterior al lanzamiento del sistema", async () => {
    sandbox.sandbox.store.setClock("2018-11-20T10:00:00-03:00");
    expect((await send({ emitted: "2018-11-20T09:00:00", timbradoStart: "2018-06-01" })).code).toBe("1156");
  });

  it("1005 aprueba con observación pasadas las 72 horas desde la firma", async () => {
    const result = await send({ emitted: "2026-11-01T09:00:00" });
    expect(result.code).toBe("1005");
    expect(result.status_).toBe("Aprobado con observación");
    expect(field(result.body, "dProtAut")).toBeTruthy();
  });

  it("aprueba sin observación justo a las 72 horas", async () => {
    expect((await send({ emitted: "2026-11-02T10:00:00" })).code).toBe("0260");
  });
});

describe("emisor y timbrado", () => {
  it("1253 si el DV del RUC no corresponde", async () => {
    const wrong = String((Number(createDv("80000001")) + 1) % 10);
    expect((await send({ dv: wrong })).code).toBe("1253");
  });

  it.each([
    [{ existe: false }, "1250"],
    [{ estado: "SUS" }, "1252"],
    [{ usaServicioSincrono: false }, "1264"],
  ])("%j da %s", async (state, code) => {
    await sandbox.control("/ruc", { ruc: "80000001", ...state });
    expect((await send()).code).toBe(code);
  });

  it("la NT 4 eliminó 1251: no bloquea a quien no figura como facturador", async () => {
    await sandbox.control("/ruc", { ruc: "80000001", facturaElectronica: false });
    expect((await send()).code).toBe("0260");
  });

  it("1050 si se usa contingencia", async () => {
    expect((await send({ tipoEmision: "2" })).code).toBe("1050");
  });

  it("1051 si la descripción de la emisión es válida pero de otro código", async () => {
    expect((await send({ descTipoEmision: "Contingencia" })).code).toBe("1051");
  });

  it("0160 si la descripción de la emisión no existe: el XSD la frena antes", async () => {
    expect((await send({ descTipoEmision: "Otra" })).code).toBe("0160");
  });

  it("1100 si la descripción del tipo es válida pero de otro código", async () => {
    expect((await send({ descTipo: "Autofactura electrónica" })).code).toBe("1100");
  });

  it("1103 si el timbrado todavía no estaba vigente", async () => {
    expect((await send({ timbradoStart: "2026-12-01" })).code).toBe("1103");
  });

  it("1101 y 1104 con timbrados cargados", async () => {
    await sandbox.control("/timbrado", { ruc: "80000001", numero: "99999999" });
    expect((await send()).code).toBe("1101");
    await sandbox.control("/timbrado", { ruc: "80000001", numero: "12345678", activo: false });
    expect((await send()).code).toBe("1104");
  });
});

describe("QR", () => {
  it("2501 si el hash se calculó con otro CSC", async () => {
    expect((await send({ csc: "OTRO0000000000000000000000000000" })).code).toBe("2501");
  });

  it("2501 si el IdCSC no está vigente (NT 10)", async () => {
    expect((await send({ cscId: "0003" })).code).toBe("2501");
  });

  it("acepta el segundo CSC genérico de la Guía de Pruebas", async () => {
    expect((await send({ cscId: "0002", csc: "EFGH0000000000000000000000000000" })).code).toBe("0260");
  });

  it("2502 si la URL usa www: la NT 10 la dejó sin www", async () => {
    expect((await send({ qrBase: "https://www.ekuatia.set.gov.py/consultas-test/qr?" })).code).toBe("2502");
  });

  it("2502 si apunta a producción", async () => {
    expect((await send({ qrBase: "https://ekuatia.set.gov.py/consultas/qr?" })).code).toBe("2502");
  });

  it("2502 si la URL es otra", async () => {
    expect((await send({ qrBase: "https://example.com/qr?" })).code).toBe("2502");
  });

  it("2500 si los datos del QR no coinciden con el XML", async () => {
    const result = await send({ afterSign: (xml) => xml.replace("dTotGralOpe=110000", "dTotGralOpe=110001") });
    expect(result.code).toBe("2500");
  });
});

describe("receptor y operación", () => {
  const receiver = (fields: string): string => `<gDatRec>${fields}<dNomRec>Sin Nombre</dNomRec></gDatRec>`;
  const PAIS = "<cPaisRec>PRY</cPaisRec><dDesPaisRe>Paraguay</dDesPaisRe>";
  const INNOMINADO = "<iTipIDRec>5</iTipIDRec><dDTipIDRec>Innominado</dDTipIDRec><dNumIDRec>0</dNumIDRec>";
  const b2cInnominado = receiver(`<iNatRec>2</iNatRec><iTiOpe>2</iTiOpe>${PAIS}${INNOMINADO}`);
  const qrReceptor = "dNumIDRec=0";

  it("acepta un consumidor final innominado por debajo del límite", async () => {
    expect((await send({ receiverXml: b2cInnominado, qrReceptor })).code).toBe("0260");
  });

  it("1321 desde 7.000.000 en 2025 o después (NT 24)", async () => {
    expect((await send({ receiverXml: b2cInnominado, qrReceptor, total: "7000000" })).code).toBe("1321");
    expect((await send({ receiverXml: b2cInnominado, qrReceptor, total: "6999999" })).code).toBe("0260");
  });

  it("1321 usa 35.000.000 durante 2024 (NT 21)", async () => {
    sandbox.sandbox.store.setClock("2024-06-01T10:00:00-03:00");
    const date = { emitted: "2024-06-01T09:00:00" };
    expect((await send({ ...date, receiverXml: b2cInnominado, qrReceptor, total: "35000000" })).code).toBe("1321");
    expect((await send({ ...date, receiverXml: b2cInnominado, qrReceptor, total: "34999999" })).code).toBe("0260");
  });

  it("1321 usa 60.000.000 antes de 2024 (Manual)", async () => {
    sandbox.sandbox.store.setClock("2023-06-01T10:00:00-03:00");
    const date = { emitted: "2023-06-01T09:00:00", timbradoStart: "2023-01-01" };
    expect((await send({ ...date, receiverXml: b2cInnominado, qrReceptor, total: "60000000" })).code).toBe("1321");
    expect((await send({ ...date, receiverXml: b2cInnominado, qrReceptor, total: "59999999" })).code).toBe("0260");
  });

  it("1321 no aplica a muestras médicas", async () => {
    const result = await send({
      receiverXml: b2cInnominado,
      qrReceptor,
      total: "7000000",
      beforeSign: (xml) => xml.replace("<iTipTra>1</iTipTra><dDesTipTra>Venta de mercadería</dDesTipTra>", "<iTipTra>13</iTipTra><dDesTipTra>Muestras médicas (Art. 3 RG 24/2014)</dDesTipTra>"),
    });
    expect(result.code).toBe("0260");
  });

  it("1333 si innominado no es B2C (NT 23)", async () => {
    const receiverXml = receiver(`<iNatRec>2</iNatRec><iTiOpe>4</iTiOpe>${PAIS}${INNOMINADO}`);
    expect((await send({ receiverXml, qrReceptor })).code).toBe("1333");
  });

  it("1300 si un no contribuyente tiene operación B2B (NT 10)", async () => {
    const receiverXml = receiver(`<iNatRec>2</iNatRec><iTiOpe>1</iTiOpe>${PAIS}${INNOMINADO}`);
    expect((await send({ receiverXml, qrReceptor })).code).toBe("1300");
  });

  it("1335 si un no contribuyente no informa el tipo de documento (NT 23)", async () => {
    const receiverXml = receiver(`<iNatRec>2</iNatRec><iTiOpe>2</iTiOpe>${PAIS}`);
    expect((await send({ receiverXml, qrReceptor })).code).toBe("1335");
  });

  it("1314 si un no contribuyente no informa el número (NT 23)", async () => {
    const receiverXml = receiver(`<iNatRec>2</iNatRec><iTiOpe>2</iTiOpe>${PAIS}<iTipIDRec>1</iTipIDRec><dDTipIDRec>Cédula paraguaya</dDTipIDRec>`);
    expect((await send({ receiverXml, qrReceptor })).code).toBe("1314");
  });

  it("1334 si un contribuyente informa número de documento (NT 23)", async () => {
    const receiverXml = `<gDatRec><iNatRec>1</iNatRec><iTiOpe>1</iTiOpe>${PAIS}<iTiContRec>2</iTiContRec><dRucRec>80000002</dRucRec><dDVRec>${modulo11("80000002")}</dDVRec><iTipIDRec>1</iTipIDRec><dDTipIDRec>Cédula paraguaya</dDTipIDRec><dNumIDRec>1234567</dNumIDRec><dNomRec>Cliente</dNomRec></gDatRec>`;
    expect((await send({ receiverXml })).code).toBe("1334");
  });

  it("1216 si informa tipo de transacción donde no corresponde (NT 6)", async () => {
    const result = await send({ tipo: "5", descTipo: "Nota de crédito electrónica" });
    expect(result.code).toBe("1216");
  });

  it("1213 si una autofactura no está en guaraníes (NT 12)", async () => {
    const result = await send({
      tipo: "4",
      descTipo: "Autofactura electrónica",
      beforeSign: (xml) => xml.replace("<cMoneOpe>PYG</cMoneOpe><dDesMoneOpe>Guarani</dDesMoneOpe>", "<cMoneOpe>USD</cMoneOpe><dDesMoneOpe>US Dollar</dDesMoneOpe>"),
    });
    expect(result.code).toBe("1213");
  });
});

function createDv(ruc: string): string {
  const { xml } = buildDocument(identity, { ruc });
  return /<dDVEmi>(\d)<\/dDVEmi>/.exec(xml)?.[1] ?? "";
}
