import { X509Certificate } from "node:crypto";

import { SignedXml } from "xml-crypto";

import { hit, type RuleHit } from "./rules.js";
import { DSIG_NS, descendant, descendants, parseXml, text } from "./xml.js";

const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const C14N_FAMILY = /xml-(exc-)?c14n/;
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

export interface SignatureCheck {
  digest?: string;
  rejection?: RuleHit;
  /** Datos del certificado. El simulador no valida la cadena de confianza. */
  certificate?: { subject: string; altName: string; validFrom: number; validTo: number };
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

  const algorithm = (name: string): string => descendant(signature, name)?.getAttribute("Algorithm") ?? "";
  if (!C14N_FAMILY.test(algorithm("CanonicalizationMethod"))) {
    return { rejection: hit("0140", "Canonicalization Method no informado o no válido") };
  }
  if (algorithm("SignatureMethod") !== RSA_SHA256) return { rejection: hit("0140", "Signature Method no informado o no válido") };
  if (algorithm("DigestMethod") !== SHA256) return { rejection: hit("0140", "Digest Method no informado o no válido") };

  const certificateB64 = text(signature, "X509Certificate")?.replace(/\s+/g, "");
  if (!certificateB64) return { rejection: hit("0120", "No existe el certificado de firma en el mensaje") };

  let certificatePem: string;
  let certificate: NonNullable<SignatureCheck["certificate"]>;
  try {
    certificatePem = `-----BEGIN CERTIFICATE-----\n${certificateB64.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
    const parsed = new X509Certificate(certificatePem);
    certificate = {
      subject: parsed.subject,
      altName: parsed.subjectAltName ?? "",
      validFrom: Date.parse(parsed.validFrom),
      validTo: Date.parse(parsed.validTo),
    };
  } catch {
    return { rejection: hit("0120", "X509Certificate no es un certificado válido") };
  }

  const digest = descendant(reference, "DigestValue")?.textContent?.trim();
  const verifier = new SignedXml({ publicCert: certificatePem });
  try {
    verifier.loadSignature(signature.toString());
    if (!verifier.checkSignature(xml)) {
      return { rejection: hit("0141", "XML modificado luego de la firma o mal firmado") };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { rejection: hit("0141", reason.slice(0, 200)) };
  }
  return { ...(digest ? { digest } : {}), certificate };
}
