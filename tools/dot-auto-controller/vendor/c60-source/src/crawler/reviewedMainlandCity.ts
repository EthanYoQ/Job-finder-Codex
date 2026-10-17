import { astraZenecaCity } from "./astraZenecaLocations";
import { PFIZER_OFFICIAL_LOCALITIES } from "./pfizerOfficialLocalities";

/** Reuse reviewed city/province identities; callers must establish the country. */
export function reviewedMainlandCity(city: string, province: string): string | undefined {
  const region = province.replace(/ Province$/iu, "");
  return astraZenecaCity(city, region) ?? Object.entries(PFIZER_OFFICIAL_LOCALITIES)
    .find(([location]) => location.toLowerCase() === `China - ${region} - ${city}`.toLowerCase())?.[1];
}
