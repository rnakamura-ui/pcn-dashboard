"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import Chart from "chart.js/auto";

const SPREADSHEET_ID = "1piVZdutD0KKvMwO6v6VmolBE8Z3XRrrOAg_3Tku2oc4";
const BRANCHES = ["札幌", "仙台", "東京", "東海", "大阪", "福岡"];
const EXCLUDE_PERSONS = ["テスト担当者"];
const EXCLUDE_BRANCHES = ["（未解析）"];
const COLORS = {
  accent: "#00d4aa",
  blue: "#4f8ff7",
  amber: "#f0a030",
  red: "#f06050",
  grid: "rgba(255,255,255,0.03)",
  text: "#6b7a8d",
};

/* ── Week Utility ── */
// Returns week key like "2026/03 W1" and day-of-month bucket (1-4)
function getWeekKey(dateStr) {
  // dateStr is "YYYY/MM/DD"
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const day = parseInt(parts[2], 10);
  const week = Math.min(Math.ceil(day / 7), 4); // 1-7→1, 8-14→2, 15-21→3, 22+→4
  return `${parts[0]}/${parts[1]} W${week}`;
}

/* ── Data Fetch ── */
async function fetchSheetData() {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent("生データ")}`;
  const res = await fetch(url);
  const text = await res.text();
  const json = JSON.parse(text.match(/google\.visualization\.Query\.setResponse\((.+)\)/)[1]);
  const rows = json.table.rows;
  return rows
    .map((r) => {
      const c = r.c;
      if (!c[0] || !c[1] || !c[2]) return null;
      const dateVal = c[0].v;
      let dateStr = "";
      if (typeof dateVal === "string") {
        dateStr = dateVal;
      } else if (dateVal && dateVal.toString().startsWith("Date(")) {
        const m = dateVal.toString().match(/Date\((\d+),(\d+),(\d+)\)/);
        if (m) dateStr = `${m[1]}/${String(Number(m[2]) + 1).padStart(2, "0")}/${m[3].padStart(2, "0")}`;
      }
      if (!dateStr) return null;
      const month = dateStr.substring(0, 7).replace("/", "-");
      const week = getWeekKey(dateStr);
      return {
        date: dateStr,
        month,
        week,
        person: (c[1].v || "").toString().trim(),
        branch: (c[2].v || "").toString().trim(),
        calls: Number(c[3]?.v || 0),
        connects: Number(c[4]?.v || 0),
        apos: Number(c[5]?.v || 0),
      };
    })
    .filter((r) => r && r.person && r.branch && !EXCLUDE_BRANCHES.includes(r.branch) && !EXCLUDE_PERSONS.includes(r.person));
}

/* ── Aggregation ── */
function aggregate(rows) {
  const tot = { calls: 0, connects: 0, apos: 0 };
  const byMonth = {};
  const byWeek = {};
  const byBranch = {};
  const byPerson = {};
  const byMonthBranch = {};

  rows.forEach((r) => {
    tot.calls += r.calls;
    tot.connects += r.connects;
    tot.apos += r.apos;

    if (!byMonth[r.month]) byMonth[r.month] = { calls: 0, connects: 0, apos: 0 };
    byMonth[r.month].calls += r.calls;
    byMonth[r.month].connects += r.connects;
    byMonth[r.month].apos += r.apos;

    if (r.week) {
      if (!byWeek[r.week]) byWeek[r.week] = { calls: 0, connects: 0, apos: 0 };
      byWeek[r.week].calls += r.calls;
      byWeek[r.week].connects += r.connects;
      byWeek[r.week].apos += r.apos;
    }

    if (!byBranch[r.branch]) byBranch[r.branch] = { calls: 0, connects: 0, apos: 0 };
    byBranch[r.branch].calls += r.calls;
    byBranch[r.branch].connects += r.connects;
    byBranch[r.branch].apos += r.apos;

    const pk = `${r.person}|${r.branch}`;
    if (!byPerson[pk]) byPerson[pk] = { person: r.person, branch: r.branch, calls: 0, connects: 0, apos: 0 };
    byPerson[pk].calls += r.calls;
    byPerson[pk].connects += r.connects;
    byPerson[pk].apos += r.apos;

    const mbk = `${r.month}|${r.branch}`;
    if (!byMonthBranch[mbk]) byMonthBranch[mbk] = { calls: 0, connects: 0, apos: 0 };
    byMonthBranch[mbk].calls += r.calls;
    byMonthBranch[mbk].connects += r.connects;
    byMonthBranch[mbk].apos += r.apos;
  });

  return { tot, byMonth, byWeek, byBranch, byPerson, byMonthBranch };
}

function rate(num, den) {
  return den > 0 ? ((num / den) * 100).toFixed(1) : "0.0";
}

/* ── Count-Up Hook ── */
function useCountUp(target, duration = 500, decimals = 0) {
  const [val, setVal] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    const t = Number(target) || 0;
    const start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(ease * t);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString();
}

/* ── Filter Dropdown ── */
function FilterDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (v) => {
    const next = selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v];
    onChange(next);
  };
  const selAll = () => onChange([...options]);
  const selNone = () => onChange([]);
  const count = selected.length;
  const summary = count === options.length ? `${label}: 全て` : count === 0 ? `${label}: --` : `${label}: ${count}件`;

  return (
    <div className="filter-wrap" ref={ref}>
      <button className={`filter-btn ${open ? "open" : ""} ${count > 0 && count < options.length ? "active" : ""}`} onClick={() => setOpen(!open)}>
        <span>{summary}</span>
        <span className="filter-arrow">&#9662;</span>
      </button>
      <div className={`filter-panel ${open ? "open" : ""}`}>
        <div className="filter-actions">
          <button className="filter-action-btn" onClick={selAll}>全選択</button>
          <button className="filter-action-btn" onClick={selNone}>全解除</button>
        </div>
        {options.map((o) => (
          <div key={o} className={`filter-option ${selected.includes(o) ? "selected" : ""}`} onClick={() => toggle(o)}>
            <div className="filter-checkbox" />
            <span>{o}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── KPI Card ── */
function KpiCard({ label, value, unit, colorClass, trend, trendUnit }) {
  const display = useCountUp(value, 500, unit === "%" ? 1 : 0);
  const trendSuffix = trendUnit || (unit === "%" ? "pt" : "");
  const trendDisplay = trend !== undefined
    ? (unit === "%" ? trend.toFixed(1) : Math.round(trend).toLocaleString())
    : null;
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${colorClass}`}>
        {display}
        {unit && <span style={{ fontSize: 16, fontWeight: 400, marginLeft: 2 }}>{unit}</span>}
      </div>
      {trend !== undefined && (
        <div className={`kpi-trend ${trend > 0 ? "up" : trend < 0 ? "down" : "flat"}`}>
          <span className="trend-arrow">{trend > 0 ? "▲" : trend < 0 ? "▼" : "—"}</span>
          {trend > 0 ? "+" : ""}{trendDisplay}{trendSuffix} vs 前月
        </div>
      )}
    </div>
  );
}

