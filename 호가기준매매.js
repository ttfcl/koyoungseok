const admin = require("firebase-admin");
const express = require("express");
const cron = require("node-cron");
const axios = require("axios");  // 📌 axios 추가!
const app = express();
const port = 5000;

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
let accessToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ0b2tlbiIsImF1ZCI6ImRmZjEyMDRjLTgzN2QtNDJmNi05ZWFjLWZjOGExY2RlYzI3YiIsInByZHRfY2QiOiIiLCJpc3MiOiJ1bm9ndyIsImV4cCI6MTc0MTEzMzA0MSwiaWF0IjoxNzQxMDQ2NjQxLCJqdGkiOiJQU2NDRFpIVnN3UEk2Z0tDNG5zcWtJNHA1bklVUndmeURwOEEifQ.43_0tKLdX0BArrdVN9RVi8TZ7XrEpJOB1mBDzKroSImLFSiERH97QEfEx0wJPq6yqHKTLWK8RcuOASNzwkUm8A';


// Firestore에서 데이터 가져오기
async function fetchStockData() {
    try {
      const snapshot = await db.collection("2025-03-03").get();
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
        masterHandler = data?.handler || "default"; // 기본값 설정
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
  
  // // ✅ 함수 실행 후 전역 변수를 사용할 때 반드시 `await` 적용
  // (async () => {
  //   await fetchTotalInvestment();
  //   console.log(`💰 현재 투자 금액: ${money}`);
  //   console.log(`🔧 마스터 핸들러: ${masterHandler}`);
  //   console.log(`🎯 매수 포인트: ${mpoint}`);
  //   console.log(`📍 매도 포인트: ${ppoint}`);
  // })();
   

// 서버 실행
app.listen(port, () => {
  console.log(`🔥 서버 실행 중: http://localhost:${port}`);
});



const WATCH_INTERVAL = 2000; // 2초마다 감시
let boughtStocks = new Set(); // 이미 매수된 종목 저장 (중복 매수 방지)

// 🔥 한국투자증권 API 설정
const APP_KEY = "PScCDZHVswPI6gKC4nsqkI4p5nIURwfyDp8A";
const APP_SECRET = "LrKL+kNblw7UqEoxkvsItdQyCGHHMxzbyjWxUwC2SVnkKPzf2ADWW1Y56JcgyJKlx3YWHs5AspDjI9jdLgAgZuZ2eRSfyxKCpeWa/eCmq92bq2TfkQbkIv6l73ZfraoRsLgFauw+QPM5Onh4nkY2YAzhI2VuyU0/zXgWziDAsrpCHItv0xs=";
const ACCOUNT_NO = "64855981";

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
  const url = `https://openapi.koreainvestment.com/uapi/domestic-stock/v1/quotations/inquire-price`;

  try {
    const response = await axios.get(url, {
      headers: {
        "content-type" : "application/json; charset=utf-8",
        "authorization": `Bearer ${accessToken}`,
        "appKey": APP_KEY,
        "appSecret": APP_SECRET,
        "tr_id": "HKST01010100", // 국내 주식 현재가 조회 API
        "custtype": "P"
      },
      params: {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD: stockCode": stockCode,
      },
    });

    const price = response.data.output.stck_prpr; // 현재가
    return Number(price);
  } catch (error) {
    console.error(`❌ ${stockCode} 현재가 조회 실패:`, error.response ? error.response.data : error.message);
    return null;
  }
}

// 🔥 호가 조회 API 함수 (매도 1호가 가져오기)
async function getAskPrice(stockCode) {
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn`;

  try {
    const response = await axios.get(url, {
      headers: {
        "content-Type": "application/json;",
        "authorization": `Bearer ${accessToken}`,
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": "HKST01010200", 
        "custtype": "P"// 국내 주식 호가 조회 API
      },
      params: {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": stockCode,
      },
    });
    console.log(`✅ [${stockCode}] API 응답 데이터:`, response.data); // 전체 데이터 출력
    const askPrice = response.data.output1.askp1; // 매도 2호가
    return Number(askPrice);
  } catch (error) {
    console.error(`❌ ${stockCode} 호가 조회 실패:`, error.response ? error.response.data : error.message);
    return null;
  }
}
async function getAskPrice3(stockCode) {
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn`;

  try {
    const response = await axios.get(url, {
      headers: {
        "content-Type": "application/json;",
        "authorization": `Bearer ${accessToken}`,
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": "HKST01010200", 
        "custtype": "P"// 국내 주식 호가 조회 API
      },
      params: {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": stockCode,
      },
    });
    console.log(`✅ [${stockCode}] API 응답 데이터:`, response.data); // 전체 데이터 출력
    const askPrice = response.data.output1.askp1; // 매도 2호가
    return Number(askPrice);
  } catch (error) {
    console.error(`❌ ${stockCode} 호가 조회 실패:`, error.response ? error.response.data : error.message);
    return null;
  }
}

async function getAskPrice2(stockCode) {
    const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn`;
  
    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${accessToken}`,
          "appKey": APP_KEY,
          "appSecret": APP_SECRET,
          "tr_id": "HKST01010200", 
          "custtype": "P"// 국내 주식 호가 조회 API
        },
        params: {
          "FID_COND_MRKT_DIV_CODE": "J",
          "FID_INPUT_ISCD": stockCode,
        },
      });
  
      const askPrice = response.data.output.bidp1; // 매수 2호가
      return Number(askPrice);
    } catch (error) {
      console.error(`❌ ${stockCode} 호가 조회 실패:`, error.response ? error.response.data : error.message);
      return null;
    }
  }



