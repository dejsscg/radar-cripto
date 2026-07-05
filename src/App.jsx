import React, { useState, useEffect, useCallback } from "react";

// ================= RADAR CRIPTO =================
// Fuentes de datos (gratuitas, sin API key):
// - CoinGecko: tendencias, mercados, info de proyectos
// - GeckoTerminal: pools/tokens recién lanzados (alpha)
// - publicnode.com RPC: balances ETH y tokens ERC-20
// - blockchain.info: balances BTC
// ================================================

const C = {
  bg: "#06111A",
  surface: "#0C1D2A",
  surface2: "#122636",
  line: "#1C3849",
  text: "#D8E6EE",
  dim: "#93AEBB",
  sonar: "#3FD9C0",
  gold: "#E8B44C",
  red: "#E8695C",
  blue: "#5CA8E8",
};

const fmtUsd = (n) => {
  if (n == null || isNaN(n)) return "—";
  n = Number(n);
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toPrecision(3);
};
const fmtNum = (n, d = 4) => {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
};
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return Math.floor(s / 60) + " min";
  if (s < 86400) return Math.floor(s / 3600) + " h";
  return Math.floor(s / 86400) + " d";
};
const truncAddr = (addr) =>
  !addr ? "—" : addr.length > 18 ? addr.slice(0, 8) + "…" + addr.slice(-6) : addr;

// ---------- estilos base ----------
const styles = {
  app: {
    minHeight: "100vh",
    background: C.bg,
    backgroundImage: `radial-gradient(${C.line}88 1px, transparent 1px)`,
    backgroundSize: "28px 28px",
    color: C.text,
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    padding: "0 0 60px 0",
  },
  mono: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" },
  card: {
    background: C.surface,
    border: `1px solid ${C.line}`,
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 2px 16px rgba(0,0,0,.35)",
  },
  btn: {
    background: C.surface2,
    color: C.sonar,
    border: `1px solid ${C.sonar}44`,
    borderRadius: 8,
    padding: "8px 14px",
    cursor: "pointer",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
  },
  input: {
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    padding: "10px 12px",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
  },
  tag: (color) => ({
    display: "inline-block",
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 20,
    border: `1px solid ${color}55`,
    color,
    fontFamily: "'IBM Plex Mono', monospace",
  }),
};

// ---------- Ethereum RPC helpers ----------
const ETH_RPC = "https://ethereum-rpc.publicnode.com";
async function ethRpc(method, params) {
  const r = await fetchRetry(ETH_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function getEthBalance(addr) {
  const hex = await ethRpc("eth_getBalance", [addr, "latest"]);
  return parseInt(hex, 16) / 1e18;
}
async function getErc20Balance(contract, addr) {
  const padded = addr.toLowerCase().replace("0x", "").padStart(64, "0");
  const [balHex, decHex] = await Promise.all([
    ethRpc("eth_call", [{ to: contract, data: "0x70a08231" + padded }, "latest"]),
    ethRpc("eth_call", [{ to: contract, data: "0x313ce567" }, "latest"]),
  ]);
  const dec = parseInt(decHex, 16) || 18;
  return parseInt(balHex, 16) / Math.pow(10, dec);
}
async function getBtcBalance(addr) {
  const r = await fetchRetry(
    `https://blockchain.info/rawaddr/${addr}?cors=true&limit=0`
  );
  if (!r.ok) throw new Error("Error consultando blockchain.info");
  const j = await r.json();
  return j.final_balance / 1e8;
}

// ---------- almacenamiento persistente ----------
async function loadWalletData() {
  try {
    const r = localStorage.getItem("radar-wallets");
    return r ? JSON.parse(r) : { wallets: [], snapshots: {} };
  } catch {
    return { wallets: [], snapshots: {} };
  }
}
async function saveWalletData(data) {
  try {
    localStorage.setItem("radar-wallets", JSON.stringify(data));
  } catch (e) {
    console.error("No se pudo guardar", e);
  }
}

// fetch con reintentos automáticos y backoff (para rate limits / redes móviles)
async function fetchRetry(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(to);
      if (r.status === 429) throw new Error("rate limit");
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 2500 * (i + 1)));
    }
  }
  throw lastErr;
}