/* ── Yield Chart (Weekly) ── */
function YieldChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;
    if (chartRef.current) chartRef.current.destroy();

    const weeks = Object.keys(data.byWeek || {}).sort();
    if (weeks.length === 0) return;

    const apoRate = weeks.map((w) => Number(rate(data.byWeek[w].apos, data.byWeek[w].calls)));
    const cToARate = weeks.map((w) => Number(rate(data.byWeek[w].apos, data.byWeek[w].connects)));
    const connRate = weeks.map((w) => Number(rate(data.byWeek[w].connects, data.byWeek[w].calls)));

    // Convert "2026/03 W1" → "3月 第1週"
    const labels = weeks.map((w) => {
      const m = w.match(/(\d{4})\/(\d{2}) W(\d)/);
      if (!m) return w;
      return `${parseInt(m[2], 10)}月 第${m[3]}週`;
    });

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "アポ率", data: apoRate, borderColor: COLORS.accent, backgroundColor: "rgba(0,212,170,0.06)", fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2, pointBackgroundColor: COLORS.accent },
          { label: "着電toアポ率", data: cToARate, borderColor: COLORS.blue, backgroundColor: "rgba(79,143,247,0.06)", fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2, pointBackgroundColor: COLORS.blue },
          { label: "着電率", data: connRate, borderColor: COLORS.amber, backgroundColor: "rgba(240,160,48,0.06)", fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2, pointBackgroundColor: COLORS.amber },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1200, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "end", labels: { color: COLORS.text, font: { size: 11 }, boxWidth: 12, padding: 16 } },
          tooltip: {
            backgroundColor: "#1a2736", titleColor: "#e8ecf1", bodyColor: "#8b97a8",
            borderColor: "rgba(255,255,255,0.1)", borderWidth: 1, padding: 12,
            callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` },
          },
        },
        scales: {
          x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, font: { size: 11 } } },
          y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, font: { size: 11 }, callback: (v) => v + "%" }, beginAtZero: true },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [data]);

  return <div className="chart-container-tall"><canvas ref={canvasRef} /></div>;
}

/* ── Branch Chart ── */
function BranchChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;
    if (chartRef.current) chartRef.current.destroy();

    const branches = BRANCHES.filter((b) => data.byBranch[b]);
    const apoR = branches.map((b) => Number(rate(data.byBranch[b].apos, data.byBranch[b].calls)));
    const cToA = branches.map((b) => Number(rate(data.byBranch[b].apos, data.byBranch[b].connects)));
    const connR = branches.map((b) => Number(rate(data.byBranch[b].connects, data.byBranch[b].calls)));

    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: branches,
        datasets: [
          { label: "アポ率", data: apoR, backgroundColor: "rgba(0,212,170,0.7)", borderRadius: 4, barPercentage: 0.7 },
          { label: "着電toアポ率", data: cToA, backgroundColor: "rgba(59,130,246,0.7)", borderRadius: 4, barPercentage: 0.7 },
          { label: "着電率", data: connR, backgroundColor: "rgba(245,158,11,0.7)", borderRadius: 4, barPercentage: 0.7 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: "easeOutQuart" },
        plugins: {
          legend: { position: "top", align: "end", labels: { color: COLORS.text, font: { size: 11 }, boxWidth: 12, padding: 16 } },
          tooltip: {
            backgroundColor: "#1a2736", titleColor: "#e8ecf1", bodyColor: "#8b97a8",
            borderColor: "rgba(255,255,255,0.1)", borderWidth: 1,
            callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: COLORS.text, font: { size: 11 } } },
          y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text, font: { size: 11 }, callback: (v) => v + "%" }, beginAtZero: true },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [data]);

  return <div className="chart-container"><canvas ref={canvasRef} /></div>;
}

/* ── Ranking Table ── */
function RankingTable({ data, mode }) {
  if (!data) return null;
  const persons = Object.values(data.byPerson);
  let sorted;
  if (mode === "apo") {
    sorted = persons.filter((p) => p.calls > 0).sort((a, b) => b.apos / b.calls - a.apos / a.calls);
  } else {
    sorted = persons.filter((p) => p.connects > 0).sort((a, b) => b.apos / b.connects - a.apos / a.connects);
  }
  const top = sorted.slice(0, 15);

  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>担当者</th>
          <th>支店</th>
          <th>{mode === "apo" ? "架電数" : "着電数"}</th>
          <th>アポ数</th>
          <th>{mode === "apo" ? "アポ率" : "着電toアポ率"}</th>
        </tr>
      </thead>
      <tbody>
        {top.map((p, i) => {
          const r = mode === "apo" ? rate(p.apos, p.calls) : rate(p.apos, p.connects);
          const den = mode === "apo" ? p.calls : p.connects;
          const rankClass = i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "";
          return (
            <tr key={p.person + p.branch} className={`data-row ${rankClass}`} style={{ animationDelay: `${i * 0.04}s` }}>
              <td className="mono">{i + 1}</td>
              <td>{p.person}</td>
              <td>{p.branch}</td>
              <td className="mono">{den.toLocaleString()}</td>
              <td className="mono">{p.apos.toLocaleString()}</td>
              <td className="mono" style={{ color: Number(r) > 3 ? COLORS.accent : "inherit", fontWeight: Number(r) > 3 ? 600 : 400 }}>{r}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Branch Summary Table (Expandable) ── */
function BranchSummary({ data }) {
  const [expanded, setExpanded] = useState(null);
  if (!data) return null;
  const branches = BRANCHES.filter((b) => data.byBranch[b]);

  const toggle = (b) => setExpanded(expanded === b ? null : b);

  return (
    <table className="branch-summary-table">
      <thead>
        <tr>
          <th style={{ width: 28 }}></th>
          <th>支店</th><th>架電数</th><th>着電数</th><th>アポ数</th>
          <th>アポ率</th><th>着電toアポ率</th><th>着電率</th>
        </tr>
      </thead>
      <tbody>
        {branches.map((b, i) => {
          const d = data.byBranch[b];
          const isOpen = expanded === b;
          const persons = Object.values(data.byPerson)
            .filter((p) => p.branch === b)
            .sort((a, b2) => b2.calls - a.calls);
          return (
            <React.Fragment key={b}>
              <tr
                className={`data-row branch-row ${isOpen ? "expanded" : ""}`}
                style={{ animationDelay: `${i * 0.05}s`, cursor: "pointer" }}
                onClick={() => toggle(b)}
              >
                <td className="chevron-cell">
                  <span className={`chevron ${isOpen ? "open" : ""}`}>▸</span>
                </td>
                <td style={{ fontWeight: 500 }}>{b}</td>
                <td className="mono">{d.calls.toLocaleString()}</td>
                <td className="mono">{d.connects.toLocaleString()}</td>
                <td className="mono">{d.apos.toLocaleString()}</td>
                <td className="mono" style={{ color: COLORS.accent }}>{rate(d.apos, d.calls)}%</td>
                <td className="mono" style={{ color: COLORS.blue }}>{rate(d.apos, d.connects)}%</td>
                <td className="mono" style={{ color: COLORS.amber }}>{rate(d.connects, d.calls)}%</td>
              </tr>
              {isOpen && persons.map((p, j) => (
                <tr key={`${b}-${p.person}`} className="data-row person-row" style={{ animationDelay: `${j * 0.03}s` }}>
                  <td></td>
                  <td className="person-name">└ {p.person}</td>
                  <td className="mono">{p.calls.toLocaleString()}</td>
                  <td className="mono">{p.connects.toLocaleString()}</td>
                  <td className="mono">{p.apos.toLocaleString()}</td>
                  <td className="mono" style={{ color: COLORS.accent }}>{rate(p.apos, p.calls)}%</td>
                  <td className="mono" style={{ color: COLORS.blue }}>{rate(p.apos, p.connects)}%</td>
                  <td className="mono" style={{ color: COLORS.amber }}>{rate(p.connects, p.calls)}%</td>
                </tr>
              ))}
            </React.Fragment>
          );
        })}
        <tr className="data-row total-row" style={{ animationDelay: `${branches.length * 0.05}s` }}>
          <td></td>
          <td style={{ fontWeight: 600 }}>合計</td>
          <td className="mono" style={{ fontWeight: 600 }}>{data.tot.calls.toLocaleString()}</td>
          <td className="mono" style={{ fontWeight: 600 }}>{data.tot.connects.toLocaleString()}</td>
          <td className="mono" style={{ fontWeight: 600 }}>{data.tot.apos.toLocaleString()}</td>
          <td className="mono" style={{ fontWeight: 600, color: COLORS.accent }}>{rate(data.tot.apos, data.tot.calls)}%</td>
          <td className="mono" style={{ fontWeight: 600, color: COLORS.blue }}>{rate(data.tot.apos, data.tot.connects)}%</td>
          <td className="mono" style={{ fontWeight: 600, color: COLORS.amber }}>{rate(data.tot.connects, data.tot.calls)}%</td>
        </tr>
      </tbody>
    </table>
  );
}

/* ── Main Dashboard ── */
export default function Dashboard() {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [selMonths, setSelMonths] = useState([]);
  const [selBranches, setSelBranches] = useState([...BRANCHES]);
  const [selPersons, setSelPersons] = useState([]);
  const [rankMode, setRankMode] = useState("apo");
  const [allMonths, setAllMonths] = useState([]);
  const [allPersons, setAllPersons] = useState([]);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      const rows = await fetchSheetData();
      setRawData(rows);
      const months = [...new Set(rows.map((r) => r.month))].sort();
      setAllMonths(months);
      if (selMonths.length === 0) setSelMonths(months.length > 0 ? [months[months.length - 1]] : []);
      const persons = [...new Set(rows.map((r) => r.person))].sort();
      setAllPersons(persons);
      if (selPersons.length === 0) setSelPersons(persons);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(false); }, [loadData]);
  useEffect(() => { const iv = setInterval(() => loadData(true), 300000); return () => clearInterval(iv); }, [loadData]);

  // Derived persons based on selected branches
  const filteredPersonOptions = rawData
    ? [...new Set(rawData.filter((r) => selBranches.includes(r.branch)).map((r) => r.person))].sort()
    : allPersons;

  // Filter data
  const filtered = rawData
    ? rawData.filter((r) => selMonths.includes(r.month) && selBranches.includes(r.branch) && selPersons.includes(r.person))
    : [];
  const agg = aggregate(filtered);

  // Previous month for trend
  const prevMonthData = rawData && selMonths.length === 1 ? (() => {
    const idx = allMonths.indexOf(selMonths[0]);
    if (idx > 0) {
      const pm = allMonths[idx - 1];
      const pRows = rawData.filter((r) => r.month === pm && selBranches.includes(r.branch) && selPersons.includes(r.person));
      return aggregate(pRows);
    }
    return null;
  })() : null;

  const apoRate = Number(rate(agg.tot.apos, agg.tot.calls));
  const cToARate = Number(rate(agg.tot.apos, agg.tot.connects));
  const connRate = Number(rate(agg.tot.connects, agg.tot.calls));

  const prevApoRate = prevMonthData ? Number(rate(prevMonthData.tot.apos, prevMonthData.tot.calls)) : null;
  const prevCToARate = prevMonthData ? Number(rate(prevMonthData.tot.apos, prevMonthData.tot.connects)) : null;
  const prevConnRate = prevMonthData ? Number(rate(prevMonthData.tot.connects, prevMonthData.tot.calls)) : null;

  // Weekly chart data — respect month filter (so 1 month shows 4 weeks)
  const chartFiltered = rawData
    ? rawData.filter((r) => selMonths.includes(r.month) && selBranches.includes(r.branch) && selPersons.includes(r.person))
    : [];
  const chartAgg = aggregate(chartFiltered);

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading">
          <div className="spinner" />
          <div className="loading-text">データを読み込んでいます...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="error-msg">
          <h3>データの取得に失敗しました</h3>
          <p>{error}</p>
          <p style={{ marginTop: 12, fontSize: 12 }}>スプレッドシートが「リンクを知っている全員」に共有されているか確認してください。</p>
        </div>
      </div>
    );
  }

  const updateStr = lastUpdated
    ? `${lastUpdated.getHours().toString().padStart(2, "0")}:${lastUpdated.getMinutes().toString().padStart(2, "0")}:${lastUpdated.getSeconds().toString().padStart(2, "0")}`
    : "--:--:--";

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="header">
        <div className="header-left">
          <div className="header-title">PCN 営業KPI ダッシュボード</div>
          <div className="header-subtitle">
            <span className="live-dot" />
            Pacific Net / Sales Performance · 最終更新 {updateStr}
          </div>
        </div>
        <div className="filters">
          <FilterDropdown label="月" options={allMonths} selected={selMonths} onChange={setSelMonths} />
          <FilterDropdown label="支店" options={BRANCHES} selected={selBranches} onChange={setSelBranches} />
          <FilterDropdown label="担当者" options={filteredPersonOptions} selected={selPersons} onChange={(v) => setSelPersons(v)} />
          <button
            className={`refresh-btn ${refreshing ? "spinning" : ""}`}
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="データを今すぐ更新"
            aria-label="更新"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>更新</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-row">
        <KpiCard label="架電数" value={agg.tot.calls} unit="" colorClass="c-white"
          trend={prevMonthData ? agg.tot.calls - prevMonthData.tot.calls : undefined} />
        <KpiCard label="アポ率" value={apoRate} unit="%" colorClass="c-accent"
          trend={prevApoRate !== null ? apoRate - prevApoRate : undefined} />
        <KpiCard label="着電toアポ率" value={cToARate} unit="%" colorClass="c-blue"
          trend={prevCToARate !== null ? cToARate - prevCToARate : undefined} />
        <KpiCard label="着電率" value={connRate} unit="%" colorClass="c-amber"
          trend={prevConnRate !== null ? connRate - prevConnRate : undefined} />
      </div>

      {/* Yield Trend */}
      <div className="panels-row">
        <div className="panel">
          <div className="panel-title"><span>歩留まり推移</span></div>
          <YieldChart data={chartAgg} />
        </div>
      </div>

      {/* Branch Chart + Ranking */}
      <div className="panels-2col">
        <div className="panel">
          <div className="panel-title"><span>支店別比較</span></div>
          <BranchChart data={agg} />
        </div>
        <div className="panel">
          <div className="panel-title">
            <span>個人ランキング</span>
            <div className="tab-group">
              <button className={`tab-btn ${rankMode === "apo" ? "active" : ""}`} onClick={() => setRankMode("apo")}>アポ率</button>
              <button className={`tab-btn ${rankMode === "ctoa" ? "active" : ""}`} onClick={() => setRankMode("ctoa")}>着電toアポ率</button>
            </div>
          </div>
          <RankingTable data={agg} mode={rankMode} />
        </div>
      </div>

      {/* Branch Summary */}
      <div className="panels-row">
        <div className="panel">
          <div className="panel-title"><span>支店サマリー</span></div>
          <BranchSummary data={agg} />
        </div>
      </div>
    </div>
  );
}