// 🔥 매수 주문 실행 함수
async function placeBuyOrder(stock, quantity, askPrice) {
  const url = `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/order`;

  const orderData = {
    "ORD_QTY": quantity.toString(),
    "CANO": ACCOUNT_NO,
    "ORD_UNPR": askPrice.toString(),
    "ACNT_PRDT_CD": "01",
    "PDNO": stock.code,
    "EXCG_ID_DVSN_CD": "KRX",
    "ORD_DVSN": "00", // 01: 지정가 주문
  };

  try {
    const response = await axios.post(url, orderData, {
      headers: {
        "Content-Type": "application/json",
        "authorization": `Bearer ${accessToken}`,
        "appKey": APP_KEY,
        "appSecret": APP_SECRET,
        "tr_id": "TTTC0012U", // 국내주식 현금매수 거래 ID
        "custtype": "P"
      }
    });

    console.log(`✅ ${stock.code} 매수 주문 성공:`, response.data);
    boughtStocks.add(stock.code); // 매수된 종목 저장 (중복 방지)
  } catch (error) {
    console.error(`❌ ${stock.code} 매수 주문 실패:`, error.response ? error.response.data : error.message);
  }
}

async function startWatchingStocks() {
  console.log("👀 자동 감시 시작 (2초 간격)");

  setInterval(async () => {
    for (let stock of globalStockData) {
      if (boughtStocks.has(stock.code)) {
        console.log(`⏳ ${stock.code} 이미 매수됨, 감시 제외`);
        continue; // 이미 매수한 종목이면 스킵
      }

      // 🔥 매도 1호가 가져오기
      const askPrice = await getAskPrice(stock.code);
      const nowPrice = await getCurrentPrice(stock.code)
      if (!askPrice) continue;

      console.log(`📈 ${stock.code} 매도 1호가: ${askPrice} | 목표가: ${stock.price}`);

      // 🔥 매수 조건: 현재가가 목표가보다 높아질 때 (돌파 매매)
      if (nowPrice >= stock.price) {
        console.log(`🚀 ${stock.code} 목표가 돌파! 매도 1호가(${askPrice})로 매수 주문 실행.`);
        const quantity = Math.floor(money / askPrice); // 예제: 100만원 투자
        await placeBuyOrder(stock, quantity, askPrice);
      }
    }
  }, WATCH_INTERVAL);
}

/**
 * 🔥 평가 손익률 및 주문 가능 수량 조회 API (`evlu_pfls_rt`, `ord_psbl_qty`)
 */
