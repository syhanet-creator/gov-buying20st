# 조달청 공사 입찰 신규 20

나라장터 입찰공고(공사) 최신 20건을 1분마다 자동 갱신해서 보여주는 웹앱.

## 구성
- `index.html` — 화면 (검색, D-day, NEW 표시, 1분 자동 갱신)
- `api/bids.js` — Vercel 서버리스 함수 (공공데이터포털 API 호출, 키 은닉)

## 배포
1. 공공데이터포털(data.go.kr)에서 **조달청_나라장터 입찰공고정보서비스** 활용신청 → 인증키(일반 인증키, Decoding) 확인
2. GitHub 저장소에 올리고 Vercel에서 Import
3. Vercel → Settings → Environment Variables
   - `DATA_GO_KR_KEY` = 발급받은 인증키 (필수)
   - `BID_API_URL` = (선택) 다른 버전 엔드포인트를 쓸 때. 기본값:
     `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk`
4. 재배포

키가 없으면 샘플 데이터가 표시됩니다.
