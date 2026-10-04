/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompanyLogo } from "../../src/app/RedesignComponents";
import { COMPANY_LOGOS, COMPANY_LOGO_SHEET } from "../../src/app/designAssets";
import { humanVerifiedCompanyIds } from "../../src/data/humanVerifiedRecruitmentBaseline";
import sources from "../../scripts/company-logo-sources.json";

afterEach(cleanup);

describe("company brand assets", () => {
  it("covers the exact 41-company roster using unique stable-ID tiles", () => {
    expect(Object.keys(COMPANY_LOGOS).sort()).toEqual(humanVerifiedCompanyIds().sort());
    expect(new Set(Object.values(COMPANY_LOGOS).map(position => position.join(","))).size).toBe(41);
    for (const [column, row] of Object.values(COMPANY_LOGOS)) {
      expect(column).toBeLessThan(COMPANY_LOGO_SHEET.columns);
      expect(row).toBeLessThan(COMPANY_LOGO_SHEET.rows);
    }
  });

  it("does not lose a logo when the public company display name changes", () => {
    const { container, rerender } = render(<CompanyLogo companyId="company-johnson-innovative-medicine" name="强生创新制药" />);
    expect(container.querySelector("img")).not.toBeNull();
    const initial = container.querySelector("img")!.getAttribute("style");
    rerender(<CompanyLogo companyId="company-johnson-innovative-medicine" name="强生中国（集团招聘范围，含创新制药与医疗科技）" />);
    expect(container.querySelector("img")!.getAttribute("style")).toBe(initial);
    expect(container.textContent).toBe("");
  });

  it("uses one shared lossless image URL, a PNG fallback, and explicit intrinsic dimensions", () => {
    const { container } = render(<>{humanVerifiedCompanyIds().map((id, index) => <CompanyLogo key={id} companyId={id} name={id} priority={index === 0} />)}</>);
    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(41);
    expect(new Set(images.map(image => image.src)).size).toBe(1);
    expect(new Set([...container.querySelectorAll("source")].map(source => source.srcset)).size).toBe(1);
    expect(images[0].getAttribute("fetchpriority")).toBe("high");
    expect(images[0].width).toBe(800);
    expect(images[0].height).toBe(600);
    expect(COMPANY_LOGO_SHEET.gutter).toBe(2);
    expect(images[0].style.left).toBe("-2.083333333333333%");
    expect(images.every(image => image.getAttribute("loading") === "eager")).toBe(true);
  });

  it("uses a neutral icon on an asset error rather than an incorrect initial", () => {
    const { container, rerender } = render(<CompanyLogo companyId="company-servier-china" name="施维雅中国" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("");
    rerender(<CompanyLogo companyId="company-fosun-pharma" name="复星医药" />);
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("retains checked-in local provenance for all corrected brands", () => {
    for (const id of ["servier-china", "fosun-pharma", "hansoh", "shanghai-pharma", "sandoz-china", "grand-pharma", "united-lab"]) {
      expect(sources.find(source => source.id === `company-${id}`)?.officialAsset).toBeTruthy();
    }
    expect(sources.find(source => source.id === "company-johnson-innovative-medicine")?.source).toBe("/brand-logos/logo-528765569e45c67a.png");
  });
});
