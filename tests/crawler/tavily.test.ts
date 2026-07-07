import { describe, expect, it } from "vitest";
import {
  createTavilyKeyRing,
  extractOfficialSourceWithTavily
} from "../../src/crawler/tavily";

describe("Tavily extraction wrapper", () => {
  it("rotates to the next key after a quota failure", async () => {
    const keysUsed: string[] = [];
    const result = await extractOfficialSourceWithTavily(
      {
        urls: ["https://example.com/careers"],
        query: "social recruitment jobs",
        extractDepth: "advanced"
      },
      {
        keyRing: createTavilyKeyRing(["key-0", "key-1"]),
        extract: async ({ apiKey }) => {
          keysUsed.push(apiKey);
          if (apiKey === "key-0") {
            return {
              ok: false,
              retryable: true,
              error: "quota exceeded"
            };
          }
          return {
            ok: true,
            data: {
              results: [
                {
                  url: "https://example.com/careers",
                  rawContent: "职位列表 北京 Regional Sales Manager"
                }
              ],
              failedResults: []
            }
          };
        }
      }
    );

    expect(keysUsed).toEqual(["key-0", "key-1"]);
    expect(result.results[0]?.rawContent).toContain("职位列表");
  });

  it("fails without leaking key values when all keys fail", async () => {
    let thrown: unknown;

    try {
      await extractOfficialSourceWithTavily(
        { urls: ["https://example.com/careers"] },
        {
          keyRing: createTavilyKeyRing(["secret-key"]),
          extract: async () => ({
            ok: false,
            retryable: true,
            error: "quota exceeded for secret-key"
          })
        }
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      "Tavily extraction failed after 1 key attempt"
    );
    expect((thrown as Error).message).not.toContain("secret-key");
  });
});
