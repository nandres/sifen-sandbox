import { describe, expect, it } from "vitest";

import { isCdcCheckDigitValid, modulo11 } from "../src/identifiers.js";
import { QR_BASE_TEST, checkQr, qrHash, qrParameters } from "../src/qr.js";

// Valores que no salen de este código: el ejemplo resuelto del Manual Técnico v150.
const MANUAL = {
  cdc: "01444444017001001001452822017012515873260988",
  fechaEmision: "2017-01-25T09:35:17",
  digest: "yzGYhUx1/XYYzksWB+fPR3Qc50c=",
  params:
    "nVersion=150&Id=01444444017001001001452822017012515873260988" +
    "&dFeEmiDE=323031372d30312d32355430393a33353a3137&dRucRec=88899990" +
    "&dTotGralOpe=300000&dTotIVA=27272&cItems=2" +
    "&DigestValue=797a4759685578312f5859597a6b7357422b6650523351633530633d&IdCSC=0001",
  csc: "ABCD0000000000000000000000000000",
  hash: "97ddbb3c1e7d65af03a70ffe21f2b34846ab1c89e0566c35222086766b7374ed",
};

const expected = {
  cdc: MANUAL.cdc,
  fechaEmision: MANUAL.fechaEmision,
  receptor: "dRucRec=88899990",
  totalGeneral: "300000",
  totalIva: "27272",
  items: 2,
  digest: MANUAL.digest,
};

describe("ejemplo del manual, §13.8.4", () => {
  it("arma la misma cadena de parámetros", () => {
    expect(qrParameters(expected, "0001")).toBe(MANUAL.params);
  });

  it("calcula el mismo hash", () => {
    expect(qrHash(MANUAL.params, MANUAL.csc)).toBe(MANUAL.hash);
  });

  it("su CDC tiene el dígito verificador correcto", () => {
    expect(isCdcCheckDigitValid(MANUAL.cdc)).toBe(true);
  });

  it("aprueba la URL sin www y rechaza la versión con www, que la NT 10 dejó sin efecto", () => {
    const cscs = new Map([["0001", MANUAL.csc]]);
    const url = `${QR_BASE_TEST}${MANUAL.params}&cHashQR=${MANUAL.hash}`;
    expect(checkQr(url, expected, cscs)).toBeUndefined();
    expect(checkQr(url.replace("https://ekuatia", "https://www.ekuatia"), expected, cscs)?.code).toBe("2502");
  });
});

describe("módulo 11", () => {
  it("coincide con ejemplos publicados", () => {
    // CDC del ejemplo del manual.
    expect(modulo11(MANUAL.cdc.slice(0, 43))).toBe(8);
    // Del README de sifen-toolkit (MIT), confirmado por su autor contra SIFEN.
    expect(modulo11("80000001")).toBe(3);
    expect(isCdcCheckDigitValid("01800000013001001000001522026102211234567894")).toBe(true);
    // Del README de sifen-cdc (MIT).
    expect(modulo11("44444401")).toBe(7);
    expect(isCdcCheckDigitValid("01444444017001001001452822017012515873260988")).toBe(true);
  });

  it("devuelve 0 cuando el resto es 0 o 1", () => {
    expect(modulo11("0")).toBe(0); // 0 × 2 = 0, resto 0.
    expect(modulo11("6")).toBe(0); // 6 × 2 = 12, resto 1.
  });

  it("devuelve 11 menos el resto en los demás casos", () => {
    expect(modulo11("1")).toBe(9); // 1 × 2 = 2, resto 2.
  });
});
