// Dígito verificador módulo 11 y estructura del CDC. MT §10.1 y §10.2.

export function modulo11(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 11 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : 0;
}

export interface CdcFields {
  iTiDE: string;
  dRucEm: string;
  dDVEmi: string;
  dEst: string;
  dPunExp: string;
  dNumDoc: string;
  iTipCont: string;
  /** Fecha de emisión en AAAAMMDD. */
  fecha: string;
  iTipEmi: string;
  dCodSeg: string;
}

/** Los primeros 43 dígitos del CDC, a partir de los campos del XML. */
export function cdcBody(f: CdcFields): string {
  return (
    f.iTiDE.padStart(2, "0") +
    f.dRucEm.padStart(8, "0") +
    f.dDVEmi +
    f.dEst.padStart(3, "0") +
    f.dPunExp.padStart(3, "0") +
    f.dNumDoc.padStart(7, "0") +
    f.iTipCont +
    f.fecha +
    f.iTipEmi +
    f.dCodSeg.padStart(9, "0")
  );
}

export function isCdcShape(cdc: string): boolean {
  return /^\d{44}$/.test(cdc);
}

export function isCdcCheckDigitValid(cdc: string): boolean {
  return isCdcShape(cdc) && modulo11(cdc.slice(0, 43)) === Number(cdc[43]);
}
