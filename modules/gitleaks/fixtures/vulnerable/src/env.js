// 안전한 예: 비밀 값은 환경 변수에서 읽음 → 검출되면 오탐
module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  paymentApiKey: process.env.PAYMENT_API_KEY ?? '',
  databasePassword: process.env.DB_PASSWORD,
};
