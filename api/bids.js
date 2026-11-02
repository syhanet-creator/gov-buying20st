// Vercel 서버리스 함수: 나라장터 입찰공고(공사·용역·물품) 조건 검색
// 환경변수: DATA_GO_KR_KEY (공공데이터포털 인증키, 필수 — 없으면 샘플 데이터)
//           BID_API_BASE  (선택, 기본값 아래)
//
// 쿼리: types=cnstwk,servc,thng  from=YYYY-MM-DD  to=YYYY-MM-DD  basis=1|2
//       region=울산  org=울주군  q=도로  min=원  max=원  sort=new|close|price  limit=20
const BASE = (process.env.BID_API_BASE || 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService').replace(/\/$/, '');

const OPS = {
  cnstwk: { label: '공사', op: 'getBidPblancListInfoCnstwk' },
  servc: { label: '용역', op: 'getBidPblancListInfoServc' },
  thng: { label: '물품', op: 'getBidPblancListInfoThng' },
};

// 지역 선택값 → 매칭할 표기들
const REGIONS = {
  서울: ['서울'], 부산: ['부산'], 대구: ['대구'], 인천: ['인천'], 광주: ['광주'], 대전: ['대전'],
  울산: ['울산'], 세종: ['세종'], 경기: ['경기'], 강원: ['강원'],
  충북: ['충북', '충청북도'], 충남: ['충남', '충청남도'],
  전북: ['전북', '전라북도'], 전남: ['전남', '전라남도'],
  경북: ['경북', '경상북도'], 경남: ['경남', '경상남도'], 제주: ['제주'],
};

const ROWS = 500;      // API 1회 요청 건수
const MAX_PAGES = 5;   // 유형별 최대 페이지 (최대 약 2,500건)
const MAX_DAYS = 31;   // 조회 기간 상한
const DAY = 86400000;
// 함수 제한(30초) 안에 반드시 응답하기 위한 마감 시간. 넘으면 받은 만큼만 돌려줍니다.
const DEADLINE_MS = Number(process.env.BID_DEADLINE_MS) || 24000;

export const config = { maxDuration: 30 };

const pad = (n) => String(n).padStart(2, '0');
// ms → KST 필드를 UTC getter로 읽을 수 있는 Date
const asKst = (ms) => new Date(ms + 9 * 3600000);
const dash = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const stamp = (d, hhmm) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${hhmm}`;
const fmtTs = (ms) => { const d = asKst(ms); return `${dash(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`; };
const parseDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
const tsMs = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + '+09:00') : NaN);
const toNum = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

function resolveRange(from, to) {
  const today = parseDay(dash(asKst(Date.now())));
  let t = parseDay(to); if (Number.isNaN(t)) t = today;
  let f = parseDay(from); if (Number.isNaN(f)) f = t - 2 * DAY;
  if (f > t) [f, t] = [t, f];
  let clamped = false;
  if ((t - f) / DAY > MAX_DAYS - 1) { f = t - (MAX_DAYS - 1) * DAY; clamped = true; }
  return { fromMs: f, toMs: t, from: dash(new Date(f)), to: dash(new Date(t)), clamped };
}

function normalize(type, i) {
  return {
    type,
    typeLabel: OPS[type].label,
    no: `${i.bidNtceNo}-${i.bidNtceOrd}`,
    title: i.bidNtceNm || '',
    org: i.ntceInsttNm || '',
    demand: i.dminsttNm || '',
    postedAt: i.bidNtceDt || '',
    closeAt: i.bidClseDt || '',
    openAt: i.opengDt || '',
    price: num(i.presmptPrce) ?? num(i.asignBdgtAmt),
    region: i.cnstrtsiteRgnNm || i.prtcptLmtRgnNm || '',
    url: i.bidNtceDtlUrl || i.bidNtceUrl || '',
  };
}

// API 1회 호출. 마감(deadline)까지 남은 시간만큼만 기다립니다.
async function callApi(type, serviceKey, r, basis, title, page, deadline) {
  const label = OPS[type].label;
  const url = new URL(`${BASE}/${OPS[type].op}`);
  const sp = url.searchParams;
  sp.set('serviceKey', serviceKey);
  sp.set('pageNo', String(page));
  sp.set('numOfRows', String(ROWS));
  sp.set('type', 'json');
  sp.set('inqryDiv', basis); // 1 공고게시일시, 2 개찰일시
  sp.set('inqryBgnDt', stamp(new Date(r.fromMs), '0000'));
  sp.set('inqryEndDt', stamp(new Date(r.toMs), '2359'));
  if (title) sp.set('bidNtceNm', title);

  const left = deadline - Date.now();
  if (left < 1000) throw new Error(`${label} 조회 시간 초과`);
  let text;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(left) });
    text = await resp.text();
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error(`${label} 조회 시간 초과 (공공데이터포털 응답 지연)`);
    throw e;
  }

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${label} API 응답 오류: ${text.slice(0, 160)}`); }
  if (!json?.response) throw new Error(`${label} API 오류: ${text.slice(0, 160)}`);
  const h = json.response.header;
  if (h?.resultCode && h.resultCode !== '00') {
    if (h.resultCode === '03') return { rows: [], total: 0 }; // 데이터 없음
    throw new Error(`${label} API 오류 ${h.resultCode}: ${h.resultMsg}`);
  }
  const body = json.response.body ?? {};
  let items = body.items ?? [];
  if (!Array.isArray(items)) items = items.item ? [].concat(items.item) : [];
  return { rows: items.map((i) => normalize(type, i)), total: Number(body.totalCount) || 0 };
}