async function getStockBalance(stockCode) {
    const url = `https://openapi.koreainvestment.com/uapi/domestic-stock/v1/trading/inquire-balance`;
  
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
          "INQR_DVSN": "02",
          "UNPR_DVSN": "01",
          "FUND_STTL_ICLD_YN": "N",
          "FNCG_AMT_AUTO_RDPT_YN": "N",
        },
      });
  
      const stocks = response.data.output;
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
  async function placeSellOrder(stock, quantity, bidPrice) {
    if (!bidPrice) {
      console.error(`❌ ${stock.code} 매도 주문 실패: 매수 1호가 없음`);
      return;
    }
  
    if (quantity <= 0) {
      console.error(`⚠️ ${stock.code} 매도 주문 실패: 주문 가능 수량 없음`);
      return;
    }
  
    const url = `https://openapi.koreainvestment.com/uapi/domestic-stock/v1/trading/order`;
  
    const orderData = {
      "CANO": ACCOUNT_NO,
      "ACNT_PRDT_CD": "01",
      "PDNO": stock.code,
      "ORD_QTY": quantity.toString(), // 📌 주문 가능 수량만큼 매도
      "ORD_UNPR": bidPrice.toString(), // 📌 매수 1호가로 매도 주문
      "ORD_DVSN": "01", // 01: 지정가 주문
      "ORD_CLS": "00",
      "RQST_TYPE": "ORDER"
    };
  
    try {
      const response = await axios.post(url, orderData, {
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${accessToken}`,
          "appKey": APP_KEY,
          "appSecret": APP_SECRET,
          "tr_id": "TTTC0803U", // 국내주식 현금매도 거래 ID
        }
      });
  
      console.log(`✅ ${stock.code} 매도 주문 성공 (수량: ${quantity}, 주문가: ${bidPrice}):`, response.data);
      boughtStocks.delete(stock.code); // 매도 후 감시 리스트에서 제거
    } catch (error) {
      console.error(`❌ ${stock.code} 매도 주문 실패:`, error.response ? error.response.data : error.message);
    }
  }
  






/**
 * 🔥 감시 로직 실행 (2초마다)
 */
async function startWatchingStocks2() {
    console.log("👀 자동 감시 시작 (2초 간격)");
  
    setInterval(async () => {
      for (let stock of globalStockData) {
        if (!boughtStocks.has(stock.code)) continue; // 매수하지 않은 종목이면 스킵
  
        const { profitRate, availableQty } = await getStockBalance(stock.code);
        if (profitRate === null) continue;
  
        console.log(`📊 ${stock.code} 평가 손익률: ${profitRate}% | 손절: ${mpoint}% | 익절: ${ppoint}% | 주문 가능 수량: ${availableQty}`);
  
        // 🔥 손절 또는 익절 조건 충족 시 매도 실행
        if ((profitRate < mpoint || profitRate > ppoint) && availableQty > 0) {
          console.log(`🚨 ${stock.code} 매도 조건 충족! 주문 가능 수량(${availableQty})으로 매도 주문 실행.`);
  
          const bidPrice = await getAskPrice2(stock.code); // 매수 2호가 조회
          if (bidPrice) {
            await placeSellOrder(stock, availableQty, bidPrice); // 📌 주문 가능 수량만큼 매도
          }
        }
      }
    }, WATCH_INTERVAL);
  }

/**
 * 🔥 정정/취소 가능 주문 조회 API (`ord_tmd` 값 비교하여 10초 이상 지난 주문 찾기)
 */
async function getCancelableOrders() {
    const url = `https://openapi.koreainvestment.com/uapi/domestic-stock/v1/trading/inquire-modify`;
  
    try {
      const response = await axios.get(url, {
        headers: {
          "authorization": `Bearer ${accessToken}`,
          "appKey": APP_KEY,
          "appSecret": APP_SECRET,
          "tr_id": "TTTC0873R", // 정정/취소 가능 주문 조회 API
        },
        params: {
          "CANO": ACCOUNT_NO,
          "ACNT_PRDT_CD": "01",
          "INQR_DVSN": "00", // 전체 조회
          "ORD_DVSN": "00", // 전체 주문
          "PDNO": "",       // 특정 종목이 아니라 전체 조회
        },
      });
  
      const orders = response.data.output;
      if (!orders || orders.length === 0) {
        console.log("✅ 현재 취소 가능한 주문이 없습니다.");
        return [];
      }
  
      const now = moment(); // 현재 시간
  
      // 10초 이상 지난 주문 필터링
      const expiredOrders = orders.filter((order) => {
        const orderTime = moment(order.ord_tmd, "HHmmss");
        return now.diff(orderTime, "seconds") > 10; // 현재 시간과 비교하여 10초 이상 지남
      });
  
      return expiredOrders;
    } catch (error) {
      console.error("❌ 정정/취소 가능 주문 조회 실패:", error.response ? error.response.data : error.message);
      return [];
    }
  }
  
  /**
   * 🔥 주문 취소 API (`TTTC0804U` 사용, 정확한 `odno` 값 적용)
   */
  async function cancelOrder(order) {
    if (!order.odno) {
      console.error("❌ 주문 번호가 없습니다. 취소 불가능.");
      return;
    }
  
    const url = `https://openapi.koreainvestment.com/uapi/domestic-stock/v1/trading/order`;
  
    const cancelData = {
      "CANO": ACCOUNT_NO, // 계좌번호
      "ACNT_PRDT_CD": "01", // 계좌 상품 코드
      "ORD_NO": order.odno, // 취소할 주문 번호
      "ORD_DVSN": "03", // 03: 취소 주문
      "RVSE_CNCL_DVSN_CD": "02", // 02: 취소
    };
  
    try {
      const response = await axios.post(url, cancelData, {
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${accessToken}`,
          "appKey": APP_KEY,
          "appSecret": APP_SECRET,
          "tr_id": "TTTC0804U", // 국내 주식 주문 취소 API
        }
      });
  
      console.log(`✅ 주문 취소 성공 (주문번호: ${order.odno})`, response.data);
    } catch (error) {
      console.error(`❌ 주문 취소 실패 (주문번호: ${order.odno}):`, error.response ? error.response.data : error.message);
    }
  }
  
  
  async function startCancelWatcher() {
    console.log("⏳ 자동 주문 취소 감시 시작 (5초 간격)");
  
    setInterval(async () => {
      const expiredOrders = await getCancelableOrders();
      if (expiredOrders.length > 0) {
        console.log(`🚨 10초 이상 지난 주문 ${expiredOrders.length}건 발견! 자동 취소 실행.`);
        for (const order of expiredOrders) {
          console.log(`🔍 취소할 주문 번호: ${order.odno}, 종목코드: ${order.pdno}, 주문시간: ${order.ord_tmd}`);
          await cancelOrder(order);
        }
      }
    }, WATCH_INTERVAL);
  }
  

// 🔥 크론 스케줄러 (9시 4분 실행 후 30초 후에 fetchStockData 실행)
cron.schedule("4 9 * * *", () => {
    console.log("⏳ [09:04 AM] 크론 스케줄러 실행됨... 30초 대기 중");
  
    setTimeout(async () => {
      console.log("🚀 [09:04:30 AM] Firestore 데이터 가져오기 시작...");
      getAccessToken();
      fetchStockData();
      fetchTotalInvestment()
      startWatchingStocks();
      startWatchingStocks2()
      startCancelWatcher();
      console.log("✅ Firestore 데이터 업데이트 완료!");
    }, 30 * 1000); // 30초 (30,000ms) 후 실행
  }, {
    timezone: "Asia/Seoul" // 한국 시간 기준
  });
  
  console.log("✅ 크론 스케줄러가 설정되었습니다. (매일 9:04:30 AM 실행)");
  

  fetchStockData();
  fetchTotalInvestment()
  startWatchingStocks();
  // startWatchingStocks2()
  // startCancelWatcher();