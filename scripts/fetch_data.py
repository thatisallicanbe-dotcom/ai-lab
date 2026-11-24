#!/usr/bin/env python3
"""강원 곁에 — 공공데이터 수집 스크립트

GitHub Actions에서 매일 실행됩니다. 인증키는 환경변수 DATA_GO_KR_KEY(저장소 비밀값)로만 받습니다.
결과는 data/ 폴더의 JSON 파일로 저장되고, 웹앱은 이 파일을 읽습니다.

  data/programs.json   지원제도 (행정안전부 공공서비스(혜택) 정보)
  data/hospitals.json  강원 병·의원 (국립중앙의료원 → 실패 시 건강보험심사평가원)
  data/toilets.json    강원 공중화장실 (행정안전부 공중화장실정보)
  data/geocache.json   화장실 주소 → 좌표 캐시 (OpenStreetMap Nominatim, 실행마다 조금씩 채움)
  data/meta.json       수집 시각과 API별 결과 요약

어느 API가 실패해도 다른 파일은 저장되며, 실패한 파일은 이전 값을 그대로 둡니다.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

KEY = os.environ.get("DATA_GO_KR_KEY", "").strip()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)
GANGWON = ["춘천", "원주", "강릉", "동해", "태백", "속초", "삼척", "홍천", "횡성", "영월",
           "평창", "정선", "철원", "화천", "양구", "인제", "고성", "양양"]
OTHER_SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "충청", "충북", "충남",
              "전라", "전북", "전남", "경상", "경북", "경남", "제주"]
UA = "gangwon-gyeote/0.1 (github.com/thatisallicanbe-dotcom/ai-lab)"
meta = {"collectedAt": NOW.strftime("%Y-%m-%d %H:%M"), "sources": {}}


def log(*a):
    print(*a, flush=True)


def get(url, params, timeout=40):
    """serviceKey는 로그에 남기지 않습니다."""
    q = urllib.parse.urlencode(params, safe="[]:")
    full = url + ("&" if "?" in url else "?") + q
    req = urllib.request.Request(full, headers={"User-Agent": UA, "Accept": "application/json, application/xml"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code >= 500 and attempt < 2:
                time.sleep(3)
                continue
            return e.code, body
        except Exception as e:  # 네트워크 오류
            if attempt < 2:
                time.sleep(3)
                continue
            return 0, str(e)
    return 0, "unreachable"


def write(name, obj):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def read(name, default):
    try:
        with open(os.path.join(OUT, name), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def short(s, n=400):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def xml_items(text):
    root = ET.fromstring(text)
    code = root.findtext(".//resultCode")
    items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
    total = root.findtext(".//totalCount")
    return code, items, int(total) if total and total.isdigit() else None


# ---------------------------------------------------------------- 지원제도
def fetch_programs():
    url = "https://api.odcloud.kr/api/gov24/v3/serviceList"
    rows, page, per = [], 1, 1000
    while True:
        st, body = get(url, {"serviceKey": KEY, "page": page, "perPage": per, "returnType": "JSON"})
        if st != 200:
            raise RuntimeError(f"HTTP {st}: {body[:200]}")
        j = json.loads(body)
        data = j.get("data") or []
        rows.extend(data)
        total = j.get("totalCount") or j.get("matchCount") or 0
        log(f"  programs page {page}: {len(data)} (total {total})")
        if not data or len(rows) >= total or page >= 30:
            break
        page += 1
    if rows:
        log("  program fields:", list(rows[0].keys()))
    out = []
    for r in rows:
        org = r.get("소관기관명", "") or ""
        other = any(x in org for x in OTHER_SIDO)
        local = ("강원" in org) or (any(g in org for g in GANGWON) and not other)
        head = org.split()[0] if org else ""
        # 다른 시·도 지자체 사업은 제외 (중앙부처·공공기관 + 강원 지자체만 남김)
        if not local and (other or re.search(r"(시|군|구)$", head)):
            continue
        out.append({
            "id": r.get("서비스ID"),
            "name": short(r.get("서비스명"), 80),
            "summary": short(r.get("서비스목적요약"), 140),
            "target": short(r.get("지원대상"), 220),
                        "support": short(r.get("지원내용"), 220),
            "how": short(r.get("신청방법"), 160),
            "period": short(r.get("신청기한"), 120),
            "org": short(org, 60),
            "dept": short(r.get("부서명"), 60),
            "receipt": short(r.get("접수기관"), 120),
            "field": short(r.get("서비스분야"), 40),
            "userType": short(r.get("사용자구분"), 40),
            "kind": short(r.get("지원유형"), 40),
            "url": r.get("상세조회URL") or "",
            "local": local,
        })
    out = [p for p in out if p["id"] and p["name"]]
    write("programs.json", out)
    return f"{len(out)}건 (강원 지자체 {sum(p['local'] for p in out)}건)"


# ---------------------------------------------------------------- 병원
def nmc_hours(it):
    days = {}
    for i in range(1, 9):  # 1=월 … 7=일, 8=공휴일
        s, c = it.get(f"dutyTime{i}s"), it.get(f"dutyTime{i}c")
        if s and c:
            days[str(i)] = [s, c]
    return days


def fetch_hospitals():
    url = "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire"
    errors = []
    for q0 in ["강원특별자치도", "강원도"]:
        rows, page = [], 1
        while True:
            st, body = get(url, {"serviceKey": KEY, "Q0": q0, "pageNo": page, "numOfRows": 1000})
            if st != 200 or not body.lstrip().startswith("<"):
                errors.append(f"NMC {q0} HTTP {st}: {body[:160]}")
                break
            try:
                code, items, total = xml_items(body)
            except ET.ParseError as e:
                errors.append(f"NMC parse {e}")
                break
            if code not in (None, "00"):
                errors.append(f"NMC {q0} resultCode {code}: {body[:160]}")
                break
            rows.extend(items)
            log(f"  NMC {q0} page {page}: {len(items)} (total {total})")
            if not items or (total and len(rows) >= total) or page >= 20:
                break
            page += 1
        if rows:
            log("  hospital fields:", list(rows[0].keys()))
            out = []
            for it in rows:
                try:
                    lat, lng = float(it.get("wgs84Lat") or 0), float(it.get("wgs84Lon") or 0)
                except ValueError:
                    continue
                if not lat or not lng:
                    continue
                out.append({"name": it.get("dutyName"), "addr": it.get("dutyAddr"),
                            "kind": it.get("dutyDivNam"), "er": it.get("dutyEryn") == "1",
                            "lat": round(lat, 6), "lng": round(lng, 6), "hours": nmc_hours(it)})
            write("hospitals.json", out)
            return f"{len(out)}건 (국립중앙의료원)"

    # 대체: 건강보험심사평가원 병원정보서비스 (진료시간 없음)
    url2 = "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList"
    rows, page = [], 1
    while True:
        st, body = get(url2, {"ServiceKey": KEY, "sidoCd": "320000", "pageNo": page, "numOfRows": 1000})
        if st != 200 or not body.lstrip().startswith("<"):
            errors.append(f"HIRA HTTP {st}: {body[:160]}")
            break
        code, items, total = xml_items(body)
        if code not in (None, "00"):
            errors.append(f"HIRA resultCode {code}: {body[:160]}")
            break
        rows.extend(items)
        log(f"  HIRA page {page}: {len(items)} (total {total})")
        if not items or (total and len(rows) >= total) or page >= 20:
            break
        page += 1
    if not rows:
        raise RuntimeError(" | ".join(errors))
    log("  hospital fields:", list(rows[0].keys()))
    out = []
    for it in rows:
        try:
            lat, lng = float(it.get("YPos") or 0), float(it.get("XPos") or 0)
        except ValueError:
            continue
        if lat and lng:
            out.append({"name": it.get("yadmNm"), "addr": it.get("addr"), "kind": it.get("clCdNm"),
                        "er": False, "lat": round(lat, 6), "lng": round(lng, 6), "hours": {}})
    write("hospitals.json", out)
    return f"{len(out)}건 (건강보험심사평가원, 진료시간 없음)"


# ---------------------------------------------------------------- 공중화장실
def pick(rec, *cands):
    for c in cands:
        for k, v in rec.items():
            if k.upper() == c and v not in (None, ""):
                return str(v).strip()
    return ""


def fetch_toilets():
    url = "https://apis.data.go.kr/1741000/public_restroom_info_v2/info_v2"
    rows, page = [], 1
    while True:
        st, body = get(url, {"serviceKey": KEY, "pageNo": page, "numOfRows": 100, "returnType": "json",
                             "cond[LCTN_ROAD_NM_ADDR::LIKE]": "강원"})
        if st != 200:
            raise RuntimeError(f"HTTP {st}: {body[:200]}")
        try:
            j = json.loads(body)
        except json.JSONDecodeError:
            raise RuntimeError(f"JSON 아님: {body[:200]}")
        resp = j.get("response", j)
        bodyj = resp.get("body", resp)
        items = bodyj.get("items", [])
        if isinstance(items, dict):
            items = items.get("item", [])
        if isinstance(items, dict):
            items = [items]
        total = int(bodyj.get("totalCount") or 0)
        rows.extend(items)
        log(f"  toilets page {page}: {len(items)} (total {total})")
        if not items or (total and len(rows) >= total) or page >= 200:
            break
        page += 1
    if not rows:
        header = (j.get("response", {}) or {}).get("header", {})
        raise RuntimeError(f"결과 없음 {header}")
    log("  toilet fields:", list(rows[0].keys()))
    write("_toilet_sample.json", rows[:2])  # 필드 이름 확인용 (공개 데이터)
    cache = read("geocache.json", {})
    out = []
    for r in rows:
        road = pick(r, "LCTN_ROAD_NM_ADDR", "RDNMADR", "ROAD_NM_ADDR")
        lot = pick(r, "LCTN_LOTNO_ADDR", "LNMADR", "LOTNO_ADDR")
        addr = road or lot
        if "강원" not in addr:
            continue
        name = pick(r, "RSTRM_NM", "TOILET_NM", "TLT_NM", "BLDG_NM", "FCLT_NM") or \
            next((str(v) for k, v in r.items() if k.upper().endswith("_NM") and "ADDR" not in k.upper() and v), "공중화장실")
        hours = pick(r, "OPN_HR", "OPEN_TM", "OPN_TM", "OPNNG_HR")
        hours_detail = pick(r, "OPN_HR_DTL", "OPEN_TM_DTL", "OPN_TM_DTL")
        dis = 0
        for k, v in r.items():
            ku = k.upper()
            if ("DSPSN" in ku or "DSBL" in ku or "HNDCP" in ku) and str(v).strip().isdigit():
                dis += int(str(v).strip())
        rec = {"name": short(name, 60), "addr": short(addr, 120), "hours": short(hours or hours_detail, 60),
               "accessible": dis > 0}
        g = cache.get(addr)
        if g:
            rec["lat"], rec["lng"] = g
        out.append(rec)
    write("toilets.json", out)
    with_xy = sum(1 for t in out if "lat" in t)
    return f"{len(out)}건 (좌표 있음 {with_xy}건)"


def geocode_toilets(limit=250):
    """주소 → 좌표. Nominatim 이용 정책에 따라 1초에 1건 이하로 천천히 채웁니다."""
    toilets = read("toilets.json", [])
    cache = read("geocache.json", {})
    misses = read("geomiss.json", {})
    todo = [t["addr"] for t in toilets if t["addr"] not in cache and t["addr"] not in misses]
    done = 0
    for addr in todo[:limit]:
        q = re.sub(r"\(.*?\)", "", addr).replace("강원특별자치도", "강원도").strip()
        st, body = get("https://nominatim.openstreetmap.org/search",
                       {"q": q, "format": "json", "limit": 1, "countrycodes": "kr"}, timeout=20)
        time.sleep(1.1)
        try:
            res = json.loads(body) if st == 200 else []
        except json.JSONDecodeError:
            res = []
        if res:
            cache[addr] = [round(float(res[0]["lat"]), 6), round(float(res[0]["lon"]), 6)]
            done += 1
        else:
            misses[addr] = NOW.strftime("%Y-%m-%d")
    write("geocache.json", cache)
    write("geomiss.json", misses)
    for t in toilets:
        g = cache.get(t["addr"])
        if g:
            t["lat"], t["lng"] = g
    write("toilets.json", toilets)
    return f"이번 실행 {done}건 좌표 변환, 누적 {len(cache)}건, 남은 {max(0, len(todo) - limit)}건"


def main():
    if not KEY:
        log("DATA_GO_KR_KEY 비밀값이 없습니다. 저장소 Settings → Secrets and variables → Actions에서 등록하세요.")
        sys.exit(1)
    prev = read("meta.json", {})
    for name, fn in [("programs", fetch_programs), ("hospitals", fetch_hospitals), ("toilets", fetch_toilets),
                     ("geocode", geocode_toilets)]:
        log(f"[{name}]")
        try:
            res = fn()
            meta["sources"][name] = {"ok": True, "result": res, "at": meta["collectedAt"]}
            log("  OK", res)
        except Exception as e:
            msg = str(e).replace(KEY, "***")[:300]
            old = (prev.get("sources") or {}).get(name, {})
            meta["sources"][name] = {"ok": False, "error": msg, "lastOk": old.get("at") if old.get("ok") else old.get("lastOk")}
            log("  FAIL", msg)
    write("meta.json", meta)
    if not any(s.get("ok") for k, s in meta["sources"].items() if k != "geocode"):
        sys.exit(1)


if __name__ == "__main__":
    main()
