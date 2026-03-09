/**
 * Example Gryt Plugin: Clock Widget
 *
 * Demonstrates how a plugin can inject DOM elements and CSS,
 * use the window.gryt API, and clean up on removal.
 */
(function () {
  "use strict";

  var CONTAINER_ID = "gryt-clock-widget";

  // Inject scoped styles
  var style = document.createElement("style");
  style.setAttribute("data-gryt-addon", "example-plugin");
  style.textContent = [
    "#" + CONTAINER_ID + " {",
    "  padding: 6px 0;",
    "  text-align: center;",
    "  font-size: 11px;",
    "  font-variant-numeric: tabular-nums;",
    "  color: var(--gray-9);",
    "  user-select: none;",
    "}",
  ].join("\n");
  document.head.appendChild(style);

  // Create the clock element
  var el = document.createElement("div");
  el.id = CONTAINER_ID;
  el.setAttribute("data-gryt-addon", "example-plugin");

  function updateClock() {
    var now = new Date();
    el.textContent = now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  updateClock();
  var interval = setInterval(updateClock, 10000);

  // Insert into the sidebar (waits for the sidebar to appear)
  function tryInsert() {
    var sidebar = document.querySelector('[data-gryt="sidebar"]');
    if (sidebar && !document.getElementById(CONTAINER_ID)) {
      sidebar.appendChild(el);
      return true;
    }
    return false;
  }

  if (!tryInsert()) {
    var observer = new MutationObserver(function () {
      if (tryInsert()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Safety timeout
    setTimeout(function () {
      observer.disconnect();
    }, 30000);
  }

  // Listen for theme changes via the plugin API
  if (window.gryt) {
    window.gryt.on("themeChange", function (theme) {
      console.log("[Clock Plugin] Theme changed:", theme.appearance);
    });
  }

  // Register cleanup so the addon loader can remove this plugin cleanly.
  // Note: script elements are removed by the addon loader automatically,
  // but the injected DOM nodes and intervals need explicit cleanup.
  window.addEventListener("gryt:addon-cleanup:example-plugin", function () {
    clearInterval(interval);
    el.remove();
    style.remove();
  });
})();
