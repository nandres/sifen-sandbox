import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PATHS, NOW_ISO, buildDocument, createIdentity, field, recibeRequest, start, type Identity, type Running } from "./helpers.js";

let sandbox: Running;
let identity: Identity;

beforeAll(async () => {
  identity = createIdentity();
  sandbox = await start();
});
afterAll(() => sandbox.close());
beforeEach(() => {
  sandbox.sandbox.store.reset();
  sandbox.sandbox.store.setClock(NOW_ISO);
});

const send = async (edit: (xml: string) => string, options: Parameters<typeof buildDocument>[1] = {}) => {
  const { xml } = buildDocument(identity, { ...options, beforeSign: edit });
  const response = await sandbox.post(PATHS.recibe, recibeRequest(xml));
  return { code: field(response.body, "dCodRes"), message: field(response.body, "dMsgRes"), body: response.body };
};
const swap = (from: string, to: string) => (xml: string) => {
  if (!xml.includes(from)) throw new Error(`La prueba no encontró ${from}`);
  return xml.replace(from, to);
};

describe("documento que cierra", () => {
  it("aprueba", async () => {
    expect((await send((xml) => xml)).code).toBe("0260");
  });

  it("calcula bien con un monto que no da justo", async () => {
    expect((await send((xml) => xml, { total: "103333" })).code).toBe("0260");
  });

  it("acepta una diferencia de hasta 50 céntimos (MT §F)", async () => {
    expect((await send(swap("<dSub10>110000</dSub10>", "<dSub10>110000.5</dSub10>"))).code).not.toBe("2359");
    expect((await send(swap("<dSub10>110000</dSub10>", "<dSub10>110000.51</dSub10>"), { numero: "0000002" })).code).toBe("2359");
  });
});

describe("ítems", () => {
  it.each([
    ["1859", "<dTotBruOpeItem>110000</dTotBruOpeItem>", "<dTotBruOpeItem>110002</dTotBruOpeItem>"],
    ["1853", "<dTotOpeItem>110000</dTotOpeItem>", "<dTotOpeItem>110002</dTotOpeItem>"],
    ["1911", "<dBasGravIVA>100000</dBasGravIVA>", "<dBasGravIVA>100002</dBasGravIVA>"],
    ["1913", "<dLiqIVAItem>10000</dLiqIVAItem>", "<dLiqIVAItem>10002</dLiqIVAItem>"],
    ["1921", "<dBasExe>0</dBasExe>", "<dBasExe>5</dBasExe>"],
    ["1904", "<dPropIVA>100</dPropIVA>", "<dPropIVA>50</dPropIVA>"],
  ])("%s", async (code, from, to) => {
    const result = await send(swap(from, to));
    expect(result.code).toBe(code);
    expect(result.message).toContain("sandbox:");
  });

  it("1852 si hay descuento sin porcentaje", async () => {
    const result = await send(swap("<dDescItem>0</dDescItem>", "<dDescItem>1000</dDescItem>"));
    expect(result.code).toBe("1852");
  });

  it("1861 si el porcentaje de descuento no coincide, con 0,8 de margen", async () => {
    const edit = (percent: string) => (xml: string) =>
      xml.replace("<dDescItem>0</dDescItem>", `<dDescItem>11000</dDescItem><dPorcDesIt>${percent}</dPorcDesIt>`);
    expect((await send(edit("12"))).code).toBe("1861");
    expect((await send(edit("10.8"))).code).toBe("1853"); // el porcentaje pasa; sigue el total del ítem
  });

  it("1853 respeta el descuento en la fórmula", async () => {
    const edit = (xml: string) =>
      xml
        .replace("<dDescItem>0</dDescItem>", "<dDescItem>10000</dDescItem><dPorcDesIt>9.09</dPorcDesIt>")
        .replace("<dTotOpeItem>110000</dTotOpeItem>", "<dTotOpeItem>100000</dTotOpeItem>");
    expect((await send(edit)).code).toBe("1911"); // el ítem cierra; la base sigue siendo la de 110.000
  });

  it("1905, 1907 y 1909 para un ítem exento", async () => {
    const exempt = (proportion: string, rate: string, base: string) => (xml: string) =>
      xml.replace(
        /<gCamIVA>.*<\/gCamIVA>/,
        `<gCamIVA><iAfecIVA>3</iAfecIVA><dDesAfecIVA>Exento</dDesAfecIVA><dPropIVA>${proportion}</dPropIVA><dTasaIVA>${rate}</dTasaIVA><dBasGravIVA>${base}</dBasGravIVA><dLiqIVAItem>0</dLiqIVAItem><dBasExe>0</dBasExe></gCamIVA>`,
      );
    expect((await send(exempt("100", "0", "0"))).code).toBe("1905");
    expect((await send(exempt("0", "10", "0"))).code).toBe("1907");
    expect((await send(exempt("0", "0", "5"))).code).toBe("1909");
  });

  it("1908 si un ítem gravado no usa 5 ni 10", async () => {
    expect((await send(swap("<dTasaIVA>10</dTasaIVA>", "<dTasaIVA>7</dTasaIVA>"))).code).toBe("1908");
  });

  it("1903 si la descripción de la afectación no corresponde", async () => {
    expect((await send(swap("<dDesAfecIVA>Gravado IVA</dDesAfecIVA>", "<dDesAfecIVA>Exento</dDesAfecIVA>"))).code).toBe("1903");
  });

  it("calcula el gravado parcial con la fórmula de la NT 13", async () => {
    // 110.000 al 10 % con 50 % gravado: base 52.380,95..., IVA 5.238,09..., exento 52.380,95...
    const partial = (xml: string) =>
      xml
        .replace(
          /<gCamIVA>.*<\/gCamIVA>/,
          "<gCamIVA><iAfecIVA>4</iAfecIVA><dDesAfecIVA>Gravado parcial (Grav- Exento)</dDesAfecIVA><dPropIVA>50</dPropIVA><dTasaIVA>10</dTasaIVA><dBasGravIVA>52380.95238095</dBasGravIVA><dLiqIVAItem>5238.0952381</dLiqIVAItem><dBasExe>52380.95238095</dBasExe></gCamIVA>",
        )
        .replace("<dSubExe>0</dSubExe>", "<dSubExe>52381</dSubExe>")
        .replace("<dSub10>110000</dSub10>", "<dSub10>57619</dSub10>")
        .replace("<dIVA10>10000</dIVA10>", "<dIVA10>5238</dIVA10>")
        .replace("<dTotIVA>10000</dTotIVA>", "<dTotIVA>5238</dTotIVA>")
        .replace("<dBaseGrav10>100000</dBaseGrav10>", "<dBaseGrav10>52381</dBaseGrav10>")
        .replace("<dTBasGraIVA>100000</dTBasGraIVA>", "<dTBasGraIVA>52381</dTBasGraIVA>");
    const { xml } = buildDocument(identity, { beforeSign: partial, qrTotalIva: "5238" });
    const response = await sandbox.post(PATHS.recibe, recibeRequest(xml));
    expect(field(response.body, "dCodRes")).toBe("0260");
  });
});

