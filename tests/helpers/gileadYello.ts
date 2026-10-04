/** Reusable synthetic fixture only. These are invented IDs/titles, never a live capture. */
export const GILEAD_SYNTHETIC_FIXTURE_KIND = "SYNTHETIC_GILEAD_PUBLIC_AGE_NOT_LIVE_EVIDENCE";
export const GILEAD_SYNTHETIC_AGES = ["1w", "2w", "3w", "Sep 3", "Sep 2", "Aug 14", "Jul 31", "Jun 11", "Jun 11", "Jun 3"];
export const GILEAD_BOARD = "v42vD4vKxb3AkKvV93YsrQ";
export const GILEAD_ENDPOINT = `https://gilead.yello.co/job_boards/${GILEAD_BOARD}/search?query=&filters=72`;

export function syntheticGileadRow(index: number, age = GILEAD_SYNTHETIC_AGES[index]!, location = index === 0 || index === 7 ? "China - Beijing" : "China - Shanghai"): string {
  return `<li class="search-results__item"><div class="clearfix"><div class="search-results__flag pull-left"><img alt="China flag" src="/assets/images/flags/cn.png"></div><div class="search-results__jobinfo pull-left"><a class="search-results__req_title" href="/jobs/${String(index).padStart(22, "S")}?job_board_id=${GILEAD_BOARD}">Synthetic Gilead role ${index}</a><div><span>${location}</span><span>Synthetic department</span><span>Regular</span></div></div><div class="search-results__post-time pull-right">${age}</div></div></li>`;
}

export function syntheticGileadBody(rows = GILEAD_SYNTHETIC_AGES.map((age, index) => syntheticGileadRow(index, age)), overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ html: rows.join(""), count_on_page: rows.length, more_requisitions: false, query: "",
    filters: JSON.stringify([{label: "Locations", id: 32, has_conditions: false, answers: [{id: 72, label: "China"}], answer_type: "multiple_select"}]),
    text_filters: "[]", display_count_text: `${rows.length} ${rows.length === 1 ? "Result" : "Results"}`, ...overrides });
}
