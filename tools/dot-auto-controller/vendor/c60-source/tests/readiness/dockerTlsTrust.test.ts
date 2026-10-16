import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GEOTRUST_TLS_RSA_CA_G1_DER_SHA256 =
  "c06e307f7cfc1d32fa72a4c033c87b90019af216f0775d64978a2eca6c8a230e";
const certificateRelativePath =
  "ops/certificates/geotrust-tls-rsa-ca-g1.pem";

describe("Docker runtime TLS trust", () => {
  it("adds only the pinned GeoTrust intermediate needed by the CSL official careers host", () => {
    const certificatePath = resolve(process.cwd(), certificateRelativePath);
    const certificateExists = existsSync(certificatePath);

    expect(certificateExists).toBe(true);
    if (!certificateExists) return;

    const certificate = new X509Certificate(readFileSync(certificatePath));
    expect(certificate.ca).toBe(true);
    expect(certificate.subject).toContain("CN=GeoTrust TLS RSA CA G1");
    expect(certificate.issuer).toContain("CN=DigiCert Global Root G2");
    expect(certificate.fingerprint256.replaceAll(":", "").toLowerCase()).toBe(
      GEOTRUST_TLS_RSA_CA_G1_DER_SHA256,
    );

    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
    expect(dockerfile).toContain(
      `ENV NODE_EXTRA_CA_CERTS=/app/${certificateRelativePath}`,
    );
    expect(dockerfile).toContain(
      `openssl x509 -in /app/${certificateRelativePath} -outform DER`,
    );
    expect(dockerfile).toContain(
      `= "${GEOTRUST_TLS_RSA_CA_G1_DER_SHA256}"`,
    );
    expect(dockerfile).not.toMatch(
      /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0|rejectUnauthorized\s*:\s*false|Verify-Peer=false/u,
    );
  });
});
