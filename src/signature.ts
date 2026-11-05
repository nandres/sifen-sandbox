import { X509Certificate } from "node:crypto";

import { SignedXml } from "xml-crypto";

import { hit, type RuleHit } from "./rules.js";
import { DSIG_NS, descendant, descendants, parseXml, text } from "./xml.js";

const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const C14N_FAMILY = /xml-(exc-)?c14n/;

export interface SignatureCheck {
  digest?: string;
  rejection?: RuleHit;
  /** Asunto del certificado. Solo informativo: el simulador no valida la cadena de confianza. */
  certificateSubject?: string;
}

/** Verifica la firma de un elemento `Id` dentro de `xml`, según MT §7.5 y §12.2.5. */
export function verifySignature(xml: string, signedId: string | undefined): SignatureCheck {
  const document = parseXml(xml);
  const signature = document.getElementsByTagNameNS(DSIG_NS, "Signature")[0];
  if (!signature) return { rejection: hit("0140", "El documento no tiene el elemento Signature") };

  const references = descendants(signature, "Reference");
  const reference = references[0];
  if (references.length !== 1 || !reference) {
    return { rejection: hit("0140", "La firma debe tener exactamente un Reference") };
  }
  const uri = reference.getAttribute("URI");
  if (!signedId || uri !== `#${signedId}`) {
    return { rejection: hit("0140", `Reference URI es "${uri ?? ""}"; debe ser "#${signedId ?? ""}"`) };
  }
  const transforms = descendants(reference, "Transform").map((t) => t.getAttribute("Algorithm") ?? "");
  if (!transforms.includes(ENVELOPED) || !transforms.some((t) => C14N_FAMILY.test(t))) {
    return { rejection: hit("0140", "Faltan los Transform enveloped-signature y C14N") };
  }

  const certificateB64 = text(signature, "X509Certificate")?.replace(/\s+/g, "");
  if (!certificateB64) return { rejection: hit("0140", "La firma no trae X509Certificate") };

  let certificatePem: string;
  let certificateSubject: string;
  try {
    certificatePem = `-----BEGIN CERTIFICATE-----\n${certificateB64.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
    certificateSubject = new X509Certificate(certificatePem).subject;
  } catch {
    return { rejection: hit("0140", "X509Certificate no es un certificado válido") };
  }

  const digest = descendant(reference, "DigestValue")?.textContent?.trim();
  const verifier = new SignedXml({ publicCert: certificatePem });
  try {
    verifier.loadSignature(signature.toString());
    if (!verifier.checkSignature(xml)) {
      return { rejection: hit("0141", "El SignatureValue o el DigestValue no coinciden con el contenido") };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { rejection: hit("0141", reason.slice(0, 200)) };
  }
  return { ...(digest ? { digest } : {}), certificateSubject };
}
