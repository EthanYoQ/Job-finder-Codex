import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const dockerfile=()=>readFileSync("Dockerfile","utf8");

describe("offline Prisma engine image contract",()=>{
  it("binds npm ci to the Debian OpenSSL 3 Prisma CLI target",()=>{
    expect(dockerfile()).toMatch(
      /^RUN\s+PRISMA_CLI_BINARY_TARGETS=debian-openssl-3\.0\.x\s+npm ci$/mu,
    );
  });

  it("fails the dependency build when either required OpenSSL 3 engine is absent or empty",()=>{
    const source=dockerfile();
    expect(source).toMatch(
      /^RUN\s+test -s \/app\/node_modules\/@prisma\/engines\/schema-engine-debian-openssl-3\.0\.x$/mu,
    );
    expect(source).toMatch(
      /^RUN\s+test -s \/app\/node_modules\/@prisma\/engines\/libquery_engine-debian-openssl-3\.0\.x\.so\.node$/mu,
    );
  });

  it("uses Prisma 6.19.3 default CLI query-engine library instead of requiring the optional binary override",()=>{
    const source=dockerfile();
    const lock=JSON.parse(readFileSync("package-lock.json","utf8")) as {packages:Record<string,{version?:string}>};
    expect(lock.packages["node_modules/prisma"]?.version).toBe("6.19.3");
    expect(lock.packages["node_modules/@prisma/engines"]?.version).toBe("6.19.3");
    expect(source).not.toContain("PRISMA_CLI_QUERY_ENGINE_TYPE=binary");
    expect(source).not.toContain("query-engine-debian-openssl-3.0.x");
  });
});
