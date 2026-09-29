(function attachMoneyUtils(global) {
  function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeCurrency(currency) {
    return String(currency || "USD").toUpperCase() === "LBP" ? "LBP" : "USD";
  }

  function getExchangeRate() {
    const s = global.settings || {};
    const rate = safeNumber(s.exchangeRate);
    return rate > 0 ? rate : 1;
  }

  function toMinor(amount, currency) {
    const c = normalizeCurrency(currency);
    const n = safeNumber(amount);
    return c === "USD" ? Math.round(n * 100) : Math.round(n);
  }

  function fromMinor(minor, currency) {
    const c = normalizeCurrency(currency);
    const n = safeNumber(minor);
    return c === "USD" ? n / 100 : Math.round(n);
  }

  function convert(amount, fromCurrency, toCurrency) {
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    const n = safeNumber(amount);
    if (from === to) return n;
    const rate = getExchangeRate();
    if (from === "USD" && to === "LBP") return Math.round(n * rate);
    if (from === "LBP" && to === "USD") return n / rate;
    return n;
  }

  function lbpSuffix() {
    try {
      const lang = (global.document && global.document.documentElement && global.document.documentElement.lang) || "ar";
      return lang === "en" ? "LBP" : "L.L.";
    } catch (_) {
      return "LBP";
    }
  }

  function format(amount, currency) {
    const c = normalizeCurrency(currency);
    const n = safeNumber(amount);
    if (c === "USD") {
      const sign = n < 0 ? "-" : "";
      const abs = Math.abs(n);
      const intPart = Math.floor(abs).toLocaleString("en-US");
      const decPart = abs.toFixed(2).split(".")[1] || "00";
      return `${sign}$${intPart}.${decPart}`;
    }
    return `${Math.round(n).toLocaleString()} ${lbpSuffix()}`;
  }

  global.moneyUtils = {
    safeNumber,
    normalizeCurrency,
    getExchangeRate,
    toMinor,
    fromMinor,
    convert,
    format,
  };
})(window);
