/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";

afterEach(() => {
  cleanup();
});

describe("Job-search frontend app", () => {
  async function acceptConsent(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole("button", { name: "进入 Job-search" }));
  }

  it("shows a first-visit consent modal and locks the page until consent is accepted", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("dialog", { name: "使用前确认" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入 Job-search" })).toBeDisabled();
    expect(screen.getByRole("main", { hidden: true })).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole("button", { name: "进入 Job-search" }));

    expect(screen.queryByRole("dialog", { name: "使用前确认" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the page unusable when the consent modal is closed", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));

    expect(screen.queryByRole("dialog", { name: "使用前确认" })).not.toBeInTheDocument();
    expect(screen.getByText("使用前请先完成确认")).toBeInTheDocument();
    expect(screen.getByRole("main", { hidden: true })).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByRole("button", { name: "重新打开确认" }));
    expect(screen.getByRole("dialog", { name: "使用前确认" })).toBeInTheDocument();

    await acceptConsent(user);
    expect(screen.queryByRole("dialog", { name: "使用前确认" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-hidden", "true");
  });

  it("renders the selected search workbench content after consent", async () => {
    const user = userEvent.setup();
    render(<App />);

    await acceptConsent(user);

    expect(screen.getByText("Job-search")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("职位关键词，如：医学代表、药物警戒")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /北京/ })).toBeInTheDocument();
    expect(screen.getByText("全站最后抓取 2026-07-07 08:00")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("5 家公司")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "底部导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "职位发现" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("button", { name: "我的" })).toBeInTheDocument();
  });

  it("renders the visual reference default chips and expanded company", async () => {
    const user = userEvent.setup();
    render(<App />);

    await acceptConsent(user);

    expect(screen.getByRole("button", { name: /销售/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MSL/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /只看新增/ })).toBeInTheDocument();

    const pfizer = screen.getByRole("button", { name: /辉瑞/ });
    expect(pfizer).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByText("医学信息沟通专员（呼吸领域）")).toBeInTheDocument();
    expect(screen.getByText("医学科学联络官（肿瘤领域）")).toBeInTheDocument();
  });

  it("filters jobs by keyword after clearing optional chips and expands companies", async () => {
    const user = userEvent.setup();
    render(<App />);

    await acceptConsent(user);
    await user.click(screen.getByRole("button", { name: "清空" }));
    await user.clear(screen.getByPlaceholderText("职位关键词，如：医学代表、药物警戒"));
    await user.type(screen.getByPlaceholderText("职位关键词，如：医学代表、药物警戒"), "MSL");

    const pfizer = screen.getByRole("button", { name: /辉瑞/ });
    await user.click(pfizer);

    expect(screen.getByText("医学科学联络官（肿瘤领域）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看官方职位" })).toHaveAttribute(
      "href",
      expect.stringContaining("pfizer")
    );
  });

  it("clears selected filters without resetting the required city", async () => {
    const user = userEvent.setup();
    render(<App />);

    await acceptConsent(user);
    await user.click(screen.getByRole("button", { name: "清空" }));

    expect(screen.queryByText("MSL")).not.toBeInTheDocument();
    expect(screen.queryByText("只看新增")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /北京/ })).toBeInTheDocument();
  });
});
