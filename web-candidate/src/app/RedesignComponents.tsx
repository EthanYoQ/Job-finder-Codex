import { Building2, ChevronDown, Info, LockKeyhole, Search, X } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CoverageCompany, SearchResult } from "./appDataProvider";
import { COMPANY_LOGOS, COMPANY_LOGO_SHEET } from "./designAssets";

export const PUBLICATION_STATE_LABELS: Record<CoverageCompany["state"], string> = {
  PUBLISHING: "已发布快照", VERIFYING: "核验中", OFFICIAL_LINK_ONLY: "仅官方入口",
  NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME: "暂无公开官方招聘入口",
  USER_AUTHORIZED_PHASE1_EXCLUSION: "用户授权一期排除"
};
export const STATE_CLASSES: Record<CoverageCompany["state"], string> = {
  PUBLISHING: "s-pub", VERIFYING: "s-ver", OFFICIAL_LINK_ONLY: "s-link",
  NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME: "s-nopub", USER_AUTHORIZED_PHASE1_EXCLUSION: "s-excl"
};
export function formatTimestamp(value: string | null): string {
  return value === null ? "暂无更新" : value.slice(0, 16).replace("T", " ");
}
export function coordinate(index: number): string {
  return `${String.fromCharCode(65 + Math.floor(index / 8))}${index % 8 + 1}`;
}
export function CompanyLogo({ companyId, name, className = "", priority = false }: {
  companyId: string; name: string; className?: string; priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const position = COMPANY_LOGOS[companyId];
  const { columns, rows, tileSize, stride, gutter } = COMPANY_LOGO_SHEET;
  useEffect(() => setFailed(false), [companyId]);
  return <span className={`tk ${className}${!position || failed ? " tk-mono" : ""}`} aria-hidden="true" data-company-id={companyId}>
    {position && !failed ? <span className="tk-art"><picture>
      <source type="image/webp" srcSet={COMPANY_LOGO_SHEET.webp} />
      <img alt="" decoding="async" loading="eager" fetchPriority={priority ? "high" : "auto"}
        src={COMPANY_LOGO_SHEET.png} width={columns * stride}
        height={rows * stride}
        style={{ width: `${columns * stride / tileSize * 100}%`, height: `${rows * stride / tileSize * 100}%`, left: `${-(position[0] * stride + gutter) / tileSize * 100}%`, top: `${-(position[1] * stride + gutter) / tileSize * 100}%` }}
        onError={() => setFailed(true)} />
    </picture></span> : <Building2 className="ic" aria-label={`${name}标志暂不可用`} />}
  </span>;
}

export function CompanyPlate({ companies, result, ready, hotId, onHot, onChoose, loading, failed, onRetry }: {
  companies: CoverageCompany[]; result: SearchResult | null; ready: boolean;
  hotId: string | null; onHot: (id: string | null) => void; onChoose: (company: CoverageCompany) => void;
  loading: boolean; failed: boolean; onRetry: () => void;
}) {
  const plateRef = useRef<HTMLElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const visible = ready && companies.length > 0;
  const hot = companies.find(company => company.id === hotId);
  const summary = result?.coverageSummary;
  const pub = summary?.publishingCompanyCount ?? companies.filter(c => c.state === "PUBLISHING").length;
  const required = summary?.requiredCompanyCount ?? companies.filter(c => c.state !== "USER_AUTHORIZED_PHASE1_EXCLUSION").length;
  const degraded = summary?.degradedCompanyCount ?? companies.filter(c => c.health === "DEGRADED").length;
  const rows = visible ? Math.max(6, Math.ceil(companies.length / 8)) : 6;
  useEffect(() => {
    if (!window.matchMedia?.("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const wells = plateRef.current?.querySelector<HTMLElement>(".wells");
    if (!wells) return;
    let frame = 0, x = 0, y = 0;
    const move = (event: PointerEvent) => {
      x = event.clientX; y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        wells.querySelectorAll<HTMLElement>(".well").forEach(well => {
          const bounds = well.getBoundingClientRect();
          const distance = Math.hypot(x - bounds.left - bounds.width / 2, y - bounds.top - bounds.height / 2);
          const scale = 1 + .42 * Math.exp(-Math.pow(distance / 62, 2));
          well.style.setProperty("--s", scale.toFixed(3)); well.style.setProperty("--z", String(Math.round(scale * 10)));
        });
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame); frame = 0;
      wells.querySelectorAll<HTMLElement>(".well").forEach(well => { well.style.removeProperty("--s"); well.style.removeProperty("--z"); });
    };
    wells.addEventListener("pointermove", move); wells.addEventListener("pointerleave", reset);
    return () => { reset(); wells.removeEventListener("pointermove", move); wells.removeEventListener("pointerleave", reset); };
  }, [visible, companies]);
  function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.min(Math.max(index + step, 0), companies.length - 1);
    plateRef.current?.querySelectorAll<HTMLButtonElement>(".well:not(:disabled)")[next]?.focus();
  }
  return <aside className="plate" ref={plateRef} aria-label="目标企业更新孔位图">
    <div className="plate-head"><div><div className="plate-label">目标企业更新进度</div>
      <div className="plate-big num">{visible ? <>{pub}<small>/{required}</small></> : "—"}</div></div>
      <div className="plate-deg">近期更新异常<b className="num">{visible ? `${degraded} 家` : "—"}</b></div>
    </div>
    <div className="wells" role="group" aria-label="目标企业孔位，每个孔位对应一家企业" onMouseLeave={() => onHot(null)}>
      <span className="ax" />{Array.from({length: 8}, (_, index) => <span className="ax" aria-hidden="true" key={index}>{index + 1}</span>)}
      {Array.from({length: rows}, (_, row) => <Fragment key={row}>
        <span className="ax" aria-hidden="true">{String.fromCharCode(65 + row)}</span>
        {Array.from({length: 8}, (_, col) => {
          const index = row * 8 + col, company = visible ? companies[index] : undefined;
          return <button key={col} type="button" disabled={!company} tabIndex={index === focusIndex ? 0 : -1}
            className={`well ${company ? STATE_CLASSES[company.state] + (company.health === "DEGRADED" ? " deg" : "") : visible ? "s-blank" : "s-neutral"}${hotId === company?.id ? " is-hot" : ""}`}
            style={{"--d": (row + col) * 55} as CSSProperties}
            aria-label={company ? `孔位 ${coordinate(index)}，${company.companyName}，${PUBLICATION_STATE_LABELS[company.state]}${company.health === "DEGRADED" ? "，近期更新异常" : ""}` : `孔位 ${coordinate(index)}，${visible ? "空白对照孔" : "完成使用前确认后显示"}`}
            onMouseEnter={() => company && onHot(company.id)} onFocus={() => { setFocusIndex(index); if (company) onHot(company.id); }} onBlur={() => onHot(null)}
            onKeyDown={event => moveFocus(event, index)} onClick={() => company && onChoose(company)}>
            <span className="lq" />{company ? <CompanyLogo companyId={company.id} name={company.companyName} priority={index === 0} /> : null}
          </button>;
        })}
      </Fragment>)}
    </div>
    <div className="readout" aria-live="polite">
      {hot && visible ? <div className="ro"><CompanyLogo companyId={hot.id} name={hot.companyName} className="tk-ro" /><div className="ro-txt">
        <span className="coord">{coordinate(companies.indexOf(hot))} · {hot.category === "FOREIGN_PHARMA" ? "外资药企" : "国内药企"}</span>
        <b>{hot.companyName}</b><span>{PUBLICATION_STATE_LABELS[hot.state]}{hot.health === "DEGRADED" ? " · 近期更新异常" : ""}</span>
      </div></div> : <span>{visible ? "指向或聚焦一个孔位，查看对应公司；点击可跳转到列表。" : loading ? "正在加载企业状态…" : failed ? "企业状态加载失败。" : "孔位图在完成使用前确认并加载数据后显示。"}</span>}
      {ready && failed ? <button className="plate-retry" onClick={onRetry}>重新加载企业状态</button> : null}
    </div>
    <div className="legend">{visible ? <>
      <span><i className="dot s-pub" />已发布快照 <b className="num">{pub}</b></span>
      <span><i className="dot deg" />近期更新异常 <b className="num">{degraded}</b></span>
      {(["VERIFYING", "OFFICIAL_LINK_ONLY", "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME", "USER_AUTHORIZED_PHASE1_EXCLUSION"] as const).map(state =>
        <span key={state}><i className={`dot ${STATE_CLASSES[state]}`} />{state === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" ? "无公开入口" : state === "USER_AUTHORIZED_PHASE1_EXCLUSION" ? "一期排除" : PUBLICATION_STATE_LABELS[state]} <b className="num">{companies.filter(c => c.state === state).length}</b></span>)}
    </> : <span><i className="dot" />完成确认后显示企业状态</span>}</div>
    {ready && result ? <dl className="plate-meta">
      <div><dt>全站已发布职位</dt><dd className="num">{result.publishedJobSummary?.totalJobs ?? "—"}</dd></div>
      {result.snapshotStorage === "SAVED" ? <div><dt>数据状态</dt><dd>已保存的公开快照</dd></div> : null}
      <div><dt>最后更新</dt><dd className="num plate-date">{formatTimestamp(result.lastUpdatedAt)}{result.lastUpdatedAt ? <small>UTC</small> : null}</dd></div>
    </dl> : <p className="plate-lock">{ready ? <Info className="ic" /> : <LockKeyhole className="ic" />}{ready ? "数据加载后显示职位统计。" : "完成使用前确认后显示。"}</p>}
  </aside>;
}

export interface LocationOption { value: string; label?: string; count?: number | undefined; group?: string; sub?: string; }
export function LocationPicker({ label, value, options, open, onOpen, onClose, onSelect, disabled, icon }: {
  label: string; value: string; options: LocationOption[]; open: boolean; onOpen: () => void;
  onClose: () => void; onSelect: (value: string) => void; disabled: boolean; icon: ReactNode;
}) {
  const id = useId(), inputRef = useRef<HTMLInputElement>(null), buttonRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = options.filter(option => `${option.value} ${option.group ?? ""}`.includes(query.trim()));
  useEffect(() => { if (open) { setQuery(""); setActive(0); if (!window.matchMedia?.("(pointer: coarse)").matches) inputRef.current?.focus(); } }, [open]);
  function close() { onClose(); buttonRef.current?.focus(); }
  function select(next: string) { onSelect(next); buttonRef.current?.focus(); }
  return <div className={`field combo${open ? " is-open" : ""}`} onKeyDown={event => {
    if (event.key === "Tab" && open) onClose();
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); if (!open) { onOpen(); return; }
      setActive(current => Math.max(0, Math.min(filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
    }
    if (event.key === "Enter" && open && filtered[active]) { event.preventDefault(); select(filtered[active].value); }
  }}>
    <span className="lbl" id={`${id}-label`}>{label}</span>
    <button className="control" type="button" role="combobox" aria-label={label} aria-controls={`${id}-list`} aria-expanded={open} aria-haspopup="listbox" ref={buttonRef} disabled={disabled} onClick={open ? close : onOpen}>
      {icon}<span className="val">{value}</span><ChevronDown className="ic chev" />
    </button>
    {open ? <div className="pop"><div className="pop-search"><Search className="ic" />
      <input ref={inputRef} aria-label={`搜索${label.startsWith("省") ? "省份" : "城市"}`} placeholder={`搜索${label.startsWith("省") ? "省份或大区" : "城市"}`} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} role="searchbox" aria-controls={`${id}-list`} aria-activedescendant={filtered[active] ? `${id}-option-${active}` : undefined} />
      <button type="button" className="pop-close" aria-label={`关闭${label.startsWith("省") ? "省份" : "城市"}选择`} onClick={close}><X className="ic" /></button>
    </div><div className="pop-list" role="listbox" aria-label={label} id={`${id}-list`}>
      {filtered.map((option, index) => <Fragment key={option.value}>
        {option.group && option.group !== filtered[index - 1]?.group ? <div className="grp">{option.group}</div> : null}
        <button type="button" className={`opt${index === active ? " is-active" : ""}${option.count === 0 ? " muted" : ""}`} role="option" aria-selected={option.value === value} id={`${id}-option-${index}`} onMouseEnter={() => setActive(index)} onClick={() => select(option.value)}>
          <span>{option.label ?? option.value}</span>{option.sub ? <span className="o-sub">{option.sub}</span> : null}{option.count !== undefined ? <span className="o-n">{option.count}</span> : null}
        </button>
      </Fragment>)}
      {!filtered.length ? <p className="pop-empty">没有匹配的地区</p> : null}
    </div></div> : null}
  </div>;
}

export function Modal({ title, children, onClose, closeLabel = "关闭", drawer = false, plain = false, icon, wide = false, heading, ariaLabel }: {
  title: string; children: ReactNode; onClose?: () => void; closeLabel?: string; drawer?: boolean; plain?: boolean; icon?: ReactNode; wide?: boolean; heading?: string; ariaLabel?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    const old = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { window.document.body.style.overflow = old; previous?.focus(); };
  }, []);
  return <div className={drawer ? "drawer-wrap" : "overlay"} onClick={event => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section ref={ref} tabIndex={-1} className={drawer ? "drawer" : `dialog${plain ? " plain" : ""}${wide ? " wide" : ""}`} aria-label={ariaLabel ?? title} role="dialog" aria-modal="true" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose?.(); }
      if (event.key === "Tab") {
        const focusables = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []);
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (window.document.activeElement === last || window.document.activeElement === ref.current)) { event.preventDefault(); first?.focus(); }
      }
    }}>
      {plain ? <>
        {onClose ? <button className="x" type="button" aria-label={closeLabel} onClick={onClose}><X className="ic" /></button> : null}
        <div className="dialog-body doc-dialog-body"><h2 className="doc-title">{heading ?? title}</h2>{children}</div>
      </> : <>
        <div className="dialog-top">{onClose ? <button className="x" type="button" aria-label={closeLabel} onClick={onClose}><X className="ic" /></button> : null}
          <div className="lockmark">{icon ?? <Building2 className="ic" />}</div><h2>{heading ?? title}</h2>
        </div><div className="dialog-body">{children}</div>
      </>}
    </section>
  </div>;
}
