const admin = require("firebase-admin");
const express = require("express");
const cron = require("node-cron");
const axios = require("axios");  // 📌 axios 추가!
const app = express();
const port = 5000;

require("dotenv").config(); // 📌 .env 파일에서 환경 변수 로드
const SPECIAL_DAYS = process.env.SPECIAL_DAYS ? process.env.SPECIAL_DAYS.split(",") : [];
// Firebase Admin SDK 초기화
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const currentDate = new Date();
const currentDateString = currentDate.toISOString().split('T')[0]; // 오늘 날짜를 YYYY-MM-DD 형식으로

let username = 'koyoungseok'
let globalStockData = [];
let money
let masterHandler
let mpoint, ppoint
let accessToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ0b2tlbiIsImF1ZCI6ImFiZDJlZmFmLWYzYTktNDcwOS1iMjFlLTA2ZjBlZDVjMjQ0OSIsInByZHRfY2QiOiIiLCJpc3MiOiJ1bm9ndyIsImV4cCI6MTc0MTIxOTQ0MCwiaWF0IjoxNzQxMTMzMDQwLCJqdGkiOiJQU2NDRFpIVnN3UEk2Z0tDNG5zcWtJNHA1bklVUndmeURwOEEifQ.UyK7VXtgwnE60H91Pp-TziaKBPfGOogCCVMB_iZ2sPrKSNYtMBbhsF6YUYo578Z0HQeVwypUQ31UeV9Q9lb7lA'
const APP_KEY = process.env.APP_KEY;
const APP_SECRET = process.env.APP_SECRET ;
const ACCOUNT_NO = process.env.ACCOUNT_NO;

// Firestore에서 데이터 가져오기
async function fetchStockData() {
    try {
      const snapshot = await db.collection(currentDateString).get();
      let stockData = [];
  
      snapshot.forEach((doc) => {
        stockData.push({ id: doc.id, ...doc.data() });
      });
  
      console.log("✅ Firestore 데이터 가져오기 성공:", stockData);
      globalStockData = stockData;
      return stockData;
    } catch (error) {
      console.error("❌ Firestore 데이터 가져오기 실패:", error);
      return [];
    }
  }

  async function fetchTotalInvestment() {
    try {
      if (!username) {
        console.error("❌ username 변수가 정의되지 않았습니다.");
        return;
      }
  
      const doc = await db.collection(username).doc("investment").get();
      if (doc.exists) {
        const data = doc.data();
        console.log("💰 총 투자 금액 가져오기 성공:", data);
  
        // 전역 변수 업데이트 (예외 처리 포함)
        money = data?.amount || 10000;
        masterHandler = data?.handler || "true"; // 기본값 설정
        mpoint = data?.mp || 0;
        ppoint = data?.pp || 0;
  
      } else {
        console.log("⚠️ 투자 금액 설정 없음 (기본값 1만원)");
        money = 10000;
        masterHandler = "default";
        mpoint = 0;
        ppoint = 0;
      }
    } catch (error) {
      console.error("❌ 총 투자 금액 가져오기 실패:", error);
      money = 10000;
      masterHandler = "default";
      mpoint = 0;
      ppoint = 0;
    }
  }


// 서버 실행
app.listen(port, () => {
  console.log(`🔥 서버 실행 중: http://localhost:${port}`);
});



const WATCH_INTERVAL = 2000; // 2초마다 감시
const boughtStocks = new Set();  // ✅ Set으로 초기화

let selectedStocks = [];  // 종목 검색 결과를 저장하는 배열

// 1. 접근 토큰 발급 함수 (9시 4분에만 발급)
async function getAccessToken() {
    const url = "https://openapi.koreainvestment.com:9443/oauth2/tokenP";
    
    if (!accessToken) {
        try {
            const response = await axios.post(url, {
                grant_type: "client_credentials",
                appkey: APP_KEY,
                appsecret: APP_SECRET
            });

            accessToken = response.data.access_token;
            console.log("✅ 토큰 발급 성공:", accessToken);
        } catch (error) {
            console.error("❌ 토큰 발급 실패:", error.response?.data || error.message);
            accessToken = null;
        }
    }
    return accessToken;
}

