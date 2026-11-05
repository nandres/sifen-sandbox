import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
    const inner = /<rRetEnviDe[\s\S]*<\/rRetEnviDe>/.exec(body)?.[0] ?? "";
    const result = await new SchemaSet(XSD_DIR).validate("WS_SiRecepDE_v150.xsd", inner);
    expect(result.errors).toEqual([]);
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

  it("0100 si no cumple el esquema, y dice por qué", async () => {
    const result = await send({ afterSign: (xml) => xml.replace("<dSisFact>1</dSisFact>", "") });
    expect(result.code).toBe("0100");
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
    [{ facturaElectronica: false }, "1251"],
    [{ estado: "SUS" }, "1252"],
    [{ usaServicioSincrono: false }, "1264"],
  ])("%j da %s", async (state, code) => {
    await sandbox.control("/ruc", { ruc: "80000001", ...state });
    expect((await send()).code).toBe(code);
  });

  it("1050 si se usa contingencia", async () => {
    expect((await send({ tipoEmision: "2" })).code).toBe("1050");
  });

  it("1051 si la descripción de la emisión es válida pero de otro código", async () => {
    expect((await send({ descTipoEmision: "Contingencia" })).code).toBe("1051");
  });

  it("0100 si la descripción de la emisión no existe: el XSD la frena antes", async () => {
    expect((await send({ descTipoEmision: "Otra" })).code).toBe("0100");
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

  it("2501 si el IdCSC no está cargado", async () => {
    expect((await send({ cscId: "0002" })).code).toBe("2501");
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

function createDv(ruc: string): string {
  const { xml } = buildDocument(identity, { ruc });
  return /<dDVEmi>(\d)<\/dDVEmi>/.exec(xml)?.[1] ?? "";
}
