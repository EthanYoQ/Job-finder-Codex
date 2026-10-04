/** Seven invented Workday rows: four resolved cities and three explicit mainland
 * title/location conflicts. No retained response, exact date or real job ID.
 */
export function createBiogenSyntheticBody(): string {
  const titles = ["Synthetic medical role", "Synthetic regional role", "Synthetic role (Location: Wuhan)",
    "Synthetic research role", "Synthetic role (Location: Urumqi)", "Synthetic role (Location: Changsha)", "Synthetic medical role"];
  const jobPostings = titles.map((title, index) => ({ title,
    externalPath: `/job/${index === 6 ? "Beijing" : "Shanghai"}-China/Synthetic-Role_REQ${90000 + index}-1`,
    locationsText: index === 6 ? "Beijing, China" : "Shanghai, China",
    postedOn: "Posted 30+ Days Ago", bulletFields: [`REQ${90000 + index}`]
  }));
  return JSON.stringify({ total: 7, jobPostings, facets: [{ facetParameter: "locationMainGroup", values: [
    { facetParameter: "locationCountry", values: [{ descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4", count: 7 }] },
    { facetParameter: "locations", values: [
      { descriptor: "Shanghai, China", id: "c20707a4650c018390f4e48ed845efa6", count: 6 },
      { descriptor: "Beijing, China", id: "1d1ae2cf252d013639674034b420cda4", count: 1 }
    ] }
  ] }] });
}
