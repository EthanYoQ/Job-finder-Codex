import {resolve} from "node:path";
import {exportDockerBuildProvenance} from "../src/readiness/dockerBuildProvenance";

exportDockerBuildProvenance(process.cwd(),resolve(process.cwd(),".docker-build-provenance.bundle"));
