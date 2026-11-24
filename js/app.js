(function () {
  "use strict";

  var D = window.GG_DATA;
  var app = document.getElementById("app");

  // ---------- 저장소 (기기 안에만 저장) ----------
  function load(key, fallback) {
    try { var v = localStorage.getItem("gg." + key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem("gg." + key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 */ }
  }

  // ---------- 공통 도구 ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function timeText(iso) {
    var d = new Date(iso); if (isNaN(d)) return "";
    var now = new Date();
    var same = d.toDateString() === now.toDateString();
    var h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
    var ampm = h < 12 ? "오전" : "오후"; var hh = h % 12 || 12;
    var day = same ? "오늘" : (d.getMonth() + 1) + "월 " + d.getDate() + "일";
    return day + " " + ampm + " " + hh + ":" + m;
  }
  function distM(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function distText(m) { return m < 1000 ? Math.round(m / 10) * 10 + "m" : (m / 1000).toFixed(1) + "km"; }
  function openState(hours) {
    if (!hours) return { open: null, text: "운영시간 확인 필요" };
    if (hours.indexOf("24시간") === 0) return { open: true, text: "지금 열림 · 24시간" };
    var m = hours.match(/(\d{2}):(\d{2})~(\d{2}):(\d{2})/);
    if (!m) return { open: null, text: hours };
    var now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
    var s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
    var open = cur >= s && cur < e;
    return { open: open, text: (open ? "지금 열림 · " : "지금 닫힘 · ") + hours };
  }
  function b64enc(obj) {
    var s = unescape(encodeURIComponent(JSON.stringify(obj)));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64dec(str) {
    try {
      var s = str.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      return JSON.parse(decodeURIComponent(escape(atob(s))));
    } catch (e) { return null; }
  }
  function baseUrl() { return location.href.split("#")[0]; }

  function addRecent(text) {
    var r = load("recent", []);
    r.unshift({ text: text, at: new Date().toISOString() });
    save("recent", r.slice(0, 10));
  }

  // ---------- 음성 ----------
  var synth = window.speechSynthesis;
  function speak(text) {
    if (!synth) { toast("이 브라우저는 읽어주기를 지원하지 않아요"); return; }
    if (synth.speaking) { synth.cancel(); return; }
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR"; u.rate = 0.9;
    synth.speak(u);
  }
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listen(onText) {
    if (!Rec) { toast("이 브라우저는 음성 입력을 지원하지 않아요. 글로 써 주세요."); return false; }
    var r = new Rec(); r.lang = "ko-KR"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = function (e) { onText(e.results[0][0].transcript); };
    r.onerror = function () { toast("잘 듣지 못했어요. 다시 눌러 말씀해 주세요."); };
    r.start(); toast("말씀하세요…");
    return true;
  }

  // ---------- 위치 ----------
  function getPosition(cb) {
    if (!navigator.geolocation) { cb(null); return; }
    navigator.geolocation.getCurrentPosition(
      function (p) { cb([p.coords.latitude, p.coords.longitude]); },
      function () { cb(null); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  // ---------- 공유 (링크로 가족에게 전달) ----------
  function shareLink(text, url) {
    var full = text + "\n" + url;
    if (navigator.share) {
      navigator.share({ title: "강원 곁에", text: text, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(full).then(function () {
        toast("복사했어요. 카카오톡이나 문자에 붙여넣어 보내세요.");
      }, function () { prompt("아래 내용을 복사해 보내세요", full); });
    } else {
      prompt("아래 내용을 복사해 보내세요", full);
    }
  }

  // ---------- 화면: 홈 ----------
  function viewHome() {
    var fam = load("family", null);
    var inbox = load("inbox", []);
    var h = '';
    h += '<button class="btn primary big" id="mic">말로 물어보기<small>눌러서 말씀하세요</small></button>';
    h += '<div class="row"><a class="btn tall" href="#/places/hospital">병원</a><a class="btn tall" href="#/places/toilet">화장실</a></div>';
    if (fam && fam.role === "parent") {
      h += '<button class="btn good" id="ok">나 괜찮아요<small>' + esc(fam.otherLabel || "가족") + '에게 안부 보내기</small></button>';
    }
    if (inbox.length) {
      var it = inbox[0];
      var p = findProgram(it.id);
      if (p) {
        h += '<div class="card inbox" id="inbox"><p class="label">' + esc(it.from) + '이(가) 보낸 정보 · ' + esc(timeText(it.at)) + '</p>' +
          '<h3>' + esc(p.name) + '</h3><p class="meta">눌러서 자세히 보기</p></div>';
      }
    }
    h += '<a class="btn" href="#/support">나에게 맞는 지원</a>';
    h += '<a class="btn" href="#/family">' + (fam ? "가족" : "가족 연결하기") + '</a>';
    h += '<a class="btn" href="#/chat">글로 물어보기</a>';
    app.innerHTML = h;

    document.getElementById("mic").onclick = function () {
      var ok = listen(function (t) { location.hash = "#/chat?q=" + encodeURIComponent(t); });
      if (!ok) location.hash = "#/chat";
    };
    var okBtn = document.getElementById("ok");
    if (okBtn) okBtn.onclick = sendOk;
    var ib = document.getElementById("inbox");
    if (ib) ib.onclick = function () { location.hash = "#/support/" + inbox[0].id; };
  }

  function sendOk() {
    var fam = load("family", null) || {};
    var payload = { t: "ok", from: fam.myLabel || "부모님", at: new Date().toISOString(),
      recent: load("recent", []).slice(0, 3) };
    function finish() {
      var url = baseUrl() + "#/f?d=" + b64enc(payload);
      shareLink((payload.from) + "이(가) 잘 지낸다고 알려왔어요 (" + timeText(payload.at) + ")", url);
      toast((fam.otherLabel || "가족") + "에게 보낼 준비가 됐어요");
    }
    if (fam.shareLocation) {
      getPosition(function (pos) {
        if (pos) payload.loc = [+pos[0].toFixed(4), +pos[1].toFixed(4)];
        finish();
      });
    } else finish();
  }

  // ---------- 화면: AI 상담 (시제품: 샘플 자료 검색) ----------
  var chatLog = [];
  function findProgram(id) { return D.programs.filter(function (p) { return p.id === id; })[0]; }

  function answer(q) {
    var t = q.replace(/\s+/g, "");
    if (/화장실|변소|볼일/.test(t)) {
      return { text: "가까운 공중화장실을 찾아드릴게요.", actions: [{ label: "화장실 찾기", href: "#/places/toilet" }] };
    }
    if (/병원|의원|아파|아픈|약국|진료|응급/.test(t)) {
      return { text: "가까운 병원을 찾아드릴게요.", actions: [{ label: "병원 찾기", href: "#/places/hospital" }] };
    }
    var region = D.regions.filter(function (r) { return t.indexOf(r.replace(/[시군]$/, "")) >= 0; })[0];
    var scored = D.programs.map(function (p) {
      var s = 0; p.keywords.forEach(function (k) { if (t.indexOf(k) >= 0) s += 1; });
      return { p: p, s: s };
    }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 3);
    if (!scored.length) {
      return { text: "확인된 자료가 없어요. 이런 걸 물어보시겠어요?", chips: D.suggestions };
    }
    var lines = scored.map(function (x) { return "· " + x.p.name + ": " + x.p.summary; });
    var head = (region ? region + "에 사시는 분이 " : "") + "해당될 수 있는 지원이에요.";
    return {
      text: head + "\n" + lines.join("\n"),
      actions: scored.map(function (x) { return { label: x.p.name + " 자세히", href: "#/support/" + x.p.id }; }),
      sources: scored.map(function (x) { return x.p.source; }).filter(function (s, i, a) { return a.findIndex(function (y) { return y.url === s.url; }) === i; })
    };
  }

  function viewChat(query) {
    var h = '<a class="back" href="#/">← 처음으로</a><h1>물어보기</h1>';
    h += '<p class="notice">시제품입니다. AI 모델을 연결하기 전이라 샘플 자료에서 찾아 답해요.</p>';
    h += '<div class="chat" id="chat"></div>';
    h += '<div id="chips"></div>';
    h += '<form class="composer" id="form"><input id="q" placeholder="궁금한 것을 써 주세요" aria-label="질문 입력" autocomplete="off">' +
      '<button class="btn primary" type="submit">묻기</button><button class="btn" type="button" id="mic2" aria-label="말로 묻기">🎤</button></form>';
    app.innerHTML = h;
    renderChat();
    var chips = document.getElementById("chips");
    if (!chatLog.length) {
      chips.innerHTML = '<p class="label">이렇게 물어보세요</p><div class="actions" style="display:flex;flex-wrap:wrap;gap:8px">' +
        D.suggestions.map(function (s) { return '<button class="chip" data-q="' + esc(s) + '">' + esc(s) + '</button>'; }).join("") + '</div>';
    }
    chips.onclick = function (e) { var b = e.target.closest("[data-q]"); if (b) ask(b.getAttribute("data-q")); };
    document.getElementById("form").onsubmit = function (e) {
      e.preventDefault(); var v = document.getElementById("q").value.trim(); if (v) ask(v);
    };
    document.getElementById("mic2").onclick = function () { listen(function (t) { ask(t, true); }); };
    if (query) ask(query, true);
  }

  function ask(q, heard) {
    addRecent("질문: " + q);
    chatLog.push({ me: true, text: q, heard: !!heard });
    chatLog.push(Object.assign({ me: false }, answer(q)));
    var chips = document.getElementById("chips"); if (chips) chips.innerHTML = "";
    var input = document.getElementById("q"); if (input) input.value = "";
    renderChat();
  }

  function renderChat() {
    var box = document.getElementById("chat"); if (!box) return;
    box.innerHTML = chatLog.map(function (m, i) {
      if (m.me) {
        return '<div class="msg me">' + (m.heard ? '<div class="heard">이렇게 들었어요</div>' : '') + esc(m.text) + '</div>';
      }
      var a = '<div class="msg bot">' + esc(m.text).replace(/\n/g, "<br>");
      if (m.sources) {
        a += '<div class="src">출처: ' + m.sources.map(function (s) {
          return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>';
        }).join(", ") + ' · 수집일 ' + esc(D.collectedAt) + ' (샘플)</div>';
      }
      a += '<div class="actions"><button class="chip" data-speak="' + i + '">읽어주기</button>';
      (m.actions || []).forEach(function (x) { a += '<a class="chip" href="' + esc(x.href) + '">' + esc(x.label) + '</a>'; });
      (m.chips || []).forEach(function (s) { a += '<button class="chip" data-q="' + esc(s) + '">' + esc(s) + '</button>'; });
      return a + '</div></div>';
    }).join("");
    box.onclick = function (e) {
      var s = e.target.closest("[data-speak]");
      if (s) speak(chatLog[+s.getAttribute("data-speak")].text);
      var c = e.target.closest("[data-q]");
      if (c) ask(c.getAttribute("data-q"));
    };
    var last = box.lastElementChild; if (last) last.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- 화면: 나에게 맞는 지원 ----------
  var STEPS = [
    { key: "region", q: "어디에 사세요?", options: D.regions },
    { key: "age", q: "나이대를 골라 주세요", options: [["19-34", "19~34세"], ["35-49", "35~49세"], ["50-64", "50~64세"], ["65+", "65세 이상"]] },
    { key: "field", q: "어떤 도움이 필요하세요?", options: [["생활비", "생활비"], ["돌봄", "돌봄"], ["일자리", "일자리"], ["건강", "건강"], ["주거", "주거"], ["", "모두 보기"]] }
  ];

  function viewSupport() {
    var prof = load("profile", {});
    var step = STEPS.filter(function (s) { return prof[s.key] === undefined; })[0];
    if (step) {
      var h = '<a class="back" href="#/">← 처음으로</a><h1>' + esc(step.q) + '</h1><div class="choices">';
      step.options.forEach(function (o) {
        var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
        h += '<button class="btn" data-v="' + esc(v) + '">' + esc(l) + '</button>';
      });
      h += '<button class="btn" data-v="">건너뛰기</button></div>';
      app.innerHTML = h;
      app.querySelector(".choices").onclick = function (e) {
        var b = e.target.closest("[data-v]"); if (!b) return;
        prof[step.key] = b.getAttribute("data-v"); save("profile", prof); viewSupport();
      };
      return;
    }
    var list = D.programs.filter(function (p) {
      return (!prof.age || p.ages.indexOf(prof.age) >= 0) && (!prof.field || p.fields.indexOf(prof.field) >= 0);
    });
    var h2 = '<a class="back" href="#/">← 처음으로</a><h1>나에게 맞는 지원</h1>';
    h2 += '<p class="label">' + esc([prof.region, ageLabel(prof.age), prof.field].filter(Boolean).join(" · ") || "조건 없음") + '</p>';
    h2 += '<p class="notice">샘플 요약입니다. 받을 수 있는지는 공식 출처에서 꼭 확인하세요.</p>';
    if (!list.length) {
      h2 += '<p>조건에 맞는 지원을 찾지 못했어요.</p>';
    }
    list.forEach(function (p) {
      h2 += '<a class="card" style="display:block;color:inherit;text-decoration:none" href="#/support/' + esc(p.id) + '"><h3>' + esc(p.name) + '</h3><p>' + esc(p.summary) + '</p><p class="meta">신청: ' + esc(p.period) + '</p></a>';
    });
    h2 += '<button class="btn" id="reset">조건 다시 고르기</button>';
    app.innerHTML = h2;
    document.getElementById("reset").onclick = function () { save("profile", {}); viewSupport(); };
  }
  function ageLabel(a) { var o = STEPS[1].options.filter(function (x) { return x[0] === a; })[0]; return o ? o[1] : ""; }

  function viewProgram(id) {
    var p = findProgram(id);
    if (!p) { app.innerHTML = '<a class="back" href="#/">← 처음으로</a><p>정보를 찾을 수 없어요.</p>'; return; }
    addRecent("지원제도: " + p.name);
    var fam = load("family", null);
    var h = '<a class="back" href="#/support">← 목록으로</a><h1>' + esc(p.name) + '</h1>';
    h += '<p>' + esc(p.summary) + '</p>';
    h += '<button class="btn" id="read">읽어주기</button>';
    h += '<h2>누가 받을 수 있나요</h2><p>' + esc(p.target) + '</p>';
    h += '<h2>무엇을 받나요</h2><p>' + esc(p.support) + '</p>';
    h += '<h2>언제 신청하나요</h2><p>' + esc(p.period) + '</p>';
    h += '<h2>준비할 서류</h2><ul class="checklist">' + p.docs.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join("") + '</ul>';
    h += '<h2>신청 방법</h2><ol class="steps">' + p.how.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join("") + '</ol>';
    h += '<p class="meta">출처: <a href="' + esc(p.source.url) + '" target="_blank" rel="noopener">' + esc(p.source.name) + '</a> · 수집일 ' + esc(D.collectedAt) + ' (샘플 요약)</p>';
    h += '<button class="btn primary" id="send">가족에게 보내기</button>';
    app.innerHTML = h;
    document.getElementById("read").onclick = function () {
      speak(p.name + ". " + p.summary + " 대상은 " + p.target + ". 신청 방법은 " + p.how.join(", ") + ".");
    };
    document.getElementById("send").onclick = function () {
      var from = (fam && fam.myLabel) || "가족";
      var url = baseUrl() + "#/f?d=" + b64enc({ t: "info", from: from, id: p.id, at: new Date().toISOString() });
      shareLink(from + "이(가) '" + p.name + "' 정보를 보냈어요", url);
    };
  }

  // ---------- 화면: 병원·화장실 ----------
  var mapObj = null;
  function viewPlaces(type) {
    type = type === "hospital" ? "hospital" : "toilet";
    var title = type === "toilet" ? "가까운 화장실" : "가까운 병원";
    var h = '<a class="back" href="#/">← 처음으로</a><h1>' + title + '</h1>';
    h += '<div class="tabs"><a href="#/places/hospital" class="' + (type === "hospital" ? "on" : "") + '">병원</a>' +
      '<a href="#/places/toilet" class="' + (type === "toilet" ? "on" : "") + '">화장실</a></div>';
    h += '<p class="notice">시제품: 춘천·원주·강릉의 샘플 위치예요. 실제 서비스는 공공데이터로 바뀌어요.</p>';
    h += '<div id="map" class="map"></div><div id="list"><p>위치를 확인하고 있어요…</p></div>';
    h += '<div id="morebox"></div>';
    app.innerHTML = h;
    var fallbackCity = load("city", "춘천시");

    getPosition(function (pos) {
      var me = pos, usedCity = null;
      if (!me) { usedCity = fallbackCity; me = D.cityCenters[usedCity]; }
      else {
        // 강원 밖이면 샘플이 너무 멀어서 시·군 기준점을 대신 사용
        var nearest = Math.min.apply(null, Object.keys(D.cityCenters).map(function (c) { return distM(pos, D.cityCenters[c]); }));
        if (nearest > 60000) { usedCity = fallbackCity; me = D.cityCenters[usedCity]; }
      }
      addRecent((type === "toilet" ? "화장실" : "병원") + " 찾기");
      renderPlaces(type, me, usedCity, 3);
    });
  }

  function renderPlaces(type, me, usedCity, count) {
    var items = D.places.filter(function (p) { return p.type === type; })
      .map(function (p) { return Object.assign({ d: distM(me, [p.lat, p.lng]) }, p); })
      .sort(function (a, b) { return a.d - b.d; });
    var shown = items.slice(0, count);
    var list = document.getElementById("list"); if (!list) return;
    var h = '';
    if (usedCity) {
      h += '<label class="field">기준 지역 (위치를 쓸 수 없을 때)<select id="city">' +
        Object.keys(D.cityCenters).map(function (c) { return '<option' + (c === usedCity ? ' selected' : '') + '>' + c + '</option>'; }).join("") +
        '</select></label>';
    }
    h += shown.map(function (p, i) {
      var st = openState(p.hours);
      var badge = st.open === true ? '<span class="badge open">열림</span>' : st.open === null ? '<span class="badge check">확인 필요</span>' : '<span class="badge check">닫힘</span>';
      var extra = type === "toilet" ? (p.accessible ? " · 장애인용 있음" : "") : (p.dept ? " · " + p.dept : "");
      return '<div class="place"><h3>' + (i + 1) + '. ' + esc(p.name) + badge + '</h3><p class="meta">' + distText(p.d) + ' · ' + esc(st.text) + esc(extra) + '</p>' +
        '<a class="chip" target="_blank" rel="noopener" href="https://map.kakao.com/link/to/' + encodeURIComponent(p.name) + ',' + p.lat + ',' + p.lng + '">길찾기</a></div>';
    }).join("");
    list.innerHTML = h;
    var sel = document.getElementById("city");
    if (sel) sel.onchange = function () { save("city", sel.value); renderPlaces(type, D.cityCenters[sel.value], sel.value, count); };
    var more = document.getElementById("morebox");
    more.innerHTML = count < items.length ? '<button class="btn" id="more">더 보기</button>' : '';
    var mb = document.getElementById("more");
    if (mb) mb.onclick = function () { renderPlaces(type, me, usedCity, count + 3); };
    drawMap(me, shown, !usedCity);
  }

  function drawMap(me, shown, isReal) {
    var el = document.getElementById("map");
    if (!el) return;
    if (!window.L) { el.classList.add("hidden"); return; }
    if (mapObj) { mapObj.remove(); mapObj = null; }
    mapObj = L.map(el, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap"
    }).addTo(mapObj);
    var pts = [me];
    L.circleMarker(me, { radius: 9, color: "#1a56c4", fillColor: "#1a56c4", fillOpacity: 0.9 })
      .addTo(mapObj).bindPopup(isReal ? "내 위치" : "기준 위치");
    shown.forEach(function (p, i) {
      pts.push([p.lat, p.lng]);
      L.marker([p.lat, p.lng]).addTo(mapObj).bindPopup((i + 1) + ". " + esc(p.name));
    });
    mapObj.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
  }

  // ---------- 화면: 가족 ----------
  function viewFamily() {
    var fam = load("family", null);
    if (!fam) { viewFamilySetup(); return; }
    if (fam.role === "parent") viewFamilyParent(fam); else viewFamilyChild(fam);
  }

  function viewFamilySetup() {
    var h = '<a class="back" href="#/">← 처음으로</a><h1>가족 연결하기</h1>';
    h += '<p>가입 없이 이 기기에서만 설정해요. 안부와 정보는 카카오톡·문자로 보내는 링크로 주고받아요.</p>';
    h += '<div class="choices"><button class="btn tall" data-role="parent">저는 부모예요<small>안부를 보내는 쪽</small></button>' +
      '<button class="btn tall" data-role="child">저는 자녀예요<small>안부를 확인하는 쪽</small></button></div>';
    app.innerHTML = h;
    app.querySelector(".choices").onclick = function (e) {
      var b = e.target.closest("[data-role]"); if (!b) return;
      var role = b.getAttribute("data-role");
      var h2 = '<a class="back" href="#/family">← 뒤로</a><h1>' + (role === "parent" ? "부모" : "자녀") + ' 설정</h1>';
      h2 += '<label class="field">저를 가족이 부르는 말<input id="me" placeholder="' + (role === "parent" ? "예: 어머니" : "예: 딸") + '"></label>';
      h2 += '<label class="field">상대 가족을 부르는 말<input id="other" placeholder="' + (role === "parent" ? "예: 딸" : "예: 어머니") + '"></label>';
      if (role === "parent") {
        h2 += '<div class="card soft"><p><b>무엇이 공유되나요?</b></p><p>\'나 괜찮아요\'를 누를 때 보낸 시각과 최근 찾아본 정보(최대 3개)가 함께 가요.</p>' +
          '<label class="toggle"><input type="checkbox" id="loc"> 이때 지금 위치도 함께 보내기</label>' +
          '<p class="meta">언제든 가족 화면에서 바꾸거나 연결을 해제할 수 있어요.</p></div>';
      }
      h2 += '<button class="btn primary" id="done">' + (role === "parent" ? "동의하고 연결" : "연결") + '</button>';
      app.innerHTML = h2;
      document.getElementById("done").onclick = function () {
        var me = document.getElementById("me").value.trim() || (role === "parent" ? "부모님" : "자녀");
        var other = document.getElementById("other").value.trim() || (role === "parent" ? "자녀" : "부모님");
        var loc = document.getElementById("loc");
        save("family", { role: role, myLabel: me, otherLabel: other, shareLocation: !!(loc && loc.checked) });
        toast("연결 설정이 끝났어요");
        location.hash = role === "parent" ? "#/" : "#/family";
      };
    };
  }

  function viewFamilyParent(fam) {
    var h = '<a class="back" href="#/">← 처음으로</a><h1>가족</h1>';
    h += '<div class="card"><h3>' + esc(fam.otherLabel) + '와(과) 연결됨</h3><p class="meta">이 기기에서 저는 \'' + esc(fam.myLabel) + '\'</p></div>';
    h += '<button class="btn good tall" id="ok">나 괜찮아요<small>' + esc(fam.otherLabel) + '에게 안부 보내기</small></button>';
    h += '<h2>공유 설정</h2><label class="toggle"><input type="checkbox" id="loc"' + (fam.shareLocation ? " checked" : "") + '> 안부 보낼 때 위치도 함께 보내기</label>';
    h += '<button class="btn" id="unlink">연결 해제</button>';
    app.innerHTML = h;
    document.getElementById("ok").onclick = sendOk;
    document.getElementById("loc").onchange = function (e) { fam.shareLocation = e.target.checked; save("family", fam); toast("바꿨어요"); };
    document.getElementById("unlink").onclick = unlink;
  }

  function viewFamilyChild(fam) {
    var st = load("status", null);
    var h = '<a class="back" href="#/">← 처음으로</a><h1>가족</h1>';
    if (!st) {
      h += '<div class="card soft"><h3>' + esc(fam.otherLabel) + '의 안부가 아직 없어요</h3>' +
        '<p>' + esc(fam.otherLabel) + ' 휴대폰에서 이 사이트를 열고 \'가족 연결하기 → 저는 부모예요\'로 설정한 뒤, \'나 괜찮아요\'를 누르면 받은 링크로 여기에 표시돼요.</p></div>';
      h += '<button class="btn" id="invite">' + esc(fam.otherLabel) + '께 사이트 보내기</button>';
    } else {
      h += '<div class="card"><h3>' + esc(st.from) + '</h3><p>나 괜찮아요 · ' + esc(timeText(st.at)) + '</p>' +
        (st.loc ? '' : '<p class="meta">위치는 함께 보내지 않았어요</p>') + '</div>';
      if (st.loc) h += '<div id="map" class="map"></div><p class="meta">위치는 안부를 보낸 그때의 곳이에요. 지금 위치와 다를 수 있어요.</p>';
      if (st.recent && st.recent.length) {
        h += '<h2>최근 찾아본 정보</h2>' + st.recent.map(function (r) {
          return '<div class="place"><p>' + esc(r.text) + '</p><p class="meta">' + esc(timeText(r.at)) + '</p></div>';
        }).join("");
      }
    }
    h += '<h2>' + esc(fam.otherLabel) + '께 정보 보내기</h2><p class="meta">지원제도 화면의 \'가족에게 보내기\'를 누르면 링크로 보낼 수 있어요.</p>';
    h += '<a class="btn primary" href="#/support">보낼 지원제도 고르기</a>';
    h += '<button class="btn" id="unlink">연결 해제</button>';
    app.innerHTML = h;
    var inv = document.getElementById("invite");
    if (inv) inv.onclick = function () { shareLink("강원 곁에 — 병원·화장실 찾기와 안부 보내기", baseUrl()); };
    document.getElementById("unlink").onclick = unlink;
    if (st && st.loc && window.L) {
      var m = L.map("map"); mapObj = m;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m);
      L.marker(st.loc).addTo(m).bindPopup(esc(st.from) + " · " + esc(timeText(st.at)));
      m.setView(st.loc, 15);
    }
  }

  function unlink() {
    if (!confirm("가족 연결을 해제할까요? 이 기기에 저장된 안부와 위치도 지워져요.")) return;
    save("family", null); save("status", null); save("inbox", []);
    try { localStorage.removeItem("gg.family"); localStorage.removeItem("gg.status"); } catch (e) {}
    toast("연결을 해제했어요"); location.hash = "#/";
  }

  // 공유 링크로 들어왔을 때
  function receive(d) {
    var p = b64dec(d || "");
    if (!p || !p.t) { app.innerHTML = '<p>링크를 읽을 수 없어요.</p><a class="btn" href="#/">처음으로</a>'; return; }
    if (p.t === "ok") {
      save("status", { from: String(p.from || "가족").slice(0, 20), at: p.at,
        loc: Array.isArray(p.loc) && p.loc.length === 2 ? [+p.loc[0], +p.loc[1]] : null,
        recent: Array.isArray(p.recent) ? p.recent.slice(0, 3).map(function (r) { return { text: String(r.text).slice(0, 60), at: r.at }; }) : [] });
      if (!load("family", null)) save("family", { role: "child", myLabel: "자녀", otherLabel: String(p.from || "부모님").slice(0, 20) });
      location.replace("#/family");
    } else if (p.t === "info" && findProgram(p.id)) {
      var inbox = load("inbox", []);
      inbox.unshift({ from: String(p.from || "가족").slice(0, 20), id: p.id, at: p.at });
      save("inbox", inbox.slice(0, 10));
      toast("받은 정보를 처음 화면에 놓아 두었어요");
      location.replace("#/");
    } else {
      location.replace("#/");
    }
  }

  // ---------- 라우터 ----------
  function route() {
    if (mapObj) { mapObj.remove(); mapObj = null; }
    if (synth && synth.speaking) synth.cancel();
    var hash = location.hash.replace(/^#/, "") || "/";
    var parts = hash.split("?"), path = parts[0], qs = new URLSearchParams(parts[1] || "");
    var seg = path.split("/").filter(Boolean);
    if (!seg.length) viewHome();
    else if (seg[0] === "chat") viewChat(qs.get("q"));
    else if (seg[0] === "support" && seg[1]) viewProgram(seg[1]);
    else if (seg[0] === "support") viewSupport();
    else if (seg[0] === "places") viewPlaces(seg[1]);
    else if (seg[0] === "family") viewFamily();
    else if (seg[0] === "f") receive(qs.get("d"));
    else viewHome();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }

  // 글씨 크기
  function applySize(n) {
    document.documentElement.setAttribute("data-size", n);
    document.querySelectorAll(".size-switch button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-size") === String(n) ? "true" : "false");
    });
  }
  document.querySelector(".size-switch").addEventListener("click", function (e) {
    var b = e.target.closest("[data-size]"); if (!b) return;
    var n = b.getAttribute("data-size"); save("size", n); applySize(n);
  });
  applySize(load("size", "1"));

  window.addEventListener("hashchange", route);
  route();
})();
