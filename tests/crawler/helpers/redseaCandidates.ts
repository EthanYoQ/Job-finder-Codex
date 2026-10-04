export function redseaCandidateListHtml(ids: readonly string[]): string {
  if (ids.length === 0) return "<html><script>var requestId = '';</script></html>";
  const alphabet = "y!89(*z02BCcdD_bEeGHIJKLmnNOPQopRMSTqrUklVstWXYZafgh3ij1uvwx456A7";
  const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const encoded = [...Buffer.from(ids.join(",")).toString("base64")]
    .map((char) => alphabet[standard.indexOf(char)]).join("") + "yyryrtweasdasd";
  const wrapped = encoded.slice(0, 2) + encoded.slice(-3) + encoded.slice(2, -3);
  return `<html><script>var requestId = '${wrapped}';</script></html>`;
}
