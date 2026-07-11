import {writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createBuildIdentity} from "../src/readiness/buildIdentity";
const commit=process.argv.find(arg=>arg.startsWith("--commit="))?.slice(9);
const clean=process.argv.find(arg=>arg.startsWith("--clean-provenance="))?.slice(19);
const expectedTree=process.argv.find(arg=>arg.startsWith("--source-tree-sha256="))?.slice(21);
if(!commit||clean!=="true"||!expectedTree)throw new Error("Docker build requires commit SHA, committed source-tree digest, and clean source provenance");
let status:string,head:string;try{status=execFileSync("git",["status","--porcelain","--","src","scripts","prisma","ops","package.json","package-lock.json","tsconfig.json","Dockerfile",".dockerignore"],{encoding:"utf8"});head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();}catch{throw new Error("Docker build requires resolvable copied Git provenance");}
if(status.trim())throw new Error("Docker build source provenance is dirty");if(head!==commit)throw new Error("Docker build commit argument does not match copied Git provenance");
const identity=createBuildIdentity("/app",commit);if(identity.sourceTreeSha256!==expectedTree)throw new Error("Docker build actual source tree does not match committed clean source provenance");
writeFileSync("/app/build-identity.json",JSON.stringify(identity)+"\n");
