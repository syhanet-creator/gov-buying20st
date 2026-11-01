// Vercel 서버리스 함수: 나라장터 입찰공고(공사) 최신 20건
// 환경변수: DATA_GO_KR_KEY (공공데이터포털 인증키, 필수)
//           BID_API_URL   (선택, 기본값 아래)
const DEFAULT_URL =
  'https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk';

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;

// 서버(UTC) 시각을 KST로 변환
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000 + new Date().getTimezoneOffset() * 60000);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    return res.status(200).json({ demo: true, updatedAt: new Date().toISOString(), items: demoItems() });
  }
  try {
    const end = kstNow();
    const begin = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
    const url = new URL(process.env.BID_API_URL || DEFAULT_URL);
    url.searchParams.set('serviceKey', key);
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '200');
    url.searchParams.set('type', 'json');
    url.searchParams.set('inqryDiv', '1'); // 공고게시일시 기준
    url.searchParams.set('inqryBgnDt', fmt(begin));
    url.searchParams.set('inqryEndDt', fmt(end));

    const r = await fetch(url);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('API 응답 오류: ' + text.slice(0, 200)); }
    const code = json?.response?.header?.resultCode;
    if (code && code !== '00') throw new Error(`API 오류 ${code}: ${json.response.header.resultMsg}`);

    let raw = json?.response?.body?.items ?? [];
    if (!Array.isArray(raw)) raw = raw.item ? [].concat(raw.item) : [];

    const items = raw
      .map((i) => ({
        no: `${i.bidNtceNo}-${i.bidNtceOrd}`,
        title: i.bidNtceNm,
        org: i.ntceInsttNm,
        demand: i.dminsttNm,
        postedAt: i.bidNtceDt,
        closeAt: i.bidClseDt,
        openAt: i.opengDt,
        price: Number(i.presmptPrce || i.asignBdgtAmt || 0) || null,
        region: i.cnstrtsiteRgnNm || i.prtcptLmtRgnNm || '',
        url: i.bidNtceDtlUrl || i.bidNtceUrl || '',
      }))
      .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)))
      .slice(0, 20);

    res.status(200).json({ demo: false, updatedAt: new Date().toISOString(), items });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}

function demoItems() {
  const now = kstNow();
  const f = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  return Array.from({ length: 20 }, (_, i) => ({
    no: `DEMO${1000 + i}-000`,
    title: `[샘플] OO지구 정비공사 ${i + 1}차`,
    org: '조달청 (샘플)',
    demand: '샘플 수요기관',
    postedAt: f(new Date(now.getTime() - i * 17 * 60000)),
    closeAt: f(new Date(now.getTime() + (i + 2) * 24 * 3600 * 1000)),
    openAt: f(new Date(now.getTime() + (i + 2) * 24 * 3600 * 1000 + 3600000)),
    price: 150000000 + i * 37000000,
    region: ['울산', '부산', '서울', '경남'][i % 4],
    url: 'https://www.g2b.go.kr',
  }));
}
