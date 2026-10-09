import { createHash } from "node:crypto";
import {
  confirmedCompanyRosterV3Members,
  type ConfirmedCompanyRosterMember
} from "./confirmedCompanyRosterV3Members";

export { confirmedCompanyRosterV3Members } from "./confirmedCompanyRosterV3Members";
export type {
  ConfirmedCompanyCategory,
  ConfirmedCompanyRosterMember
} from "./confirmedCompanyRosterV3Members";

export const confirmedCompanyRosterV3={
  schemaVersion:3 as const,
  rosterId:"user-confirmed-v3" as const,
  membersSha256:"29f1b4dc5e255e8119dc69500aeabb346e7e4f14c74fc5d3ddc35be0daa3aca9",
  members:confirmedCompanyRosterV3Members
};

export function assertExactConfirmedCompanyRosterV3(actual:readonly ConfirmedCompanyRosterMember[]):void{
  const canonical=(values:readonly ConfirmedCompanyRosterMember[])=>[...values].sort((a,b)=>a.id.localeCompare(b.id));
  const artifactHash=createHash("sha256").update(JSON.stringify(canonical(confirmedCompanyRosterV3.members))).digest("hex");
  if(artifactHash!==confirmedCompanyRosterV3.membersSha256)throw new Error("Confirmed V3 roster artifact content hash is invalid");
  const normalized=canonical(actual);
  if(new Set(normalized.map(x=>x.id)).size!==normalized.length||JSON.stringify(normalized)!==JSON.stringify(confirmedCompanyRosterV3.members)){
    throw new Error("Runtime company/category set does not exactly match the versioned user-confirmed V3 roster");
  }
}
