export const UNKNOWN_WRITE_MESSAGE = "提交结果尚未确认，可能已经保存。请勿重复提交；请先联系管理员核实。您填写的内容已保留。";

export async function readApiJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    if (body?.error === "WRITE_BACKEND_UNAVAILABLE") throw new Error("WRITE_BACKEND_UNAVAILABLE");
    if (body?.error === "WRITE_RESULT_UNKNOWN" || response.status >= 500) throw new Error("WRITE_RESULT_UNKNOWN");
    throw new Error("REQUEST_REJECTED");
  }
  return await response.json() as T;
}

export function submissionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "WRITE_BACKEND_UNAVAILABLE") return "写入服务暂不可用。您填写的内容已保留，请在服务恢复后提交。";
  if (error instanceof Error && error.message === "REQUEST_REJECTED") return "提交未被接受，请检查填写内容或登录信息。您填写的内容已保留。";
  return UNKNOWN_WRITE_MESSAGE;
}
