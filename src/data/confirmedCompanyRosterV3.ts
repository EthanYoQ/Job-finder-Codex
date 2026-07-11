import { createHash } from "node:crypto";

export type ConfirmedCompanyCategory="FOREIGN_PHARMA"|"DOMESTIC_PHARMA";
export interface ConfirmedCompanyRosterMember { id:string;category:ConfirmedCompanyCategory }

const foreign=`abbvie-china amgen-china astellas-china astrazeneca bayer-healthcare biogen-china bms-china boehringer-ingelheim-china csl-china daiichi-sankyo-china gilead-china grifols-china gsk-china johnson-innovative-medicine lilly-china merck-china msd-china novartis novo-nordisk-china organon-china otsuka-china pfizer-china roche-china sandoz-china sanofi-china servier-china takeda-china teva-china ucb-china viatris`.split(" ");
const domestic=`3sbio apeloa buchang changchun-high-tech cr-pharma cspc cttq dongyangguang fosun-pharma gphl grand-pharma hansoh hengrui huahai humanwell jimin-kexin kelun livzon lunan nhu north-china-pharma qilu shanghai-pharma sinopharm tianjin-pharma tongrentang united-lab xinhua-pharma xiuzheng yangzijiang`.split(" ");

export const confirmedCompanyRosterV3Members:readonly ConfirmedCompanyRosterMember[]=[
  ...foreign.map(id=>({id:`company-${id}`,category:"FOREIGN_PHARMA" as const})),
  ...domestic.map(id=>({id:`company-${id}`,category:"DOMESTIC_PHARMA" as const}))
].sort((a,b)=>a.id.localeCompare(b.id));

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
