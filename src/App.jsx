import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Database,
  ExternalLink,
  Filter,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Trophy,
  WifiOff,
} from "lucide-react";
import SpainChampionChat from "./assets/spain-champion-chat.svg";

const STAGE_LABELS = {
  "First Stage": "小组赛",
  "Round of 32": "32 强",
  "Round of 16": "16 强",
  "Quarter-finals": "四分之一决赛",
  "Semi-finals": "半决赛",
  "Play-off for third place": "季军赛",
  Final: "决赛",
};

const REGION_LABELS = {
  us: "美国盘口",
  uk: "英国盘口",
  eu: "欧洲盘口",
  au: "澳洲盘口",
};

const TEAM_ALIASES = {
  usa: "unitedstates",
  unitedstates: "unitedstates",
  korearepublic: "southkorea",
  southkorea: "southkorea",
  turkiye: "turkey",
  turkey: "turkey",
  iriran: "iran",
  iran: "iran",
  cotedivoire: "ivorycoast",
  ivorycoast: "ivorycoast",
  curacao: "curacao",
  "cabo verde": "capeverde",
  caboverde: "capeverde",
  capeverde: "capeverde",
  congodr: "drcongo",
  drcongo: "drcongo",
  democraticrepublicofcongo: "drcongo",
  czechia: "czechrepublic",
  czechrepublic: "czechrepublic",
};

const TEAM_NAME_ZH = {
  Algeria: "阿尔及利亚",
  Argentina: "阿根廷",
  Australia: "澳大利亚",
  Austria: "奥地利",
  Belgium: "比利时",
  "Bosnia and Herzegovina": "波黑",
  Brazil: "巴西",
  Canada: "加拿大",
  "Cabo Verde": "佛得角",
  Colombia: "哥伦比亚",
  "Congo DR": "刚果民主共和国",
  Croatia: "克罗地亚",
  Curaçao: "库拉索",
  Czechia: "捷克",
  "Côte d'Ivoire": "科特迪瓦",
  Ecuador: "厄瓜多尔",
  Egypt: "埃及",
  England: "英格兰",
  France: "法国",
  Germany: "德国",
  Ghana: "加纳",
  Haiti: "海地",
  "IR Iran": "伊朗",
  Iraq: "伊拉克",
  Japan: "日本",
  Jordan: "约旦",
  "Korea Republic": "韩国",
  Mexico: "墨西哥",
  Morocco: "摩洛哥",
  Netherlands: "荷兰",
  "New Zealand": "新西兰",
  Norway: "挪威",
  Panama: "巴拿马",
  Paraguay: "巴拉圭",
  Portugal: "葡萄牙",
  Qatar: "卡塔尔",
  "Saudi Arabia": "沙特阿拉伯",
  Scotland: "苏格兰",
  Senegal: "塞内加尔",
  "South Africa": "南非",
  Spain: "西班牙",
  Sweden: "瑞典",
  Switzerland: "瑞士",
  Tunisia: "突尼斯",
  Türkiye: "土耳其",
  Uruguay: "乌拉圭",
  USA: "美国",
  Uzbekistan: "乌兹别克斯坦",
};

function normalizeName(value = "") {
  const compact = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
  return TEAM_ALIASES[compact] || compact;
}

function displayTeamName(team) {
  if (!team?.isPlaceholder) return TEAM_NAME_ZH[team?.name] || team?.name || "待定";

  const code = team.abbreviation || "";
  const groupPlace = code.match(/^(\d)([A-L])$/i);
  if (groupPlace) {
    const [, place, group] = groupPlace;
    if (place === "1") return `${group.toUpperCase()} 组第一`;
    if (place === "2") return `${group.toUpperCase()} 组第二`;
    if (place === "3") return `${group.toUpperCase()} 组第三`;
  }

  const winner = code.match(/^W(\d+)$/i);
  if (winner) return `${winner[1]} 场胜者`;

  const runnerUp = code.match(/^L(\d+)$/i);
  if (runnerUp) return `${runnerUp[1]} 场负者`;

  return team?.name || "待定";
}

function sameTeam(a, b) {
  if (!a || !b) return false;
  return normalizeName(a) === normalizeName(b);
}

function teamKnown(match) {
  return !match.home?.isPlaceholder && !match.away?.isPlaceholder;
}

function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || "未定阶段";
}

