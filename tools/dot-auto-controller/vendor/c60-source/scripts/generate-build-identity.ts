import {writeFileSync} from "node:fs";
import {verifyDockerBuildProvenance} from "../src/readiness/dockerBuildProvenance";
const commit=process.argv.find(arg=>arg.startsWith("--commit="))?.slice(9);
const clean=process.argv.find(arg=>arg.startsWith("--clean-provenance="))?.slice(19);
const expectedTree=process.argv.find(arg=>arg.startsWith("--source-tree-sha256="))?.slice(21);
if(!commit||clean!=="true"||!expectedTree)throw new Error("Docker build requires commit SHA, committed source-tree digest, and clean source provenance");
const identity=verifyDockerBuildProvenance("/app","/app/.docker-build-provenance.bundle",commit,expectedTree,true);
writeFileSync("/app/build-identity.json",JSON.stringify(identity)+"\n");