// 1페이지로 전체 건수를 확인한 뒤 나머지 페이지는 동시에 요청합니다.
async function fetchType(type, serviceKey, r, basis, title, deadline) {
  const first = await callApi(type, serviceKey, r, basis, title, 1, deadline);
  const rows = [...first.rows];
  const pages = Math.min(Math.ceil(first.total / ROWS), MAX_PAGES);
  if (pages > 1) {
    const rest = await Promise.allSettled(
      Array.from({ length: pages - 1 }, (_, k) => callApi(type, serviceKey, r, basis, title, k + 2, deadline)),
    );
    for (const x of rest) if (x.status === 'fulfilled') rows.push(...x.value.rows);
  }
  // 전체 건수보다 적게 받았으면 일부만 조회된 것 (페이지 상한 또는 시간 초과)
  const partial = rows.length < first.total;
  let from = '', to = '';
  if (partial) {
    for (const i of rows) {
      if (i.postedAt && (!from || i.postedAt < from)) from = i.postedAt;
      if (i.postedAt > to) to = i.postedAt;
    }
  }
  return { rows, partial, total: first.total, from, to };
}

function matches(i, f) {
  if (f.region) {
    const hay = `${i.region} ${i.demand} ${i.org} ${i.title}`;
    const names = String(f.region).split(',').map((s) => s.trim()).filter(Boolean);
    const aliases = names.flatMap((n) => REGIONS[n] || [n]);
    if (aliases.length && !aliases.some((a) => hay.includes(a))) return false;
  }
  if (f.org && !`${i.region} ${i.demand} ${i.org}`.toLowerCase().includes(f.org.toLowerCase())) return false;
  if (f.q) {
    const t = i.title.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w))) return false;
  }
  if (f.min != null && (i.price == null || i.price < f.min)) return false;
  if (f.max != null && (i.price == null || i.price > f.max)) return false;
  return true;
}

function sortList(list, sort) {
  const n = (v) => (Number.isNaN(v) ? 0 : v);
  if (sort === 'price') return list.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  if (sort === 'close') {
    const now = Date.now();
    return list.sort((a, b) => {
      const ca = n(tsMs(a.closeAt)), cb = n(tsMs(b.closeAt));
      const fa = ca >= now, fb = cb >= now;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? ca - cb : cb - ca;
    });
  }
  return list.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
}

