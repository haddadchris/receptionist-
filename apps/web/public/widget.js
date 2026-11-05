/*!
 * Fekerte chat widget.
 * <script src="https://YOUR-FEKERTE-DOMAIN/widget.js" data-business="your-slug" data-color="#0e7490" data-lang="ar" async></script>
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var slug = script.getAttribute("data-business");
  if (!slug) return console.warn("[fekerte] data-business attribute missing");
  var color = script.getAttribute("data-color") || "#0e7490";
  var lang = script.getAttribute("data-lang");
  var origin = new URL(script.src).origin;
  var rtl = (lang || document.documentElement.lang || "").slice(0, 2) === "ar";
  var side = rtl ? "left" : "right";

  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Chat");
  btn.style.cssText =
    "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483646;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.2);background:" + color + ";color:#fff;display:flex;align-items:center;justify-content:center";
  btn.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  var frame = null;
  function open() {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = "Chat";
      frame.src = origin + "/chat/" + encodeURIComponent(slug) + "?embed=1" + (lang ? "&lang=" + encodeURIComponent(lang) : "");
      frame.allow = "microphone";
      frame.style.cssText =
        "position:fixed;bottom:88px;" + side + ":20px;z-index:2147483647;width:min(380px,calc(100vw - 40px));height:min(600px,calc(100vh - 120px));" +
        "border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);background:#fff";
      document.body.appendChild(frame);
    } else {
      frame.style.display = frame.style.display === "none" ? "block" : "none";
    }
  }
  btn.addEventListener("click", open);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(btn); });
  else document.body.appendChild(btn);
})();