// 🔥 현재가 조회 API 함수
async function getCurrentPrice(stockCode) {
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price`;
  
  try {


    const response = await axios.get(url, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "authorization": `Bearer ${accessToken}`,
        "appKey": APP_KEY,
        "appSecret": APP_SECRET,
        "tr_id": "FHKST01010100",
      },
      params: {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": stockCode,
      },
      timeout: 5000,
    });

    if (response.data.output && response.data.output.stck_prpr) {
      console.log("test2 - 가격 조회 성공:", Number(response.data.output.stck_prpr));
      return Number(response.data.output.stck_prpr);
    } else {
      console.error("⚠️ 응답 데이터 이상:", response.data);
      return null;
    }
  } catch (error) {
    console.error("❌ API 호출 실패:", error.message);

    if (error.code === 'ECONNABORTED') {
      console.error("⏳ 요청 타임아웃 발생");
    } else if (error.response) {
      console.error("📡 API 응답 오류:", error.response.data);
    } else {
      console.error("🌐 네트워크 오류:", error.message);
    }

    return null;
  }
}




async function placeBuyOrder(stock, quantity) {
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash`;

  const stockCode = stock.toString()
  const quantityCount = quantity.toString()

  console.log(`🛠️ 매수 주문 전 stock 값:`, stock);
  console.log(`🛠️ 매수 주문 전 stock.code 값:`, typeof(stockCode));


  const orderData = {
    "CANO": ACCOUNT_NO,
    "ACNT_PRDT_CD": "01",
    "PDNO": stockCode,  // 종목 코드
    "ORD_QTY": quantityCount,  // 매수 수량
    "ORD_UNPR": "0",  // 📌 시장가 주문은 0으로 설정
    "ORD_DVSN": "01",  // 📌 시장가 주문
    "EXCG_ID_DVSN_CD": "KRX",
  };

  try {
    const response = await axios.post(url, orderData, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "authorization": `Bearer ${accessToken}`,
        "appKey": APP_KEY,
        "appSecret": APP_SECRET,
        "tr_id": "TTTC0012U",  // ✅ 국내 주식 매수 주문
        "custtype":"P"
      }
    });

    console.log(`✅ ${stockCode } 시장가 매수 성공`, response.data);
  } catch (error) {
    console.error(`❌ ${stockCode  || '알 수 없음'} 매수 주문 실패:`);

    if (error.response) {
      console.error(`📡 API 응답 오류:`, error.response.data);

      // ✅ API 응답 오류가 undefined일 경우 대비
      const errorData = error.response.data || {};
      console.error(`🚨 오류 코드: ${errorData.msg_cd || '알 수 없음'}`);
      console.error(`📢 오류 메시지: ${errorData.msg1 || '오류 메시지 없음'}`);
    } else {
      console.error(`🌐 네트워크 오류:`, error.message);
    }
  }
}


async function startWatchingStocks() {
  console.log("👀 자동 감시 시작 (2초 간격)");
    for (let stock of globalStockData) {
      if (boughtStocks.has(stock.code)) {
        console.log(`⏳ ${stock.code} 이미 매수됨, 감시 제외`);
        continue; // 이미 매수한 종목이면 스킵
      }

      // 🔥 매도 1호가 가져오기
      const nowPrice = await getCurrentPrice(stock.code)

      console.log(`📈 ${stock.code} | 목표가: ${stock.price}`);

      // 🔥 매수 조건: 현재가가 목표가보다 높아질 때 (돌파 매매)
      if (nowPrice >= stock.price) {
        console.log(`🚀 ${stock.code} 목표가 돌파! 매수 주문 실행.`);
        const quantity = Math.floor(money / nowPrice); // 예제: 100만원 투자
        console.log(`🚀 ${quantity} 목표가 돌파! 매수 주문 실행.`);
        boughtStocks.add(stock.code)
        if(quantity > 0) {
          await placeBuyOrder(stock.code, quantity);
        }
      }
    }

}

/**
 * 🔥 평가 손익률 및 주문 가능 수량 조회 API (`evlu_pfls_rt`, `ord_psbl_qty`)
 */
