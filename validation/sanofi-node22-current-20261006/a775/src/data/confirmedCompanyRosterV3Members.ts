export type ConfirmedCompanyCategory = "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";

export interface ConfirmedCompanyRosterMember {
  id: string;
  category: ConfirmedCompanyCategory;
}

const foreign = `abbvie-china amgen-china astellas-china astrazeneca bayer-healthcare biogen-china bms-china boehringer-ingelheim-china csl-china daiichi-sankyo-china gilead-china grifols-china gsk-china johnson-innovative-medicine lilly-china merck-china msd-china novartis novo-nordisk-china organon-china otsuka-china pfizer-china roche-china sandoz-china sanofi-china servier-china takeda-china teva-china ucb-china viatris`.split(" ");
const domestic = `3sbio apeloa buchang changchun-high-tech cr-pharma cspc cttq dongyangguang fosun-pharma gphl grand-pharma hansoh hengrui huahai humanwell jimin-kexin kelun livzon lunan nhu north-china-pharma qilu shanghai-pharma sinopharm tianjin-pharma tongrentang united-lab xinhua-pharma xiuzheng yangzijiang`.split(" ");

export const confirmedCompanyRosterV3Members: readonly ConfirmedCompanyRosterMember[] = [
  ...foreign.map((id) => ({ id: `company-${id}`, category: "FOREIGN_PHARMA" as const })),
  ...domestic.map((id) => ({ id: `company-${id}`, category: "DOMESTIC_PHARMA" as const }))
].sort((left, right) => left.id.localeCompare(right.id));
