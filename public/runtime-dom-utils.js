(function attachRuntimeDomUtils(global) {
  function bindOnce(element, eventName, key, handler) {
    if (!element || typeof handler !== "function") return;
    const evt = String(eventName || "click");
    const token = String(key || evt);
    if (!element.__boundEventKeys) element.__boundEventKeys = Object.create(null);
    if (element.__boundEventKeys[token]) return;
    element.__boundEventKeys[token] = true;
    element.addEventListener(evt, handler);
  }

  global.runtimeDomUtils = {
    bindOnce,
  };
})(window);