// ================= TAB: TENDENCIAS =================
function Tendencias({ onSelectCoin }) {
  const [trending, setTrending] = useState(null);
  const [gainers, setGainers] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [maxAgeMonths, setMaxAgeMonths] = useState(0); // 0 = todas
  const [hideTop, setHideTop] = useState(false); // ocultar top 20 por market cap

  // antigüedad aproximada: la fecha más vieja entre ATL y ATH que reporta CoinGecko
  const coinAgeMonths = (coin) => {
    const dates = [coin.atl_date, coin.ath_date].filter(Boolean).map((d) => new Date(d).getTime());
    if (!dates.length) return Infinity;
    return (Date.now() - Math.min(...dates)) / (30 * 86400000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [tr, mk] = await Promise.all([
        fetchRetry("https://api.coingecko.com/api/v3/search/trending").then((r) =>
          r.json()
        ),
        fetchRetry(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h,7d"
        ).then((r) => r.json()),
      ]);
      setTrending(tr.coins || []);
      const sorted = [...mk].sort(
        (a, b) =>
          (b.price_change_percentage_24h || 0) -
          (a.price_change_percentage_24h || 0)
      );
      setGainers(sorted);
    } catch (e) {
      setErr("No se pudieron cargar tendencias. CoinGecko puede estar limitando peticiones — ya reintenté 3 veces automáticamente; pulsa Actualizar de nuevo.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px" }}>Radar de tendencias</h2>
        <button style={styles.btn} onClick={load} disabled={loading}>
          {loading ? "Cargando…" : "↻ Actualizar"}
        </button>
      </div>
      {err && (
        <div style={{ ...styles.card, borderColor: C.red + "99", background: C.red + "0D", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
          <span style={{ color: C.red, fontSize: 13, lineHeight: 1.5 }}>{err}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 16, ...styles.mono, fontSize: 12 }}>
        <span style={{ color: C.dim, marginRight: 2 }}>Antigüedad:</span>
        {[
          { v: 0, l: "Todas" },
          { v: 3, l: "< 3m" },
          { v: 6, l: "< 6m" },
          { v: 12, l: "< 1a" },
        ].map((o) => (
          <button key={o.v} className="filter-btn"
            style={{ ...styles.btn, padding: "4px 10px", fontSize: 12,
              background: maxAgeMonths === o.v ? C.sonar + "1A" : "transparent",
              borderColor: maxAgeMonths === o.v ? C.sonar : C.line,
              color: maxAgeMonths === o.v ? C.sonar : C.dim }}
            onClick={() => setMaxAgeMonths(o.v)}>
            {o.l}
          </button>
        ))}
        <button className="filter-btn"
          style={{ ...styles.btn, padding: "4px 10px", fontSize: 12,
            background: hideTop ? C.sonar + "1A" : "transparent",
            borderColor: hideTop ? C.sonar : C.line,
            color: hideTop ? C.sonar : C.dim }}
          onClick={() => setHideTop(!hideTop)}>
          {hideTop ? "✓ " : ""}Sin top 20
        </button>
      </div>

      {loading && !trending && (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div className="loading-dots"><span/><span/><span/></div>
          <p style={{ ...styles.mono, fontSize: 12, color: C.dim, marginTop: 14 }}>Consultando CoinGecko…</p>
        </div>
      )}
      <div className="section-label" style={{ marginTop: 4 }}>🔥 Más buscadas ahora (CoinGecko)</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10, marginBottom: 24 }}>
        {trending?.filter(({ item }) => !hideTop || !item.market_cap_rank || item.market_cap_rank > 20).map(({ item }) => {
          const chg = item.data?.price_change_percentage_24h?.usd;
          const accentColor = chg == null ? C.line : chg >= 0 ? C.sonar : C.red;
          return (
            <div
              key={item.id}
              className="card-hover"
              style={{ ...styles.card, borderLeft: `3px solid ${accentColor}88` }}
              onClick={() => onSelectCoin(item.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src={item.small} alt="" width={32} height={32} style={{ borderRadius: 16 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "baseline", gap: 6 }}>
                    {item.name}
                    <span style={{ color: C.dim, fontSize: 11, ...styles.mono }}>{item.symbol}</span>
                  </div>
                  <div style={{ ...styles.mono, fontSize: 11, color: C.dim }}>
                    #{item.market_cap_rank ?? "—"} · {item.data?.price ? fmtUsd(item.data.price) : ""}
                  </div>
                </div>
                {chg != null && (
                  <span style={{ ...styles.tag(chg >= 0 ? C.sonar : C.red), flexShrink: 0 }}>
                    {chg >= 0 ? "+" : ""}{chg.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-label">📈 Mayores subidas 24h (top 100 por market cap)</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
        {gainers
          ?.filter((c) => !hideTop || !c.market_cap_rank || c.market_cap_rank > 20)
          .filter((c) => maxAgeMonths === 0 || coinAgeMonths(c) <= maxAgeMonths)
          .slice(0, 12)
          .map((c) => (
          <div key={c.id} className="card-hover" style={{ ...styles.card, borderLeft: `3px solid ${(c.price_change_percentage_24h || 0) >= 0 ? C.sonar : C.red}88` }} onClick={() => onSelectCoin(c.id)}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src={c.image} alt="" width={32} height={32} style={{ borderRadius: 16 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: "flex", alignItems: "baseline", gap: 6 }}>
                  {c.name}
                  <span style={{ color: C.dim, fontSize: 11, ...styles.mono }}>{c.symbol.toUpperCase()}</span>
                </div>
                <div style={{ ...styles.mono, fontSize: 11, color: C.dim }}>{fmtUsd(c.current_price)} · MC {fmtUsd(c.market_cap)}</div>
              </div>
              <span style={{ ...styles.tag((c.price_change_percentage_24h || 0) >= 0 ? C.sonar : C.red), flexShrink: 0, fontWeight: 600 }}>
                {(c.price_change_percentage_24h || 0) >= 0 ? "+" : ""}{(c.price_change_percentage_24h || 0).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= DETALLE DE MONEDA (proyecto + redes) =================
function CoinDetail({ coinId, onClose }) {
  const [coin, setCoin] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(null);

  const copyAddr = (net, addr) => {
    try { navigator.clipboard.writeText(addr); } catch {}
    setCopied(net);
    setTimeout(() => setCopied(null), 1500);
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchRetry(
          `https://api.coingecko.com/api/v3/coins/${coinId}?localization=true&tickers=false&community_data=true&developer_data=false`
        );
        if (!r.ok) throw new Error();
        setCoin(await r.json());
      } catch {
        setErr("No se pudo cargar la info del proyecto (límite de API). Ya reintenté 3 veces; pulsa Escanear de nuevo.");
      }
    })();
  }, [coinId]);

  const desc =
    coin?.description?.es?.trim() || coin?.description?.en?.trim() || "";
  const links = coin?.links || {};
  const linkList = [
    { label: "🌐 Sitio web", url: links.homepage?.[0] },
    { label: "𝕏 Twitter", url: links.twitter_screen_name ? `https://x.com/${links.twitter_screen_name}` : null },
    { label: "🔍 Menciones en X (live)", url: coin?.symbol ? `https://x.com/search?q=%24${coin.symbol.toUpperCase()}&f=live` : null },
    { label: "✈️ Telegram", url: links.telegram_channel_identifier ? `https://t.me/${links.telegram_channel_identifier}` : null },
    { label: "💬 Reddit", url: links.subreddit_url },
    { label: "📄 Whitepaper", url: links.whitepaper },
    { label: "⌨️ GitHub", url: links.repos_url?.github?.[0] },
  ].filter((l) => l.url);

  const chg24 = coin?.market_data?.price_change_percentage_24h || 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(4,10,16,.85)",
        backdropFilter: "blur(10px)",
        zIndex: 50,
        display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 0 0",
      }}
      onClick={onClose}
    >
      <div
        className="modal-body"
        style={{
          ...styles.card,
          width: "100%", maxWidth: 600,
          maxHeight: "90vh", overflowY: "auto",
          background: C.surface2,
          borderRadius: "16px 16px 0 0",
          borderBottom: "none",
          padding: "0 0 40px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header del modal */}
        <div style={{
          position: "sticky", top: 0,
          background: C.surface2,
          borderBottom: `1px solid ${C.line}`,
          padding: "16px 20px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderRadius: "16px 16px 0 0",
          zIndex: 1,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {coin ? (
              <>
                <img src={coin.image?.small} alt="" width={36} height={36} style={{ borderRadius: 18 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.3px" }}>{coin.name}</div>
                  <div style={{ ...styles.mono, fontSize: 11, color: C.dim }}>{coin.symbol?.toUpperCase()} · Rank #{coin.market_cap_rank ?? "—"}</div>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="loading-dots"><span/><span/><span/></div>
                <span style={{ ...styles.mono, fontSize: 12, color: C.dim }}>Cargando…</span>
              </div>
            )}
          </div>
          <button style={{ ...styles.btn, padding: "6px 12px", background: "transparent", borderColor: C.line }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "0 20px" }}>
          {err && (
            <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 8, background: C.red + "0D", border: `1px solid ${C.red}44`, color: C.red, fontSize: 13 }}>
              ⚠️ {err}
            </div>
          )}
          {coin && (
            <>
              {/* Stat grid 2×2 */}
              <div className="stat-grid-4">
                <div>
                  <div className="stat-cell-label">Precio</div>
                  <div className="stat-cell-value accent">{fmtUsd(coin.market_data?.current_price?.usd)}</div>
                </div>
                <div>
                  <div className="stat-cell-label">Market Cap</div>
                  <div className="stat-cell-value">{fmtUsd(coin.market_data?.market_cap?.usd)}</div>
                </div>
                <div>
                  <div className="stat-cell-label">24h</div>
                  <div className={`stat-cell-value ${chg24 >= 0 ? "up" : "down"}`}>
                    {chg24 >= 0 ? "+" : ""}{chg24.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="stat-cell-label">Vol 24h</div>
                  <div className="stat-cell-value">{fmtUsd(coin.market_data?.total_volume?.usd)}</div>
                </div>
              </div>

              {/* Social tags */}
              {coin.community_data && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  {coin.community_data.twitter_followers > 0 && (
                    <span style={styles.tag(C.blue)}>𝕏 {fmtNum(coin.community_data.twitter_followers, 0)}</span>
                  )}
                  {coin.community_data.reddit_subscribers > 0 && (
                    <span style={styles.tag(C.gold)}>Reddit {fmtNum(coin.community_data.reddit_subscribers, 0)}</span>
                  )}
                  {coin.watchlist_portfolio_users > 0 && (
                    <span style={styles.tag(C.sonar)}>👁 {fmtNum(coin.watchlist_portfolio_users, 0)}</span>
                  )}
                </div>
              )}

              {/* Contratos */}
              {coin.platforms && Object.entries(coin.platforms).filter(([, a]) => a).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="section-label">📜 Contratos oficiales</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {Object.entries(coin.platforms).filter(([, a]) => a).map(([net, addr]) => (
                      <div key={net} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: C.surface, border: `1px solid ${C.line}`,
                        borderRadius: 8, padding: "8px 10px",
                      }}>
                        <span style={styles.tag(C.blue)}>{net}</span>
                        <span style={{ ...styles.mono, fontSize: 11, color: C.dim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addr}</span>
                        <button
                          style={{ ...styles.btn, padding: "2px 10px", fontSize: 11, flexShrink: 0,
                            color: copied === net ? C.sonar : C.gold,
                            borderColor: (copied === net ? C.sonar : C.gold) + "55" }}
                          onClick={() => copyAddr(net, addr)}>
                          {copied === net ? "✓" : "copiar"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {coin.platforms && Object.entries(coin.platforms).filter(([, a]) => a).length === 0 && (
                <div style={{ ...styles.mono, fontSize: 11, color: C.dim, marginBottom: 14 }}>
                  Moneda nativa (L1) — sin contrato de token.
                </div>
              )}

              {/* Descripción */}
              {desc && (
                <p style={{ fontSize: 13, lineHeight: 1.7, color: C.dim, marginBottom: 16 }}>
                  {desc.replace(/<[^>]+>/g, "").slice(0, 1000) + (desc.length > 1000 ? "…" : "")}
                </p>
              )}

              {/* Links */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {linkList.map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer"
                    style={{ ...styles.btn, textDecoration: "none", fontSize: 12, background: C.surface }}>
                    {l.label}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ================= TAB: ALPHA (nuevos lanzamientos) =================
function Alpha() {
  const [pools, setPools] = useState(null);
  const [tokens, setTokens] = useState({});
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null); // {pool, info}
  const [minLiq, setMinLiq] = useState(10000);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchRetry(
        "https://api.geckoterminal.com/api/v2/networks/new_pools?include=base_token&page=1"
      );
      const j = await r.json();
      const tokMap = {};
      (j.included || []).forEach((t) => {
        if (t.type === "token") tokMap[t.id] = t.attributes;
      });
      setTokens(tokMap);
      setPools(j.data || []);
    } catch {
      setErr("No se pudieron cargar nuevos lanzamientos. Ya reintenté 3 veces; pulsa Escanear de nuevo.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (pool) => {
    const network = pool.id.split("_")[0];
    const tokenId = pool.relationships?.base_token?.data?.id;
    const tokenAddr = tokenId ? tokenId.slice(tokenId.indexOf("_") + 1) : null;
    setDetail({ pool, network, info: null, loading: true });
    if (tokenAddr) {
      try {
        const r = await fetchRetry(
          `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddr}/info`
        );
        const j = await r.json();
        setDetail({ pool, network, info: j.data?.attributes || null, loading: false });
      } catch {
        setDetail({ pool, network, info: null, loading: false });
      }
    } else {
      setDetail({ pool, network, info: null, loading: false });
    }
  };

  const filtered = (pools || []).filter(
    (p) => Number(p.attributes.reserve_in_usd || 0) >= minLiq
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px" }}>Alpha · tokens recién lanzados</h2>
        <button style={styles.btn} onClick={load} disabled={loading}>
          {loading ? "Escaneando…" : "↻ Escanear"}
        </button>
      </div>
      <p style={{ color: C.dim, fontSize: 13, marginTop: 0, lineHeight: 1.6 }}>
        Pools creados en las últimas horas en todas las redes (GeckoTerminal). ⚠️ Zona de altísimo riesgo:
        la mayoría de tokens nuevos son scams o mueren en días. El filtro de liquidez descarta lo más basura.
      </p>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 16, ...styles.mono, fontSize: 12 }}>
        <span style={{ color: C.dim, marginRight: 2 }}>Liquidez mín:</span>
        {[10000, 100000, 1000000, 5000000].map((v) => (
          <button key={v} className="filter-btn"
            style={{ ...styles.btn, padding: "4px 10px", fontSize: 12,
              background: minLiq === v ? C.sonar + "1A" : "transparent",
              borderColor: minLiq === v ? C.sonar : C.line,
              color: minLiq === v ? C.sonar : C.dim }}
            onClick={() => setMinLiq(v)}>
            {fmtUsd(v)}
          </button>
        ))}
      </div>
      {err && (
        <div style={{ ...styles.card, borderColor: C.red + "99", background: C.red + "0D", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
          <span style={{ color: C.red, fontSize: 13, lineHeight: 1.5 }}>{err}</span>
        </div>
      )}

      {loading && !pools && (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div className="loading-dots"><span/><span/><span/></div>
          <p style={{ ...styles.mono, fontSize: 12, color: C.dim, marginTop: 14 }}>Escaneando GeckoTerminal…</p>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
        {filtered.map((p) => {
          const a = p.attributes;
          const network = p.id.split("_")[0];
          const tokenId = p.relationships?.base_token?.data?.id;
          const tok = tokenId ? tokens[tokenId] : null;
          return (
            <div key={p.id} className="card-hover" style={{ ...styles.card }} onClick={() => openDetail(p)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tok?.symbol || a.name?.split("/")[0] || "?"}
                  </div>
                  <div style={{ color: C.dim, fontSize: 11, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tok?.name || a.name}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                  <span style={styles.tag(C.blue)}>{network}</span>
                  {(() => {
                    const mins = (Date.now() - new Date(a.pool_created_at).getTime()) / 60000;
                    return mins < 60
                      ? <span className="badge-new">NEW</span>
                      : <span style={{ ...styles.mono, fontSize: 10, color: C.dim }}>{timeAgo(a.pool_created_at)}</span>;
                  })()}
                </div>
              </div>
              <div className="stat-grid">
                <div>
                  <div className="stat-cell-label">Precio</div>
                  <div className="stat-cell-value accent">{fmtUsd(a.base_token_price_usd)}</div>
                </div>
                <div>
                  <div className="stat-cell-label">Liquidez</div>
                  <div className="stat-cell-value">{fmtUsd(a.reserve_in_usd)}</div>
                </div>
                <div>
                  <div className="stat-cell-label">Vol 24h</div>
                  <div className="stat-cell-value">{fmtUsd(a.volume_usd?.h24)}</div>
                </div>
              </div>
            </div>
          );
        })}
        {pools && filtered.length === 0 && (
          <div style={{ ...styles.card, textAlign: "center", padding: "36px 16px", gridColumn: "1/-1" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🔍</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin pools con esa liquidez</div>
            <div style={{ fontSize: 12, color: C.dim }}>Baja el filtro o vuelve a escanear.</div>
          </div>
        )}
      </div>

      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "#000000AA", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setDetail(null)}>
          <div style={{ ...styles.card, maxWidth: 520, width: "100%", maxHeight: "85vh", overflowY: "auto", background: C.surface2 }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{detail.pool.attributes.name}</h3>
              <button style={{ ...styles.btn, padding: "4px 10px" }} onClick={() => setDetail(null)}>✕</button>
            </div>
            {detail.loading && (
              <div style={{ padding: "20px 0", textAlign: "center" }}>
                <div className="loading-dots"><span/><span/><span/></div>
                <p style={{ ...styles.mono, fontSize: 12, color: C.dim, marginTop: 12 }}>Buscando info del proyecto…</p>
              </div>
            )}
            {!detail.loading && detail.info && (
              <>
                <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                  {detail.info.description || "El proyecto aún no publicó descripción en GeckoTerminal (señal de precaución)."}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(detail.info.websites || []).map((w) => (
                    <a key={w} href={w} target="_blank" rel="noreferrer" style={{ ...styles.btn, textDecoration: "none", fontSize: 12 }}>🌐 Web</a>
                  ))}
                  {detail.info.twitter_handle && (
                    <a href={`https://x.com/${detail.info.twitter_handle}`} target="_blank" rel="noreferrer" style={{ ...styles.btn, textDecoration: "none", fontSize: 12 }}>𝕏 @{detail.info.twitter_handle}</a>
                  )}
                  {detail.info.telegram_handle && (
                    <a href={`https://t.me/${detail.info.telegram_handle}`} target="_blank" rel="noreferrer" style={{ ...styles.btn, textDecoration: "none", fontSize: 12 }}>✈️ Telegram</a>
                  )}
                  {detail.info.discord_url && (
                    <a href={detail.info.discord_url} target="_blank" rel="noreferrer" style={{ ...styles.btn, textDecoration: "none", fontSize: 12 }}>💬 Discord</a>
                  )}
                </div>
              </>
            )}
            {!detail.loading && !detail.info && (
              <p style={{ color: C.gold, fontSize: 13 }}>
                Sin información del proyecto registrada. En tokens nuevos, esto suele ser mala señal — verifica el contrato antes de tocar nada.
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <a
                href={`https://www.geckoterminal.com/${detail.network}/pools/${detail.pool.attributes.address}`}
                target="_blank" rel="noreferrer"
                style={{ ...styles.btn, textDecoration: "none" }}>
                Gráfico en GeckoTerminal ↗
              </a>
              <a
                href={`https://x.com/search?q=%24${encodeURIComponent((detail.pool.attributes.name || "").split("/")[0].trim())}&f=live`}
                target="_blank" rel="noreferrer"
                style={{ ...styles.btn, textDecoration: "none" }}>
                🔍 Buscar en X (live)
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ================= TAB: CARTERAS (escáner multi-chain) =================
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const EVM_RPCS = {
  eth: "https://ethereum-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
};
const SOL_RPC = "https://api.mainnet-beta.solana.com";

async function evmRpc(chain, method, params) {
  const r = await fetchRetry(EVM_RPCS[chain], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function evmBatch(chain, batch) {
  const r = await fetchRetry(EVM_RPCS[chain], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });
  return await r.json();
}
async function solRpc(method, params) {
  const r = await fetchRetry(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// balances para la watchlist
async function getEvmBalance(chain, addr) {
  const hex = await evmRpc(chain, "eth_getBalance", [addr, "latest"]);
  return parseInt(hex, 16) / 1e18;
}
async function getEvmTokenBalance(chain, contract, addr) {
  const padded = addr.toLowerCase().replace("0x", "").padStart(64, "0");
  const [balHex, decHex] = await Promise.all([
    evmRpc(chain, "eth_call", [{ to: contract, data: "0x70a08231" + padded }, "latest"]),
    evmRpc(chain, "eth_call", [{ to: contract, data: "0x313ce567" }, "latest"]),
  ]);
  const dec = parseInt(decHex, 16) || 18;
  return hexToUnits(balHex, dec);
}
async function getSolBalance(addr) {
  const r = await solRpc("getBalance", [addr]);
  return r.value / 1e9;
}
async function getSplBalance(owner, mint) {
  const r = await solRpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
  return (r.value || []).reduce(
    (s, a) => s + (a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0
  );
}

const TOKEN_PRESETS = {
  eth: [
    { symbol: "USDT", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, minDefault: 500000 },
    { symbol: "USDC", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, minDefault: 500000 },
    { symbol: "WBTC", contract: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, minDefault: 20 },
    { symbol: "LINK", contract: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, minDefault: 50000 },
    { symbol: "PEPE", contract: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18, minDefault: 20000000000 },
    { symbol: "SHIB", contract: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18, minDefault: 50000000000 },
  ],
  bsc: [
    { symbol: "USDT", contract: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, minDefault: 500000 },
    { symbol: "USDC", contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, minDefault: 500000 },
    { symbol: "WBNB", contract: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, minDefault: 500 },
    { symbol: "CAKE", contract: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, minDefault: 100000 },
  ],
  sol: [
    { symbol: "USDC", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    { symbol: "USDT", contract: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
    { symbol: "JUP", contract: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
    { symbol: "BONK", contract: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
    { symbol: "WIF", contract: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  ],
};

const KNOWN_LABELS = {
  // EVM (lowercase)
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance 14",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance 15",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance 16",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance 8",
  "0x8894e0a0c962cb723c1976a4421c95949be2d4e3": "Binance hot (BSC)",
  "0xe2fc31f816a9b94326492132018c3aecc4a93ae1": "Binance (BSC)",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x0000000000000000000000000000000000000000": "Burn/Mint",
  // Solana (case-sensitive)
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance (SOL)",
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance 2 (SOL)",
};
const labelOf = (addr) => KNOWN_LABELS[addr] || KNOWN_LABELS[addr.toLowerCase?.() || addr];

const hexToUnits = (hex, dec) => {
  try {
    const bi = BigInt(hex);
    if (dec > 6) return Number(bi / BigInt(10) ** BigInt(dec - 6)) / 1e6;
    return Number(bi) / 10 ** dec;
  } catch {
    return 0;
  }
};

function bump(agg, addr, field, amt) {
  if (!addr) return;
  const a = addr.toLowerCase();
  if (!agg[a]) agg[a] = { in: 0, out: 0, txs: 0 };
  agg[a][field] += amt;
  agg[a].txs += 1;
}

function aggToRanking(agg, exclude = []) {
  const ex = new Set(exclude.map((e) => e.toLowerCase()));
  return Object.entries(agg)
    .filter(([a]) => !ex.has(a))
    .map(([address, v]) => ({ address, ...v, net: v.in - v.out }))
    .sort((x, y) => y.net - x.net)
    .slice(0, 15);
}

// --- Escáner nativo EVM (ETH o BNB): últimos N bloques completos ---
async function scanEvmNative(chain, nBlocks, minAmt, onProgress) {
  const latest = parseInt(await evmRpc(chain, "eth_blockNumber", []), 16);
  const batch = [];
  for (let i = 0; i < nBlocks; i++) {
    batch.push({
      jsonrpc: "2.0", id: i, method: "eth_getBlockByNumber",
      params: ["0x" + (latest - i).toString(16), true],
    });
  }
  onProgress(`Descargando ${nBlocks} bloques de ${chain.toUpperCase()}…`);
  const results = await evmBatch(chain, batch);
  const agg = {};
  let scanned = 0;
  for (const res of Array.isArray(results) ? results : [results]) {
    const b = res.result;
    if (!b?.transactions) continue;
    for (const tx of b.transactions) {
      const v = hexToUnits(tx.value, 18);
      if (v >= minAmt) {
        bump(agg, tx.to, "in", v);
        bump(agg, tx.from, "out", v);
      }
      scanned++;
    }
  }
  const secsPerBlock = chain === "bsc" ? 3 : 12;
  return { ranking: aggToRanking(agg), scanned, window: `${nBlocks} bloques (~${Math.round(nBlocks * secsPerBlock / 60)} min)` };
}

// --- Escáner de token EVM (ERC-20 / BEP-20): logs de Transfer ---
async function scanEvmToken(chain, contract, decimals, minAmount, blocksRange, onProgress) {
  const latest = parseInt(await evmRpc(chain, "eth_blockNumber", []), 16);
  const secsPerBlock = chain === "bsc" ? 3 : 12;
  let range = blocksRange;
  let logs = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      onProgress(`Leyendo transfers en ${range} bloques de ${chain.toUpperCase()} (~${(range * secsPerBlock / 3600).toFixed(1)} h)…`);
      logs = await evmRpc(chain, "eth_getLogs", [{
        address: contract,
        topics: [TRANSFER_TOPIC],
        fromBlock: "0x" + (latest - range).toString(16),
        toBlock: "latest",
      }]);
      break;
    } catch (e) {
      range = Math.floor(range / 3);
      if (attempt === 2) throw e;
    }
  }
  const agg = {};
  for (const log of logs) {
    const amt = hexToUnits(log.data, decimals);
    if (amt < minAmount) continue;
    bump(agg, "0x" + log.topics[2].slice(26), "in", amt);
    bump(agg, "0x" + log.topics[1].slice(26), "out", amt);
  }
  return {
    ranking: aggToRanking(agg, [contract, "0x0000000000000000000000000000000000000000"]),
    scanned: logs.length,
    window: `${range} bloques (~${(range * secsPerBlock / 3600).toFixed(1)} h)`,
  };
}

// --- Escáner BTC: últimos bloques minados ---
async function scanBtcBlocks(nBlocks, minBtc, onProgress) {
  const lb = await fetchRetry("https://blockchain.info/latestblock?cors=true").then((r) => r.json());
  let hash = lb.hash;
  const agg = {};
  let scanned = 0;
  for (let i = 0; i < nBlocks; i++) {
    onProgress(`Descargando bloque BTC ${i + 1}/${nBlocks}…`);
    const b = await fetchRetry(`https://blockchain.info/rawblock/${hash}?cors=true`).then((r) => r.json());
    for (const tx of b.tx) {
      for (const out of tx.out) {
        const v = out.value / 1e8;
        if (v >= minBtc && out.addr) bump(agg, out.addr, "in", v);
      }
      for (const inp of tx.inputs) {
        const po = inp.prev_out;
        if (po?.addr && po.value / 1e8 >= minBtc) bump(agg, po.addr, "out", po.value / 1e8);
      }
      scanned++;
    }
    hash = b.prev_block;
  }
  const ranking = Object.entries(agg)
    .map(([address, v]) => ({ address, ...v, net: v.in - v.out }))
    .sort((x, y) => y.net - x.net)
    .slice(0, 15);
  return { ranking, scanned, window: `${nBlocks} bloques (~${nBlocks * 10} min)` };
}

// --- Solana: top holders de un token (SPL) ---
async function scanSolToken(mint, onProgress) {
  onProgress("Consultando los 20 mayores holders del token…");
  const largest = await solRpc("getTokenLargestAccounts", [mint]);
  const accounts = largest.value || [];
  onProgress("Resolviendo dueños de las cuentas…");
  let owners = [];
  try {
    const info = await solRpc("getMultipleAccounts", [
      accounts.map((a) => a.address),
      { encoding: "jsonParsed" },
    ]);
    owners = (info.value || []).map((v) => v?.data?.parsed?.info?.owner || null);
  } catch { /* fallback: usar la cuenta de token */ }
  const ranking = accounts.map((a, i) => ({
    address: owners[i] || a.address,
    in: a.uiAmount || 0, out: 0, txs: 1, net: a.uiAmount || 0,
  }));
  return { ranking, scanned: ranking.length, window: "holders actuales (foto en vivo)", holdersMode: true };
}

// --- Solana: mayores cuentas SOL ---
async function scanSolNative(onProgress) {
  onProgress("Consultando las mayores cuentas SOL…");
  const res = await solRpc("getLargestAccounts", []);
  const ranking = (res.value || []).map((v) => ({
    address: v.address,
    in: v.lamports / 1e9, out: 0, txs: 1, net: v.lamports / 1e9,
  }));
  return { ranking, scanned: ranking.length, window: "top 20 cuentas actuales", holdersMode: true };
}

// --- detectar contratos EVM ---
async function tagContracts(chain, addresses) {
  const batch = addresses.map((a, i) => ({
    jsonrpc: "2.0", id: i, method: "eth_getCode", params: [a, "latest"],
  }));
  try {
    const res = await evmBatch(chain, batch);
    const map = {};
    (Array.isArray(res) ? res : [res]).forEach((x) => {
      map[addresses[x.id]] = x.result && x.result !== "0x";
    });
    return map;
  } catch {
    return {};
  }
}

const CHAIN_META = {
  eth: { name: "Ethereum", native: "ETH", color: C.blue, explorer: (a) => `https://etherscan.io/address/${a}` },
  bsc: { name: "BNB Chain", native: "BNB", color: C.gold, explorer: (a) => `https://bscscan.com/address/${a}` },
  btc: { name: "Bitcoin", native: "BTC", color: C.gold, explorer: (a) => `https://www.blockchain.com/explorer/addresses/btc/${a}` },
  sol: { name: "Solana", native: "SOL", color: "#B57BFF", explorer: (a) => `https://solscan.io/account/${a}` },
};

function Carteras() {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("eth"); // eth | bsc | btc | sol | token
  const [tokenChain, setTokenChain] = useState("eth"); // para modo token
  const [preset, setPreset] = useState(TOKEN_PRESETS.eth[0]);
  const [customContract, setCustomContract] = useState("");
  const [customDecimals, setCustomDecimals] = useState("18");
  const [minAmount, setMinAmount] = useState("200");
  const [results, setResults] = useState(null);
  const [contractTags, setContractTags] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => { loadWalletData().then(setData); }, []);

  useEffect(() => {
    if (mode === "eth") setMinAmount("200");
    else if (mode === "bsc") setMinAmount("1500");
    else if (mode === "btc") setMinAmount("25");
    else if (mode === "sol") setMinAmount("0");
    else setMinAmount(String(preset.minDefault ?? 0));
    setResults(null); setErr(null);
  }, [mode, preset, tokenChain]);

  const runScan = async () => {
    setBusy(true); setErr(null); setResults(null); setContractTags({});
    const min = Number(minAmount) || 0;
    try {
      let res, resultChain, symbol;
      if (mode === "eth" || mode === "bsc") {
        res = await scanEvmNative(mode, mode === "bsc" ? 60 : 20, min, setProgress);
        resultChain = mode; symbol = CHAIN_META[mode].native;
      } else if (mode === "btc") {
        res = await scanBtcBlocks(2, min, setProgress);
        resultChain = "btc"; symbol = "BTC";
      } else if (mode === "sol") {
        res = await scanSolNative(setProgress);
        resultChain = "sol"; symbol = "SOL";
      } else {
        // modo token
        const contract = customContract.trim() || preset.contract;
        symbol = customContract.trim() ? "TOKEN" : preset.symbol;
        resultChain = tokenChain;
        if (tokenChain === "sol") {
          res = await scanSolToken(contract, setProgress);
        } else {
          const decimals = customContract.trim() ? Number(customDecimals) || 18 : preset.decimals;
          res = await scanEvmToken(tokenChain, contract, decimals, min, tokenChain === "bsc" ? 7000 : 1800, setProgress);
        }
      }
      // Obtener precio USD del activo escaneado
      let priceUsd = null;
      try {
        if (mode === "eth" || mode === "bsc" || mode === "btc" || mode === "sol") {
          const cgIds = { eth: "ethereum", bsc: "binancecoin", btc: "bitcoin", sol: "solana" };
          const pr = await fetchRetry(
            `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds[mode]}&vs_currencies=usd`
          );
          const pj = await pr.json();
          priceUsd = pj[cgIds[mode]]?.usd || null;
        } else if (mode === "token") {
          const contract = customContract.trim() || preset.contract;
          if (tokenChain === "sol") {
            const pr = await fetchRetry(
              `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${contract}&vs_currencies=usd`
            );
            const pj = await pr.json();
            priceUsd = pj[contract.toLowerCase()]?.usd || pj[Object.keys(pj)[0]]?.usd || null;
          } else {
            const platform = tokenChain === "bsc" ? "binance-smart-chain" : "ethereum";
            const pr = await fetchRetry(
              `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contract}&vs_currencies=usd`
            );
            const pj = await pr.json();
            priceUsd = pj[contract.toLowerCase()]?.usd || pj[Object.keys(pj)[0]]?.usd || null;
          }
        }
      } catch {}
      setResults({ ...res, chain: resultChain, symbol, tokenContract: mode === "token" ? (customContract.trim() || preset.contract) : null, priceUsd });
      if ((resultChain === "eth" || resultChain === "bsc") && res.ranking.length) {
        setProgress("Identificando contratos vs carteras…");
        setContractTags(await tagContracts(resultChain, res.ranking.map((r) => r.address)));
      }
      setProgress("");
    } catch (e) {
      setErr("Error en el escaneo: " + (e.message || "el nodo público rechazó la petición. Reintenta en 30s."));
      setProgress("");
    }
    setBusy(false);
  };

  const fetchWalletBalance = async (w) => {
    if (w.chain === "btc") return await getBtcBalance(w.address);
    if (w.chain === "sol") return w.token ? await getSplBalance(w.address, w.token.contract) : await getSolBalance(w.address);
    return w.token
      ? await getEvmTokenBalance(w.chain, w.token.contract, w.address)
      : await getEvmBalance(w.chain, w.address);
  };

  const trackWallet = async (row) => {
    const w = {
      id: Date.now().toString(36),
      label: labelOf(row.address) || row.address.slice(0, 10) + "…",
      chain: results.chain,
      address: row.address,
      token: results.tokenContract ? { contract: results.tokenContract, symbol: results.symbol } : null,
    };
    try {
      const bal = await fetchWalletBalance(w);
      const next = {
        wallets: [...data.wallets, w],
        snapshots: { ...data.snapshots, [w.id]: [{ t: Date.now(), balance: bal }] },
      };
      setData(next);
      await saveWalletData(next);
    } catch (e) {
      setErr("No se pudo obtener el balance inicial: " + e.message);
    }
  };

  const refreshAll = async () => {
    setBusy(true);
    const snaps = { ...data.snapshots };
    for (const w of data.wallets) {
      try {
        const bal = await fetchWalletBalance(w);
        snaps[w.id] = [...(snaps[w.id] || []), { t: Date.now(), balance: bal }].slice(-40);
      } catch {}
    }
    const next = { ...data, snapshots: snaps };
    setData(next);
    await saveWalletData(next);
    setLastRefreshTime(Date.now());
    setBusy(false);
  };

  const removeWallet = async (id) => {
    const next = {
      wallets: data.wallets.filter((w) => w.id !== id),
      snapshots: Object.fromEntries(Object.entries(data.snapshots).filter(([k]) => k !== id)),
    };
    setData(next);
    await saveWalletData(next);
  };

  // Auto-refresh cada 5 min
  useEffect(() => {
    if (!autoRefresh || !data?.wallets?.length) return;
    const id = setInterval(() => { refreshAll(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, data?.wallets?.length]);

  // Ticker para "hace X min"
  useEffect(() => {
    if (!lastRefreshTime) return;
    const id = setInterval(() => forceUpdate((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [lastRefreshTime]);

  const agoText = lastRefreshTime
    ? (() => { const m = Math.floor((Date.now() - lastRefreshTime) / 60000); return m < 1 ? "hace menos de 1 min" : `hace ${m} min`; })()
    : null;

  if (!data) return (
    <div style={{ padding: "48px 0", textAlign: "center" }}>
      <div className="loading-dots"><span/><span/><span/></div>
    </div>
  );

  const alreadyTracked = new Set(data.wallets.map((w) => w.address.toLowerCase()));
  const unit = (w) => (w.token ? w.token.symbol : CHAIN_META[w.chain]?.native || "");
  const tokenPresetList = TOKEN_PRESETS[tokenChain] || [];

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px" }}>Escáner de whales · multi-chain</h2>
      <p style={{ color: C.dim, fontSize: 13, marginTop: 0 }}>
        Escanea Ethereum, BNB Chain, Bitcoin o Solana en vivo. En ETH/BSC/BTC detecta el
        <span style={{ color: C.sonar }}> flujo neto reciente (acumulando)</span>; en Solana muestra los
        <span style={{ color: C.sonar }}> mayores holders actuales</span>, y al rastrearlos detectas si acumulan entre visitas.
      </p>

      <div style={{ ...styles.card, marginBottom: 16, background: C.surface2, borderColor: C.line }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {[
            { id: "eth", label: "Ξ ETH" },
            { id: "bsc", label: "◆ BNB (BSC)" },
            { id: "btc", label: "₿ BTC" },
            { id: "sol", label: "◎ SOL" },
            { id: "token", label: "🪙 Token" },
          ].map((m) => (
            <button key={m.id}
              style={{ ...styles.btn,
                background: mode === m.id ? C.sonar + "22" : "transparent",
                borderColor: mode === m.id ? C.sonar : C.line,
                color: mode === m.id ? C.sonar : C.dim }}
              onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>

        {mode === "token" && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ ...styles.mono, fontSize: 11, color: C.dim }}>Red:</span>
              {["eth", "bsc", "sol"].map((c) => (
                <button key={c}
                  style={{ ...styles.btn, padding: "4px 10px", fontSize: 12,
                    borderColor: tokenChain === c ? CHAIN_META[c].color : C.line,
                    color: tokenChain === c ? CHAIN_META[c].color : C.dim }}
                  onClick={() => { setTokenChain(c); setPreset(TOKEN_PRESETS[c][0]); setCustomContract(""); }}>
                  {CHAIN_META[c].name}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {tokenPresetList.map((p) => (
                <button key={p.symbol} className="filter-btn"
                  style={{ ...styles.btn, padding: "4px 10px", fontSize: 12,
                    background: !customContract && preset.symbol === p.symbol ? C.sonar + "1A" : "transparent",
                    borderColor: !customContract && preset.symbol === p.symbol ? C.sonar : C.line,
                    color: !customContract && preset.symbol === p.symbol ? C.sonar : C.dim }}
                  onClick={() => { setPreset(p); setCustomContract(""); }}>
                  {p.symbol}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: tokenChain === "sol" ? "1fr" : "3fr 1fr", gap: 8 }}>
              <input style={styles.input}
                placeholder={tokenChain === "sol" ? "…o mint address personalizado" : "…o contrato personalizado (0x…)"}
                value={customContract} onChange={(e) => setCustomContract(e.target.value)} />
              {tokenChain !== "sol" && (
                <input style={styles.input} placeholder="Decimales"
                  value={customDecimals} onChange={(e) => setCustomDecimals(e.target.value)} />
              )}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {mode !== "sol" && !(mode === "token" && tokenChain === "sol") && (
            <>
              <span style={{ ...styles.mono, fontSize: 12, color: C.dim }}>
                Monto mínimo por tx:
              </span>
              <input style={{ ...styles.input, width: 150 }} value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)} inputMode="decimal" />
            </>
          )}
          <button
            className={busy ? "" : "btn-scan"}
            style={{ ...styles.btn, borderColor: C.gold + "88", color: C.gold, fontWeight: 600, background: C.gold + "0F" }}
            onClick={runScan} disabled={busy}>
            {busy ? "Escaneando…" : "📡 Escanear blockchain"}
          </button>
        </div>
        {progress && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <div className="loading-dots"><span/><span/><span/></div>
            <span style={{ ...styles.mono, fontSize: 12, color: C.sonar }}>{progress}</span>
          </div>
        )}
        {err && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "10px 12px", borderRadius: 8, background: C.red + "0D", border: `1px solid ${C.red}55` }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
            <span style={{ color: C.red, fontSize: 13, lineHeight: 1.5 }}>{err}</span>
          </div>
        )}
      </div>

      {results && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...styles.mono, fontSize: 11, color: C.dim, marginBottom: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span style={styles.tag(CHAIN_META[results.chain].color)}>{CHAIN_META[results.chain].name}</span>
            <span>Ventana: {results.window}</span>
            <span>{fmtNum(results.scanned, 0)} registros</span>
            <span>{results.holdersMode ? "ordenado por balance actual" : `flujo neto ${results.symbol}`}</span>
          </div>
          {results.ranking.length === 0 && (
            <div style={{ ...styles.card, textAlign: "center", padding: "36px 16px" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin resultados</div>
              <div style={{ fontSize: 12, color: C.dim }}>Nada superó el mínimo. Baja el monto y vuelve a escanear.</div>
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {results.ranking.map((row, i) => {
              const known = labelOf(row.address);
              const isContract = contractTags[row.address];
              const tracked = alreadyTracked.has(row.address.toLowerCase());
              return (
                <div key={row.address + i} className="card-in" style={{ ...styles.card, borderLeft: `3px solid ${row.net >= 0 ? C.sonar : C.red}`, animationDelay: `${i * 40}ms` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{
                          ...styles.mono, fontSize: 12, fontWeight: 700,
                          color: i === 0 ? C.gold : i < 3 ? C.sonar : C.dim,
                        }}>#{i + 1}</span>
                        <span style={styles.tag(CHAIN_META[results.chain].color)}>{results.chain.toUpperCase()}</span>
                        {known && <span style={styles.tag(C.gold)}>🏦 {known}</span>}
                        {isContract === true && <span style={styles.tag(C.blue)}>contrato</span>}
                        {isContract === false && <span style={styles.tag(C.sonar)}>cartera (EOA)</span>}
                      </div>
                      <div style={{ ...styles.mono, fontSize: 11, color: C.dim, marginTop: 4 }} title={row.address}>{truncAddr(row.address)}</div>
                    </div>
                    <div style={{ ...styles.mono, fontSize: 12, textAlign: "right" }}>
                      <div style={{ color: row.net >= 0 ? C.sonar : C.red, fontWeight: 700, fontSize: 14 }}>
                        {results.holdersMode ? "" : row.net >= 0 ? "+" : ""}{fmtNum(row.net, 2)} {results.symbol}
                      </div>
                      {results.priceUsd != null && (
                        <div style={{ color: C.dim, fontSize: 11 }}>≈ {fmtUsd(Math.abs(row.net) * results.priceUsd)}</div>
                      )}
                      {!results.holdersMode && (
                        <div style={{ color: C.dim }}>↓ {fmtNum(row.in, 2)} · ↑ {fmtNum(row.out, 2)} · {row.txs} mov.</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      style={{ ...styles.btn, padding: "4px 12px", fontSize: 12,
                        color: tracked ? C.dim : C.gold, borderColor: tracked ? C.line : C.gold + "66" }}
                      onClick={() => !tracked && trackWallet(row)} disabled={tracked || busy}>
                      {tracked ? "✓ Rastreada" : "🔭 Rastrear"}
                    </button>
                    <a href={CHAIN_META[results.chain].explorer(row.address)} target="_blank" rel="noreferrer"
                      style={{ ...styles.btn, padding: "4px 12px", fontSize: 12, textDecoration: "none" }}>
                      Explorer ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="section-label" style={{ margin: 0 }}>🐋 Carteras rastreadas ({data.wallets.length})</div>
          {agoText && <span style={{ ...styles.mono, fontSize: 11, color: C.dim }}>Última actualización: {agoText}</span>}
        </div>
        {data.wallets.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              style={{ ...styles.btn, padding: "4px 10px", fontSize: 11,
                background: autoRefresh ? C.sonar + "1A" : "transparent",
                borderColor: autoRefresh ? C.sonar : C.line,
                color: autoRefresh ? C.sonar : C.dim }}
              onClick={() => setAutoRefresh(!autoRefresh)}>
              {autoRefresh ? "✓ " : ""}Auto ↻ cada 5 min
            </button>
            <button style={styles.btn} onClick={refreshAll} disabled={busy}>
              {busy ? "…" : "↻ Actualizar balances"}
            </button>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {data.wallets.map((w) => {
          const snaps = data.snapshots[w.id] || [];
          const last = snaps[snaps.length - 1];
          const first = snaps[0];
          const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
          const deltaPrev = prev ? last.balance - prev.balance : 0;
          const deltaTotal = first && snaps.length > 1 ? last.balance - first.balance : 0;
          const state = snaps.length < 2 ? null : deltaPrev > 0 ? "acc" : deltaPrev < 0 ? "dist" : "flat";
          return (
            <div key={w.id} style={{
              ...styles.card,
              borderLeft: `3px solid ${state === "acc" ? C.sonar : state === "dist" ? C.red : C.line}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {w.label}{" "}
                    <span style={styles.tag(CHAIN_META[w.chain]?.color || C.blue)}>
                      {w.chain.toUpperCase()}{w.token ? " · " + w.token.symbol : ""}
                    </span>
                  </div>
                  <div style={{ ...styles.mono, fontSize: 11, color: C.dim }} title={w.address}>{truncAddr(w.address)}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <a href={CHAIN_META[w.chain]?.explorer(w.address)} target="_blank" rel="noreferrer"
                    style={{ ...styles.btn, padding: "2px 8px", fontSize: 11, textDecoration: "none" }}>↗</a>
                  <button style={{ ...styles.btn, padding: "2px 8px", fontSize: 11, color: C.red, borderColor: C.red + "44" }} onClick={() => removeWallet(w.id)}>
                    quitar
                  </button>
                </div>
              </div>
              <div style={{ ...styles.mono, marginTop: 10, fontSize: 14 }}>
                Balance: <span style={{ color: C.text, fontWeight: 700 }}>{fmtNum(last?.balance)} {unit(w)}</span>
                {state && (
                  <span style={{ marginLeft: 12, ...styles.tag(state === "acc" ? C.sonar : state === "dist" ? C.red : C.dim) }}>
                    {state === "acc" ? "▲ ACUMULANDO" : state === "dist" ? "▼ DISTRIBUYENDO" : "— SIN CAMBIO"}
                    {state !== "flat" && ` ${deltaPrev > 0 ? "+" : ""}${fmtNum(deltaPrev)}`}
                  </span>
                )}
              </div>
              {snaps.length > 1 && (
                <div style={{ ...styles.mono, fontSize: 12, color: C.dim, marginTop: 4 }}>
                  Cambio total ({snaps.length} snapshots desde {new Date(first.t).toLocaleDateString()}):{" "}
                  <span style={{ color: deltaTotal >= 0 ? C.sonar : C.red }}>
                    {deltaTotal >= 0 ? "+" : ""}{fmtNum(deltaTotal)} {unit(w)}
                  </span>
                </div>
              )}
              {snaps.length >= 3 && (() => {
                const vals = snaps.map((s) => s.balance);
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                const range = max - min || 1;
                const h = 60;
                const w = "100%";
                const pts = vals.map((v, i) => {
                  const x = vals.length === 1 ? 0 : (i / (vals.length - 1)) * 100;
                  const y = h - ((v - min) / range) * (h - 8) - 4;
                  return `${x},${y}`;
                }).join(" ");
                const lineColor = vals[vals.length - 1] >= vals[0] ? C.sonar : C.red;
                return (
                  <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ width: w, height: h, display: "block", marginTop: 8 }}>
                    <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    <polyline points={`0,${h} ${pts} 100,${h}`} fill={lineColor + "15"} stroke="none" />
                  </svg>
                );
              })()}
              {snaps.length < 2 && (
                <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
                  Primer snapshot guardado. Vuelve luego y actualiza balances para confirmar acumulación.
                </div>
              )}
            </div>
          );
        })}
        {data.wallets.length === 0 && (
          <div style={{ ...styles.card, textAlign: "center", padding: "36px 16px" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🔭</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Sin carteras rastreadas</div>
            <div style={{ fontSize: 12, color: C.dim }}>Escanea la blockchain arriba y pulsa Rastrear en cualquier dirección.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ================= APP =================
function useClock() {
  const [time, setTime] = useState(() => new Date().toUTCString().slice(17, 22) + " UTC");
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toUTCString().slice(17, 22) + " UTC"), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export default function App() {
  const [tab, setTab] = useState("tendencias");
  const [selectedCoin, setSelectedCoin] = useState(null);
  const clock = useClock();

  const tabs = [
    { id: "tendencias", label: "📈 Tendencias" },
    { id: "alpha", label: "🆕 Alpha" },
    { id: "carteras", label: "🐋 Carteras" },
  ];

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
        * { scrollbar-width: thin; scrollbar-color: ${C.line} transparent; }
        button { transition: border-color .15s, color .15s, background .15s, box-shadow .15s; }
        a { transition: opacity .15s; }
        button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid ${C.sonar}; outline-offset: 2px; }
        input:focus { border-color: ${C.sonar}77 !important; outline: none; box-shadow: 0 0 0 3px ${C.sonar}12 !important; }

        @keyframes pulse { 0% { transform:scale(1); opacity:.8; } 100% { transform:scale(2.6); opacity:0; } }
        @keyframes dot-blink { 0%,80%,100% { opacity:0.15; } 40% { opacity:1; } }
        @keyframes scan-sweep { 0% { top:-2px; opacity:0; } 3% { opacity:1; } 97% { opacity:1; } 100% { top:110%; opacity:0; } }
        @keyframes btn-pulse { 0%,100% { box-shadow:0 0 10px ${C.gold}33, 0 2px 8px rgba(0,0,0,.4); } 50% { box-shadow:0 0 26px ${C.gold}55, 0 2px 8px rgba(0,0,0,.4); } }
        @keyframes card-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes modal-up { from { opacity:0; transform:translateY(24px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes tab-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes new-badge { 0%,100% { box-shadow:0 0 0 0 ${C.sonar}55; } 60% { box-shadow:0 0 0 5px transparent; } }

        @media (prefers-reduced-motion: reduce) {
          .sonar-dot::after, .scan-sweep, .btn-scan { animation:none !important; }
          .loading-dots span { animation:none !important; opacity:1; }
        }

        .sonar-dot { position:relative; width:10px; height:10px; border-radius:50%; background:${C.sonar}; display:inline-block; }
        .sonar-dot::after { content:''; position:absolute; inset:0; border-radius:50%; border:1px solid ${C.sonar}; animation:pulse 2s ease-out infinite; }

        .scan-sweep { position:absolute; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent 0%, ${C.sonar}44 30%, ${C.sonar}99 50%, ${C.sonar}44 70%, transparent 100%); animation:scan-sweep 8s linear infinite; pointer-events:none; z-index:2; }

        .card-hover { cursor:pointer; transition:box-shadow .2s, transform .15s; }
        .card-hover:hover { box-shadow:0 8px 32px rgba(63,217,192,.12), 0 0 0 1px ${C.sonar}44 !important; transform:translateY(-1px); }
        .card-hover:active { transform:translateY(0); }

        .section-label { font-size:11px; color:${C.dim}; letter-spacing:2.5px; text-transform:uppercase; font-family:'IBM Plex Mono',monospace; display:flex; align-items:center; gap:8px; margin:0 0 12px; padding:0; border:none; background:none; }
        .section-label::before { content:''; width:3px; height:13px; border-radius:2px; background:${C.sonar}; display:inline-block; flex-shrink:0; }

        .loading-dots { display:flex; align-items:center; justify-content:center; gap:5px; }
        .loading-dots span { display:inline-block; width:6px; height:6px; border-radius:50%; background:${C.sonar}; animation:dot-blink 1.2s infinite; }
        .loading-dots span:nth-child(2) { animation-delay:.2s; }
        .loading-dots span:nth-child(3) { animation-delay:.4s; }

        .filter-btn { transition:border-color .15s, color .15s, background .15s; }
        .filter-btn:hover { border-color:${C.sonar}66 !important; color:${C.text} !important; }

        .btn-scan { animation:btn-pulse 2.5s ease-in-out infinite; }

        .card-in { animation:card-in .3s ease-out both; }

        .nav-tab { background:none !important; border-left:none !important; border-right:none !important; border-top:none !important; border-radius:0 !important; padding:10px 20px !important; font-size:13px !important; border-bottom-width:2px !important; border-bottom-style:solid !important; cursor:pointer; font-family:'IBM Plex Mono',monospace; letter-spacing:.5px; transition:color .15s, border-color .15s !important; }

        .stat-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px 6px; margin-top:10px; }
        .stat-grid-4 { display:grid; grid-template-columns:repeat(2,1fr); gap:1px; margin:14px 0; background:${C.line}; border-radius:8px; overflow:hidden; }
        .stat-grid-4 > div { background:${C.surface}; padding:10px 12px; }
        .stat-cell-label { font-size:9px; letter-spacing:1.5px; text-transform:uppercase; font-family:'IBM Plex Mono',monospace; color:${C.dim}; margin-bottom:3px; }
        .stat-cell-value { font-size:13px; font-family:'IBM Plex Mono',monospace; color:${C.text}; font-weight:600; }
        .stat-cell-value.accent { color:${C.sonar}; }
        .stat-cell-value.up { color:${C.sonar}; }
        .stat-cell-value.down { color:${C.red}; }
        .modal-body { animation:modal-up .25s cubic-bezier(.22,1,.36,1) both; }
        .tab-content { animation:tab-fade .2s ease-out both; }
        .badge-new { display:inline-flex; align-items:center; font-size:9px; letter-spacing:1px; font-family:'IBM Plex Mono',monospace; background:${C.sonar}22; color:${C.sonar}; border:1px solid ${C.sonar}55; border-radius:4px; padding:1px 5px; animation:new-badge 1.8s ease-in-out infinite; }
      `}</style>

      <header style={{
        padding: "20px 20px 0",
        borderBottom: `1px solid ${C.line}`,
        background: `radial-gradient(ellipse 70% 140% at 15% 0%, ${C.sonar}0F 0%, transparent 55%), linear-gradient(180deg, ${C.surface2}F2 0%, ${C.bg}F2 100%)`,
        position: "sticky", top: 0, zIndex: 40,
        backdropFilter: "blur(16px)",
        overflow: "clip",
      }}>
        <div className="scan-sweep" />
        <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 1100, margin: "0 auto", flexWrap: "wrap" }}>
          <span className="sonar-dot" />
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: 4, fontWeight: 700 }}>
            RADAR CRIPTO
          </h1>
          <span style={{ ...styles.mono, fontSize: 11, color: C.dim }}>
            carteras · alpha · tendencias — datos en vivo, sin API keys
          </span>
        </div>
        <nav style={{ display: "flex", gap: 0, marginTop: 16, maxWidth: 1100, margin: "16px auto 0", borderTop: `1px solid ${C.line}33` }}>
          {tabs.map((t) => (
            <button key={t.id} className="nav-tab"
              style={{
                borderBottomColor: tab === t.id ? C.sonar : "transparent",
                color: tab === t.id ? C.sonar : C.dim,
                fontWeight: tab === t.id ? 600 : 400,
              }}
              onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 1100, margin: "20px auto 0", padding: "0 16px" }}>
        <div key={tab} className="tab-content">
          {tab === "tendencias" && <Tendencias onSelectCoin={setSelectedCoin} />}
          {tab === "alpha" && <Alpha />}
          {tab === "carteras" && <Carteras />}
        </div>
      </main>

      {selectedCoin && <CoinDetail coinId={selectedCoin} onClose={() => setSelectedCoin(null)} />}

      <footer style={{ maxWidth: 1100, margin: "30px auto 0", padding: "16px 16px", fontSize: 11, color: C.dim, ...styles.mono, borderTop: `1px solid ${C.line}44`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span>Fuentes: CoinGecko · GeckoTerminal · publicnode RPC · blockchain.info. No es asesoría financiera.</span>
        <span style={{ color: C.sonar, letterSpacing: 1 }}>{clock}</span>
      </footer>
    </div>
  );
}
