// Private stats page (GET /api/stats?key=<STATS_KEY>&view=1). Plain server-rendered HTML with no
// scripts, so it works under the site's Content-Security-Policy. Every value is escaped: token
// symbols and links come from outside (LI.FI, onchain).
const chains = require('viem/chains');
const { FEATURE_LABELS, CHAINS } = require('./flowStats');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (a) => (String(a).length > 14 ? `${String(a).slice(0, 6)}…${String(a).slice(-4)}` : String(a));

// LI.FI's ids for the chains that aren't EVM.
const NON_EVM = { 1151111081099710: 'Solana', 20000000000001: 'Bitcoin', 9270000000000000: 'Sui' };
const EXPLORER = { 5042: 'https://arc.etherscan.io' }; // same explorer the app links to
// viem lists a few testnets under the same id as a mainnet, so mainnets win and the first one stays.
const byId = new Map();
for (const c of Object.values(chains)) {
  if (c && typeof c.id === 'number' && !c.testnet && !byId.has(c.id)) byId.set(c.id, c);
}
const chainName = (id) => NON_EVM[id] || CHAINS[id]?.chain?.name || byId.get(Number(id))?.name || `Chain ${id}`;
function txLink(r) {
  if (r.x && /^https:\/\//.test(r.x)) return r.x;
  if (!/^0x[0-9a-f]{64}$/.test(String(r.h))) return null;
  const base = EXPLORER[r.c] || byId.get(Number(r.c))?.blockExplorers?.default?.url;
  return base ? `${base.replace(/\/$/, '')}/tx/${r.h}` : null;
}
function route(r) {
  const from = `${r.a ? esc(r.a) + ' ' : ''}<span class="dim">${esc(chainName(r.c))}</span>`;
  if (r.tc || (r.b && r.b !== r.a)) return `${from} → ${r.b ? esc(r.b) + ' ' : ''}<span class="dim">${esc(chainName(r.tc || r.c))}</span>`;
  return from;
}
const when = (t) => new Date(t * 1000).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function render({ summary, rows, wallets, key, lifiSynced }) {
  const k = encodeURIComponent(key || '');
  const feats = summary.byFeature.map((f) => `<tr><td>${esc(f.label)}</td><td class="n">${f.transactions}</td><td class="n">${usd(f.volumeUsd)}</td></tr>`).join('');
  const days = [...summary.daily].reverse().filter((d) => d.txs > 0)
    .map((d) => `<tr><td>${esc(d.date)}</td><td class="n">${d.txs}</td><td class="n">${d.wallets}</td><td class="n">${usd(d.volumeUsd)}</td></tr>`).join('');
  const txs = rows.map((r) => {
    const link = txLink(r);
    return `<tr><td class="dim">${esc(when(r.t))}</td><td>${esc(FEATURE_LABELS[r.k] || r.k || FEATURE_LABELS.unlabeled)}</td><td>${route(r)}</td><td class="n">${usd(r.v)}</td><td class="mono">${esc(short(r.f))}</td><td>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">aç</a>` : ''}</td></tr>`;
  }).join('');
  const top = wallets.slice(0, 25).map((w, i) => `<tr><td class="n">${i + 1}</td><td class="mono">${esc(w.wallet)}</td><td class="n">${w.transactions}</td><td class="n">${usd(w.volumeUsd)}</td></tr>`).join('');
  const empty = (cols) => `<tr><td colspan="${cols}" class="dim">Kayıt yok</td></tr>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>FlowFi hacim</title>
<style>
:root{--bg:#F6F7FB;--card:#fff;--ink:#111827;--dim:#6B7280;--line:#E5E7EB;--blue:#3D5AF1}
@media (prefers-color-scheme:dark){:root{--bg:#0B1020;--card:#131A2E;--ink:#E5E7EB;--dim:#9CA3AF;--line:#232B45}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1080px;margin:0 auto;padding:20px 16px 48px}h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;margin:0 0 10px}
.sub{color:var(--dim);font-size:12px;margin-bottom:16px}.warn{background:#FEF3C7;color:#92400E;border-radius:10px;padding:8px 12px;margin-bottom:14px;font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}
.tile,.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}.card{margin-bottom:16px;overflow-x:auto}
.tile .l{color:var(--dim);font-size:12px}.tile .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.tile.main .v{color:var(--blue)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th{text-align:left;color:var(--dim);font-weight:500;font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}tr:last-child td{border-bottom:0}.n{text-align:right}th.n{text-align:right}
.dim{color:var(--dim)}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}a{color:var(--blue);text-decoration:none}
.nav a{margin-right:12px;font-size:12px}
</style></head><body><main>
<h1>FlowFi hacim</h1>
<div class="sub">${summary.since ? `${esc(when(Date.parse(summary.since) / 1000))} tarihinden beri` : ''} · <span class="nav"><a href="?key=${k}&view=1&days=30">30 gün</a><a href="?key=${k}&view=1&days=90">90 gün</a><a href="?key=${k}&view=1&days=365">365 gün</a></span></div>
${lifiSynced ? '' : '<div class="warn">LI.FI şu an okunamadı; son Any bridge ve Any swap işlemleri eksik olabilir. Sayfayı bir dakika sonra yenile.</div>'}
<div class="tiles">
<div class="tile main"><div class="l">Toplam hacim</div><div class="v">${usd(summary.volumeUsd)}</div></div>
<div class="tile"><div class="l">İşlem</div><div class="v">${summary.transactions}</div></div>
<div class="tile"><div class="l">Cüzdan</div><div class="v">${summary.uniqueWallets}</div></div>
</div>
<div class="card"><h2>Özelliğe göre</h2><table><thead><tr><th>Özellik</th><th class="n">İşlem</th><th class="n">Hacim</th></tr></thead><tbody>${feats || empty(3)}
<tr><td><b>Toplam</b></td><td class="n"><b>${summary.transactions}</b></td><td class="n"><b>${usd(summary.volumeUsd)}</b></td></tr></tbody></table></div>
<div class="card"><h2>Son işlemler</h2><table><thead><tr><th>Zaman</th><th>Özellik</th><th>Ne, nereden nereye</th><th class="n">Hacim</th><th>Cüzdan</th><th></th></tr></thead><tbody>${txs || empty(6)}</tbody></table></div>
<div class="card"><h2>Günlük</h2><table><thead><tr><th>Gün</th><th class="n">İşlem</th><th class="n">Cüzdan</th><th class="n">Hacim</th></tr></thead><tbody>${days || empty(4)}</tbody></table></div>
<div class="card"><h2>En çok hacim yapan cüzdanlar</h2><table><thead><tr><th class="n">#</th><th>Cüzdan</th><th class="n">İşlem</th><th class="n">Hacim</th></tr></thead><tbody>${top || empty(4)}</tbody></table></div>
</main></body></html>`;
}

module.exports = { render };
