// 문제: 결제 대행사 API 키 하드코딩 (가짜 값)
const PAYMENT_API_KEY = 'shopapi_8Hq2Lm9Vx4Tz7Rb3Wn6Ys1Kc5Dp';

async function chargeOrder(order) {
  return { orderId: order.id, charged: true, via: PAYMENT_API_KEY.slice(0, 4) };
}

module.exports = { chargeOrder };