export default async function handler(req, res) {
  const deadline = Date.now() + DEADLINE_MS;
  // 인증키 호출 한도를 아끼기 위해 같은 조건은 3분간 캐시
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
  const qy = req.query || {};
  const g = (k) => { const v = Array.isArray(qy[k]) ? qy[k][0] : qy[k]; return v == null ? '' : String(v).trim(); };

  let types = (g('types') || 'cnstwk,servc,thng').split(',').filter((t) => OPS[t]);
  if (!types.length) types = Object.keys(OPS);
  const basis = g('basis') === '2' ? '2' : '1';
  const r = resolveRange(g('from'), g('to'));
  const f = { region: g('region'), org: g('org'), q: g('q'), min: toNum(g('min')), max: toNum(g('max')) };
  const sort = ['new', 'close', 'price'].includes(g('sort')) ? g('sort') : 'new';
  const limit = Math.min(Math.max(parseInt(g('limit'), 10) || 20, 1), 200);

  try {
    // 키 앞뒤 공백·따옴표 제거
    const rawKey = (process.env.DATA_GO_KR_KEY || '').trim().replace(/^["']+|["']+$/g, '');
    const demo = !rawKey;
    let all = [];
    const coverage = []; // 전체를 못 가져온 유형의 조회 현황
    const warnings = [];

    if (demo) {
      const lo = r.fromMs - 9 * 3600000;
      const hi = r.toMs + DAY - 9 * 3600000 - 1;
      all = demoItems().filter((i) => {
        if (!types.includes(i.type)) return false;
        const t = tsMs(basis === '2' ? i.openAt : i.postedAt);
        return t >= lo && t <= hi;
      });
    } else {
      let key = rawKey;
      if (key.includes('%')) { try { key = decodeURIComponent(key); } catch { /* 그대로 사용 */ } }
      const apiTitle = f.q ? f.q.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] : '';
      const results = await Promise.allSettled(types.map((t) => fetchType(t, key, r, basis, apiTitle, deadline)));
      results.forEach((x, idx) => {
        if (x.status === 'fulfilled') {
          all.push(...x.value.rows);
          if (x.value.partial) {
            const t = types[idx];
            coverage.push({ type: t, label: OPS[t].label, total: x.value.total, fetched: x.value.rows.length, from: x.value.from, to: x.value.to });
          }
        } else warnings.push(String(x.reason?.message || x.reason));
      });
      if (warnings.length === types.length) throw new Error(warnings.join(' / '));
    }

    const uniq = new Map();
    for (const i of all) uniq.set(`${i.type}:${i.no}`, i);
    const filtered = [...uniq.values()].filter((i) => matches(i, f));
    const counts = {};
    for (const i of filtered) counts[i.type] = (counts[i.type] || 0) + 1;
    sortList(filtered, sort);

    res.status(200).json({
      demo,
      updatedAt: new Date().toISOString(),
      range: { from: r.from, to: r.to },
      clamped: r.clamped,
      total: filtered.length,
      counts,
      truncated: coverage.length > 0,
      coverage,
      warnings,
      items: filtered.slice(0, limit),
    });
  } catch (e) {
    // 실패 응답은 캐시하지 않음
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
}

// ── 샘플 데이터 (인증키가 없을 때) ─────────────────────────
function demoItems() {
  const rnd = (n) => { const x = Math.sin(n * 9301 + 49297) * 233280; return x - Math.floor(x); };
  const regions = Object.keys(REGIONS);
  const depts = ['건설안전과', '시설관리과', '교육청', '보건소', '도시관리본부'];
  const titles = {
    cnstwk: ['정비공사', '신축공사', '도로개설공사', '하수관로정비공사', '교량보수공사', '옹벽보강공사'],
    servc: ['기본설계용역', '정밀안전점검용역', '시설관리용역', '감리용역', '학술연구용역', '청소용역'],
    thng: ['노트북 구매', '사무용 가구 구매', 'LED 조명 구매', '공기청정기 구매', '소방장비 구매', '차량 구매'],
  };
  const scale = { cnstwk: 3e8, servc: 8e7, thng: 3e7 };
  const keys = Object.keys(OPS);
  const now = Date.now();
  const out = [];
  for (let n = 0; n < 180; n++) {
    const type = keys[n % 3];
    const reg = regions[Math.floor(rnd(n + 1) * regions.length)];
    const t = titles[type][Math.floor(rnd(n + 7) * titles[type].length)];
    const posted = now - n * 4 * 3600000 - Math.floor(rnd(n + 3) * 3600000);
    const close = posted + (3 + Math.floor(rnd(n + 5) * 12)) * DAY;
    out.push({
      type,
      typeLabel: OPS[type].label,
      no: `DEMO${1000 + n}-000`,
      title: `[샘플] ${reg} ${t} (${n + 1}차)`,
      org: '조달청(샘플)',
      demand: `${reg} ${depts[Math.floor(rnd(n + 9) * depts.length)]}`,
      postedAt: fmtTs(posted),
      closeAt: fmtTs(close),
      openAt: fmtTs(close + 3600000),
      price: Math.round(((0.2 + rnd(n + 11) * 3) * scale[type]) / 1e4) * 1e4,
      region: rnd(n + 13) > 0.5 ? reg : '',
      url: 'https://www.g2b.go.kr',
    });
  }
  return out;
}
