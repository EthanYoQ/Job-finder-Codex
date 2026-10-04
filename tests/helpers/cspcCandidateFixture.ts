import { redseaCandidateListHtml } from "../crawler/helpers/redseaCandidates";

/** Invented request IDs and rows; never a retained capture or publication proof. */
export function cspcCandidateFixture() {
  const candidateIds = Array.from({ length: 37 }, (_, index) =>
    `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`);
  const requestIdEncoded = /var requestId = '([^']+)';/.exec(
    redseaCandidateListHtml(candidateIds))?.[1];
  if (!requestIdEncoded) throw new Error("Synthetic candidate declaration was not encoded");
  return {
    requestIdEncoded,
    candidateIds,
    returnedRows: candidateIds.slice(0, 31).map((REQUEST_ID, index) => ({
      REQUEST_ID,
      PUBLISH_NAME: `Synthetic 医学经理 ${index + 1}`,
      work_place: "上海"
    }))
  };
}