async function getStockBalance(stockCode) {
    const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance`;
  
    try {
      const response = await axios.get(url, {
        headers: {
          "authorization": `Bearer ${accessToken}`,
          "appKey": APP_KEY,
          "appSecret": APP_SECRET,
          "tr_id": "TTTC8434R", // 국내 주식 계좌 평가손익 조회 API
        },
        params: {
          "CANO": ACCOUNT_NO,
          "ACNT_PRDT_CD": "01",
          "AFHR_FLPR_YN": "N",
          "OFL_YN": "",
          "INQR_DVSN": "02",
          "UNPR_DVSN": "01",
          "FUND_STTL_ICLD_YN": "N",
          "FNCG_AMT_AUTO_RDPT_YN": "N",
          "PRCS_DVSN": "00",
          "CTX_AREA_FK100": "",
          "CTX_AREA_NK100": ""
        },
      });
  
      const stocks = response.data.output1;
      const stockInfo = stocks.find((s) => s.pdno === stockCode);
  
      if (stockInfo) {
        return {
          profitRate: Number(stockInfo.evlu_pfls_rt), // 평가 손익률 (%)
          availableQty: Number(stockInfo.ord_psbl_qty), // 주문 가능 수량
        };
      } else {
        console.log(`⚠️ ${stockCode} 보유하지 않음.`);
        return { profitRate: null, availableQty: 0 };
      }
    } catch (error) {
      console.error(`❌ ${stockCode} 평가 손익률 조회 실패:`, error.response ? error.response.data : error.message);
      return { profitRate: null, availableQty: 0 };
    }
  }
  
  /**
   * 🔥 매도 주문 실행 함수 (`ord_psbl_qty` 사용)
   */
  async function placeSellOrder(stock, quantity) {
    if (quantity <= 0) {
      console.error(`⚠️ ${stock} 매도 주문 실패: 주문 가능 수량 없음`);
      return;
    }
    const stockCode = stock.toString()
    const quantityCount = quantity.toString()

    console.log(`🛠️ 매도 주문 전 stock 값:`, quantityCount);
    console.log(`🛠️ 매도 주문 전 stock.code 값:`, typeof(quantityCount));
    const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order-cash`;
  
    const orderData = {
      "CANO": ACCOUNT_NO,
      "ACNT_PRDT_CD": "01",
      "PDNO": stockCode,  // 종목 코드
      "ORD_QTY": quantityCount,  // 매도 수량
      "ORD_UNPR": "1",  // 📌 시장가 주문은 0으로 설정
      "ORD_DVSN": "01",  // 📌 시장가 주문
      "SLL_TYPE" : "01",
      "EXCG_ID_DVSN_CD": "KRX",
    };
  
    try {
      const response = await axios.post(url, orderData, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "authorization": `Bearer ${accessToken}`,
          "appKey": APP_KEY,
          "appSecret": APP_SECRET,
          "tr_id": "TTTC0012U",  // ✅ 국내 주식 매도 주문
          "custtype":"P"
        }
      });
  
      console.log(`✅ ${stockCode} 매도 주문 성공 (수량: ${quantity}):`, response.data);
    } catch (error) {
      console.error(`❌ ${stockCode} 매도 주문 실패:`, error.response ? error.response.data : error.message);
    }
  }
  
  async function startWatchingStocks2() {
    console.log("👀 자동 감시 시작 (2초 간격)");
      for (let stock of globalStockData) {
 
        const { profitRate, availableQty } = await getStockBalance(stock.code);
        if (profitRate === null) continue;
        
        var now2 = new Date();
        var hour2 = now2.getUTCHours() + 9

        console.log(`📊 ${stock.code} 평가 손익률: ${profitRate}% | 손절: ${mpoint}% | 익절: ${ppoint}% | 주문 가능 수량: ${availableQty}`);
  
        // 🔥 손절 또는 익절 조건 충족 시 매도 실행
        if (((profitRate < mpoint || profitRate > ppoint) && availableQty > 0) || hour2 >= 15) {
          console.log(`🚨 ${stock.code} 매도 조건 충족! 주문 가능 수량(${availableQty})으로 매도 주문 실행.`);
          await placeSellOrder(stock.code, availableQty); // 📌 주문 가능 수량만큼 매도
        }
      }

  }

  



  let isRunning = true; // 감시 중인지 상태 저장

async function startAlternatingWatchers() {
    console.log("🚀 자동 감시 시작 (1초 간격으로 번갈아 실행)");

    async function watchLoop() {

      var now2 = new Date();
      var hour2 = now2.getUTCHours() + 9
      var min2 = now2.getMinutes()
      if(hour2 >= 15 &&  min2 >= 5) {
        isRunning = false;
      }
      if (!isRunning) {
        console.log("🛑 감시 중지됨.");
        return;
      }

      
      

        await startWatchingStocks(); // 첫 번째 감시 실행
        setTimeout(async () => {
            if (!isRunning) return;
            await startWatchingStocks2(); // 두 번째 감시 실행
            setTimeout(watchLoop, 1000); // 1초 후 다시 첫 번째 감시 실행
        }, 1000);
    }

    watchLoop(); // 루프 시작
}

  
  // 📌 9시 4분에 조건 확인 (월~금)
  cron.schedule("4 9 * * 1-5", async () => {
      console.log("⏰ [크론 스케줄러] 9시 4분: 조건 확인 시작...");
      
      const today = new Date().toISOString().split("T")[0]; // 📌 현재 날짜 (YYYY-MM-DD)
      
      // 📌 특별한 날이면 실행 중단
      if (SPECIAL_DAYS.includes(today)) {
          console.log(`🎌 [크론 스케줄러] 오늘(${today})은 특별한 날! 실행하지 않습니다.`);
          return;
      }
  
      // 📌 데이터 가져오기
      await fetchStockData();
      await fetchTotalInvestment();
  
      // 📌 masterHandler가 true일 때만 실행
      if (!masterHandler) {
          console.log("⚠️ [크론 스케줄러] masterHandler가 false이므로 실행 중단.");
          return;
      }
  
      // 📌 토큰 한 번만 발급
      await getAccessToken();
  
      // 📌 감시 함수 번갈아 실행 (1초 간격)
      isRunning = true;
      startAlternatingWatchers();
  });