describe("totales", () => {
  it.each([
    ["2353", "<dSubExe>0</dSubExe>", "<dSubExe>5</dSubExe>"],
    ["2355", "<dSubExo>0</dSubExo>", "<dSubExo>5</dSubExo>"],
    ["2357", "<dSub5>0</dSub5>", "<dSub5>5</dSub5>"],
    ["2359", "<dSub10>110000</dSub10>", "<dSub10>110002</dSub10>"],
    ["2362", "<dTotOpe>110000</dTotOpe>", "<dTotOpe>110002</dTotOpe>"],
    ["2363", "<dTotDesc>0</dTotDesc>", "<dTotDesc>5</dTotDesc>"],
    ["2383", "<dTotDescGlotem>0</dTotDescGlotem>", "<dTotDescGlotem>5</dTotDescGlotem>"],
    ["2384", "<dTotAntItem>0</dTotAntItem>", "<dTotAntItem>5</dTotAntItem>"],
    ["2387", "<dTotAnt>0</dTotAnt>", "<dTotAnt>5</dTotAnt>"],
    ["2364", "<dDescTotal>0</dDescTotal>", "<dDescTotal>5</dDescTotal>"],
    ["2388", "<dAnticipo>0</dAnticipo>", "<dAnticipo>5</dAnticipo>"],
    ["2367", "<dIVA5>0</dIVA5>", "<dIVA5>5</dIVA5>"],
    ["2369", "<dIVA10>10000</dIVA10>", "<dIVA10>10002</dIVA10>"],
    ["2373", "<dBaseGrav5>0</dBaseGrav5>", "<dBaseGrav5>5</dBaseGrav5>"],
    ["2375", "<dBaseGrav10>100000</dBaseGrav10>", "<dBaseGrav10>100002</dBaseGrav10>"],
    ["2377", "<dTBasGraIVA>100000</dTBasGraIVA>", "<dTBasGraIVA>100002</dTBasGraIVA>"],
  ])("%s", async (code, from, to) => {
    const result = await send(swap(from, to));
    expect(result.code).toBe(code);
    expect(result.message).toContain("el cálculo da");
  });

  it("2365 si el total general no cierra", async () => {
    const { xml } = buildDocument(identity, { declaredTotal: "110001" });
    const response = await sandbox.post(PATHS.recibe, recibeRequest(xml));
    expect(field(response.body, "dCodRes")).toBe("2365");
  });

  it("el redondeo participa en el total general (NT 1)", async () => {
    const { xml } = buildDocument(identity, {
      declaredTotal: "109950",
      beforeSign: (text) => text.replace("<dRedon>0</dRedon>", "<dRedon>50</dRedon>"),
    });
    const response = await sandbox.post(PATHS.recibe, recibeRequest(xml));
    expect(field(response.body, "dCodRes")).toBe("0260");
  });

  it("2371 si la liquidación total no es la suma", async () => {
    const result = await send(swap("<dTotIVA>10000</dTotIVA>", "<dTotIVA>10002</dTotIVA>"));
    expect(result.code).toBe("2371");
  });

  it("2358 y 2368 si faltan campos obligatorios", async () => {
    expect((await send(swap("<dSub10>110000</dSub10>", ""))).code).toBe("2358");
    expect((await send(swap("<dIVA10>10000</dIVA10>", ""))).code).toBe("2368");
  });
});

describe("moneda extranjera", () => {
  const dollars = (total: string, withTotalGs = true) => (xml: string) =>
    xml
      .replace("<cMoneOpe>PYG</cMoneOpe><dDesMoneOpe>Guarani</dDesMoneOpe>", "<cMoneOpe>USD</cMoneOpe><dDesMoneOpe>US Dollar</dDesMoneOpe><dCondTiCam>1</dCondTiCam><dTiCam>7000</dTiCam>")
      .replace("</gTotSub>", withTotalGs ? `<dTotalGs>${total}</dTotalGs></gTotSub>` : "</gTotSub>");

  it("2382 si falta el total en guaraníes", async () => {
    expect((await send(dollars("0", false))).code).toBe("2382");
  });

  it("2385 si el total en guaraníes no coincide con el tipo de cambio", async () => {
    expect((await send(dollars("770000001"))).code).toBe("2385");
  });

  it("aprueba si coincide", async () => {
    expect((await send(dollars("770000000"))).code).toBe("0260");
  });
});