function formatUserTime(iso) {
  if (!iso) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDateTitle(localDate) {
  if (!localDate) return "日期待定";
  const date = new Date(`${localDate.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function formatVenueClock(localDate) {
  if (!localDate) return "赛地时间待定";
  const time = localDate.slice(11, 16);
  return time ? `${time} 赛地时间` : "赛地时间待定";
}

function formatFetchedAt(iso) {
  if (!iso) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function matchOddsFor(scheduleMatch, events) {
  if (!teamKnown(scheduleMatch)) return null;
  const matchTime = new Date(scheduleMatch.dateUtc).getTime();

  return events.find((event) => {
    const eventTime = new Date(event.commence_time).getTime();
    const hoursApart = Math.abs(eventTime - matchTime) / 36e5;
    if (hoursApart > 18) return false;

    const direct =
      sameTeam(event.home_team, scheduleMatch.home.name) &&
      sameTeam(event.away_team, scheduleMatch.away.name);
    const reversed =
      sameTeam(event.home_team, scheduleMatch.away.name) &&
      sameTeam(event.away_team, scheduleMatch.home.name);

    return direct || reversed;
  });
}

function bestPrices(event, match) {
  if (!event?.bookmakers?.length) return [];

  const buckets = [
    { key: "home", label: match.home.abbreviation || "主胜", teamName: match.home.name, prices: [] },
    { key: "draw", label: "平局", teamName: "Draw", prices: [] },
    { key: "away", label: match.away.abbreviation || "客胜", teamName: match.away.name, prices: [] },
  ];

  event.bookmakers.forEach((bookmaker) => {
    bookmaker.markets
      ?.filter((market) => market.key === "h2h")
      .forEach((market) => {
        market.outcomes?.forEach((outcome) => {
          let bucket = null;
          if (sameTeam(outcome.name, match.home.name) || sameTeam(outcome.name, event.home_team)) {
            bucket = buckets[0];
          } else if (sameTeam(outcome.name, match.away.name) || sameTeam(outcome.name, event.away_team)) {
            bucket = buckets[2];
          } else if (normalizeName(outcome.name) === "draw") {
            bucket = buckets[1];
          }

          if (bucket && typeof outcome.price === "number") {
            bucket.prices.push({
              bookmaker: bookmaker.title,
              price: outcome.price,
              lastUpdate: bookmaker.last_update,
            });
          }
        });
      });
  });

  return buckets.map((bucket) => {
    const best = [...bucket.prices].sort((a, b) => b.price - a.price)[0];
    return {
      ...bucket,
      best,
    };
  });
}

function groupByDate(matches) {
  return matches.reduce((groups, match) => {
    const key = match.localDate?.slice(0, 10) || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
    return groups;
  }, new Map());
}

function uniqueValues(matches, key) {
  return [...new Set(matches.map((match) => match[key]).filter(Boolean))];
}

function useDashboardData(region) {
  const [state, setState] = useState({
    loading: true,
    schedule: null,
    odds: null,
    sports: null,
    error: "",
  });

  async function load() {
    setState((current) => ({ ...current, loading: true, error: "" }));
    const oddsUrl = `/api/odds?regions=${encodeURIComponent(region)}&markets=h2h`;

    const [scheduleResult, oddsResult, sportsResult] = await Promise.allSettled([
      fetch("/api/schedule").then((res) => {
        if (!res.ok) throw new Error("FIFA 赛程加载失败");
        return res.json();
      }),
      fetch(oddsUrl).then((res) => {
        if (!res.ok) throw new Error("赔率加载失败");
        return res.json();
      }),
      fetch("/api/sports-status").then((res) => {
        if (!res.ok) throw new Error("赔率项目状态加载失败");
        return res.json();
      }),
    ]);

    const next = {
      loading: false,
      schedule: scheduleResult.status === "fulfilled" ? scheduleResult.value : null,
      odds: oddsResult.status === "fulfilled" ? oddsResult.value : null,
      sports: sportsResult.status === "fulfilled" ? sportsResult.value : null,
      error: "",
    };

    const errors = [scheduleResult, oddsResult, sportsResult]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message);
    next.error = errors.join("；");
    setState(next);
  }

  useEffect(() => {
    load();
  }, [region]);

  return { ...state, reload: load };
}

function TeamBadge({ team }) {
  const displayName = displayTeamName(team);

  return (
    <div className="team">
      {team.flagUrl ? (
        <img className="flag" src={team.flagUrl} alt="" loading="lazy" />
      ) : (
        <span className="flag placeholder">{team.abbreviation || "TBD"}</span>
      )}
      <div>
        <div className="team-name" title={team.name || displayName}>
          {displayName}
        </div>
        <div className="team-code">{team.abbreviation || "TBD"}</div>
      </div>
    </div>
  );
}

function OddsBlock({ event, match }) {
  if (!event) {
    return (
      <div className="odds-empty">
        <WifiOff size={16} />
        <span>{teamKnown(match) ? "暂无胜平负赔率" : "球队未确定，赔率暂未开放"}</span>
      </div>
    );
  }

  const prices = bestPrices(event, match);

  return (
    <div className="odds-block">
      <div className="odds-meta">
        <CircleDollarSign size={16} />
        <span>{event.bookmakers?.length || 0} 家公司</span>
      </div>
      <div className="price-grid">
        {prices.map((item) => (
          <div className="price-cell" key={item.key}>
            <span>{item.label}</span>
            <strong>{item.best ? item.best.price.toFixed(2) : "-"}</strong>
            <small>{item.best?.bookmaker || "无报价"}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchCard({ match, oddsEvent }) {
  return (
    <article className="match-card">
      <div className="match-head">
        <div>
          <span className="match-number">Match {match.matchNumber}</span>
          <span className="stage-pill">{stageLabel(match.stage)}</span>
          {match.group ? <span className="group-pill">{match.group}</span> : null}
        </div>
        <a className="icon-link" href={match.sourceUrl} target="_blank" rel="noreferrer" title="打开 FIFA 比赛页">
          <ExternalLink size={16} />
        </a>
      </div>

      <div className="teams-row">
        <TeamBadge team={match.home} />
        <span className="versus">v</span>
        <TeamBadge team={match.away} />
      </div>

      <div className="match-details">
        <span>
          <Clock3 size={15} />
          {formatUserTime(match.dateUtc)}
        </span>
        <span>
          <MapPin size={15} />
          {match.stadium.name}, {match.stadium.city}
        </span>
        <span>
          <CalendarDays size={15} />
          {formatVenueClock(match.localDate)}
        </span>
      </div>

      <OddsBlock event={oddsEvent} match={match} />
    </article>
  );
}

function SourcePanel({ schedule, odds, sports }) {
  const worldCupStatus = sports?.sports?.find((sport) => sport.key === "soccer_fifa_world_cup");
  const winnerStatus = sports?.sports?.find((sport) => sport.key === "soccer_fifa_world_cup_winner");
  const ttlHours = odds?.cachePolicy?.ttlHours || schedule?.cachePolicy?.ttlHours || 24;

  return (
    <aside className="source-panel">
      <section className="panel-section">
        <h2>
          <ShieldCheck size={18} />
          数据来源
        </h2>
        <a className="source-link" href={schedule?.source?.pageUrl} target="_blank" rel="noreferrer">
          <span>
            <strong>FIFA 官方赛程页</strong>
            <small>104 场赛程、比赛地、官方比赛页</small>
          </span>
          <ExternalLink size={16} />
        </a>
        <a className="source-link" href={odds?.source?.docsUrl || "https://the-odds-api.com/liveapi/guides/v4/"} target="_blank" rel="noreferrer">
          <span>
            <strong>The Odds API</strong>
            <small>胜平负赔率，后端代理并缓存</small>
          </span>
          <ExternalLink size={16} />
        </a>
      </section>

      <section className="panel-section">
        <h2>
          <Database size={18} />
          同步状态
        </h2>
        <div className="status-list">
          <div>
            <span>FIFA 赛程</span>
            <strong>{formatFetchedAt(schedule?.fetchedAt)}</strong>
          </div>
          <div>
            <span>赔率</span>
            <strong>{formatFetchedAt(odds?.fetchedAt)}</strong>
          </div>
          <div>
            <span>额度剩余</span>
            <strong>{odds?.usage?.remaining ?? "未知"}</strong>
          </div>
          <div>
            <span>刷新策略</span>
            <strong>{ttlHours} 小时</strong>
          </div>
        </div>
        {odds?.stale || schedule?.stale ? (
          <p className="fineprint warning">当前显示旧缓存，下一次 API 可用时会自动更新。</p>
        ) : null}
      </section>

      <section className="panel-section">
        <h2>
          <BadgeCheck size={18} />
          项目状态
        </h2>
        <div className="sport-status">
          <span className={worldCupStatus?.active ? "dot active" : "dot"} />
          <span>单场赔率</span>
          <strong>{worldCupStatus?.active ? "Active" : "Inactive"}</strong>
        </div>
        <div className="sport-status">
          <span className={winnerStatus?.active ? "dot active" : "dot"} />
          <span>冠军赔率</span>
          <strong>{winnerStatus?.active ? "Active" : "Inactive"}</strong>
        </div>
        <p className="fineprint">赔率会随盘口变化，页面仅作资讯展示，不构成投注建议。</p>
      </section>
    </aside>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="stat">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [group, setGroup] = useState("all");
  const [onlyWithOdds, setOnlyWithOdds] = useState(false);
  const [region, setRegion] = useState("us");
  const { loading, schedule, odds, sports, error, reload } = useDashboardData(region);

  const matches = schedule?.matches || [];
  const oddsEvents = odds?.events || [];

  const matchRows = useMemo(() => {
    return matches.map((match) => ({
      match,
      oddsEvent: matchOddsFor(match, oddsEvents),
    }));
  }, [matches, oddsEvents]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return matchRows.filter(({ match, oddsEvent }) => {
      if (stage !== "all" && match.stage !== stage) return false;
      if (group !== "all" && match.group !== group) return false;
      if (onlyWithOdds && !oddsEvent) return false;

      if (!normalizedQuery) return true;
      const haystack = [
        match.home.name,
        displayTeamName(match.home),
        match.home.abbreviation,
        match.away.name,
        displayTeamName(match.away),
        match.away.abbreviation,
        match.stadium.name,
        match.stadium.city,
        match.group,
        match.stage,
        String(match.matchNumber),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [group, matchRows, onlyWithOdds, query, stage]);

  const rowsByDate = useMemo(() => {
    const grouped = groupByDate(filteredRows.map((row) => row.match));
    return [...grouped.entries()].map(([date, dateMatches]) => ({
      date,
      rows: dateMatches.map((match) => filteredRows.find((row) => row.match.id === match.id)),
    }));
  }, [filteredRows]);

  const stages = uniqueValues(matches, "stage");
  const groups = uniqueValues(matches, "group");
  const withOddsCount = matchRows.filter((row) => row.oddsEvent).length;
  const nextMatch = matches.find((match) => new Date(match.dateUtc) > new Date());

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Trophy size={24} />
          </div>
          <div>
            <p>FIFA World Cup 2026</p>
            <h1>世界杯赛程与赔率</h1>
          </div>
        </div>
        <button className="refresh-button" onClick={reload} disabled={loading}>
          {loading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          同步数据
        </button>
      </header>

      <section className="hero-band">
        <div className="hero-copy">
          <span>官方赛程 + 实时赔率</span>
          <h2>104 场比赛按比赛日追踪，赔率从后端安全拉取。</h2>
        </div>
        <div className="hero-chat-shot" aria-label="不要买西班牙冠军热门截图">
          <img src={SpainChampionChat} alt="@所有人 不要买西班牙冠军" />
        </div>
      </section>

      <section className="stats-grid">
        <Stat icon={CalendarDays} label="官方赛程" value={`${matches.length || 0} 场`} />
        <Stat icon={CircleDollarSign} label="已匹配赔率" value={`${withOddsCount} 场`} />
        <Stat icon={Clock3} label="下一场" value={nextMatch ? `Match ${nextMatch.matchNumber}` : "待更新"} />
        <Stat icon={Database} label="盘口区域" value={REGION_LABELS[region]} />
      </section>

      <section className="toolbar" aria-label="筛选栏">
        <label className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索球队、城市、场次"
          />
        </label>

        <label className="select-wrap">
          <Filter size={16} />
          <select value={stage} onChange={(event) => setStage(event.target.value)}>
            <option value="all">全部阶段</option>
            {stages.map((item) => (
              <option key={item} value={item}>
                {stageLabel(item)}
              </option>
            ))}
          </select>
        </label>

        <label className="select-wrap">
          <Filter size={16} />
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="all">全部小组</option>
            {groups.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="select-wrap">
          <CircleDollarSign size={16} />
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            {Object.entries(REGION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={onlyWithOdds}
            onChange={(event) => setOnlyWithOdds(event.target.checked)}
          />
          <span>仅看有赔率</span>
        </label>
      </section>

      {error ? <div className="alert">{error}</div> : null}

      <div className="content-grid">
        <section className="schedule-list">
          {loading && !matches.length ? (
            <div className="loading-state">
              <Loader2 className="spin" size={22} />
              <span>正在同步 FIFA 赛程和赔率</span>
            </div>
          ) : rowsByDate.length ? (
            rowsByDate.map(({ date, rows }) => (
              <div className="date-group" key={date}>
                <div className="date-header">
                  <h2>{formatDateTitle(date)}</h2>
                  <span>{rows.length} 场</span>
                </div>
                <div className="match-grid">
                  {rows.map(({ match, oddsEvent }) => (
                    <MatchCard key={match.id} match={match} oddsEvent={oddsEvent} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">没有符合筛选条件的比赛。</div>
          )}
        </section>

        <SourcePanel schedule={schedule} odds={odds} sports={sports} />
      </div>
    </main>
  );
}
