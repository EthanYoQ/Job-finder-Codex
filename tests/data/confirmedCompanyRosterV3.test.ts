import {describe,expect,it} from "vitest";
import {candidateCompanies} from "../../src/data/companyRegistry";
import {assertExactConfirmedCompanyRosterV3,confirmedCompanyRosterV3} from "../../src/data/confirmedCompanyRosterV3";

describe("versioned user-confirmed V3 roster",()=>{
  const runtime=candidateCompanies.map(company=>({id:company.id,category:company.category}));
  it("binds the exact runtime members and categories to the independently hashed artifact",()=>{
    expect(()=>assertExactConfirmedCompanyRosterV3(runtime)).not.toThrow();
    expect(confirmedCompanyRosterV3.members.length).toBe(runtime.length);
  });
  it.each([
    [runtime.slice(1)],
    [[...runtime,{id:"company-extra",category:"FOREIGN_PHARMA" as const}]],
    [runtime.map((member,index)=>index===0?{...member,id:"company-replacement"}:member)],
    [runtime.map((member,index)=>index===0?{...member,category:member.category==="FOREIGN_PHARMA"?"DOMESTIC_PHARMA" as const:"FOREIGN_PHARMA" as const}:member)]
  ])("rejects missing, extra, replacement, and category drift",drifted=>{
    expect(()=>assertExactConfirmedCompanyRosterV3(drifted)).toThrow(/exactly match/i);
  });
});
