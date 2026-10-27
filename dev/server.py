#!/usr/bin/env python3
"""
NexForm — LOCAL PREVIEW FIXTURE SERVER (development only).

Serves the static frontend from ../web and mimics the /functions/v1/app contract
with an IN-MEMORY store and deterministic AI stand-ins, so the whole UI is
interactive without a cloud backend. This is LOCAL SAMPLE DATA, not the deployed
Function. The real server logic lives in ../functions and runs on Qoder Sites.

Run:  python3 dev/server.py   ->  http://127.0.0.1:4173
"""
import json, math, re, os, uuid
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(ROOT, "..", "web"))
PORT = 4173

FIXTURE_USER = {"id": "fixture_user", "name": "Preview User", "picture": ""}

AI_DAILY_CAP = 60
AI_ACTIONS = {"ai-food", "ai-url", "ai-burn", "ai-chat", "ai-targets"}

# ---- in-memory store ----
DB = {
    "profile": None,
    "split": None,
    "foods": [],       # {id,log_date,name,category,calories,protein,carbs,fat,portion,source}
    "workouts": [],    # {id,log_date,name,kind,sets,reps,weight_kg,duration_mins,calories_burned,detail}
    "water": {},       # date -> ml
    "weights": {},     # date -> {weight_kg, body_fat_pct}
    "quota": None,     # {token_id, period, calls, cap} — the fixture user's AI meter
}

def today(): return date.today().isoformat()

# ---- per-user AI usage cap (fixture mirror of the Function logic) ----
def ensure_quota():
    d = today()
    q = DB["quota"]
    if not q:
        q = {"token_id": str(uuid.uuid4()), "period": d, "calls": 0, "cap": AI_DAILY_CAP}
        DB["quota"] = q
    elif q["period"] != d:
        q["period"] = d; q["calls"] = 0
    return {"cap": q["cap"], "used": q["calls"], "remaining": max(0, q["cap"] - q["calls"]),
            "period": q["period"], "tokenId": q["token_id"]}

def consume_quota():
    q = ensure_quota()
    if q["used"] >= q["cap"]:
        return None, (429, {"error": "quota_exceeded"})
    DB["quota"]["calls"] += 1
    return {"cap": q["cap"], "used": DB["quota"]["calls"],
            "remaining": max(0, q["cap"] - DB["quota"]["calls"]),
            "period": q["period"], "tokenId": q["token_id"]}, None

# ---- deterministic fake AI ----
KEYWORD_CAL = {
    "chicken": 120, "paneer": 140, "rice": 130, "roti": 90, "egg": 90, "dal": 110,
    "biryani": 260, "pizza": 280, "burger": 320, "salad": 40, "whey": 120, "chai": 70,
    "coffee": 20, "roll": 220, "curry": 180, "bread": 90, "butter": 100, "milk": 90,
    "banana": 90, "oats": 130, "fish": 110, "sugar": 40, "sweet": 60,
}
KEYWORD_PROT = {"chicken": 25, "paneer": 12, "egg": 8, "whey": 24, "dal": 7, "fish": 22, "milk": 8, "yogurt": 10, "curd": 9}

def fake_food(text, name=None):
    t = (text or "").lower()
    cal, prot = 220, 10
    for k, v in KEYWORD_CAL.items():
        if k in t: cal += v
    for k, v in KEYWORD_PROT.items():
        if k in t: prot += v
    # scale a bit by described quantity digits
    mults = [int(x) for x in re.findall(r"\b(\d{1,2})\b", t) if 1 <= int(x) <= 6]
    if mults: cal = int(cal * (1 + 0.15 * (max(mults) - 1)))
    cal = min(cal, 1800)
    carbs = max(5, int((cal - prot * 4 - int(cal * 0.28) * 9) / 4)) if cal > prot * 4 else 20
    fat = int(cal * 0.28 / 9)
    return {"name": (name or text or "Meal")[:70].strip().title(), "calories": cal,
            "protein": prot, "carbs": max(5, carbs), "fat": max(3, fat),
            "confidence": "medium", "note": "Local preview estimate (fixture AI)."}

def fake_burn_lift(ctx, sets, reps, wkg):
    bw = float(ctx.get("weightKg") or 80)
    vol = sets * reps * max(wkg, 0)
    cal = int(round(6 * sets * (bw / 75) + vol * 0.028))
    return {"caloriesBurned": max(20, cal), "met": 5.5, "note": "Local preview estimate (fixture AI)."}

def fake_burn_cardio(ctx, minutes, intensity):
    bw = float(ctx.get("weightKg") or 80)
    met = {"light": 4.0, "moderate": 7.0, "vigorous": 10.0}.get((intensity or "moderate").lower(), 7.0)
    cal = int(round(met * bw * (minutes / 60.0)))
    return {"caloriesBurned": max(10, cal), "met": met, "note": "Local preview estimate (fixture AI)."}

def fake_chat(msg, ctx):
    name = ctx.get("name", "there")
    left = max(0, int(ctx.get("calorieTarget", 2200)) - int(ctx.get("todayCalories", 0)))
    prot_left = max(0, int(ctx.get("proteinTarget", 170)) - int(ctx.get("todayProtein", 0)))
    m = msg.lower()
    if any(k in m for k in ["analyze", "day", "progress", "so far"]):
        return (f"Here's your day, {name}: you've eaten {ctx.get('todayCalories',0)} kcal "
                f"({left} left of your {ctx.get('calorieTarget',0)} target) and {ctx.get('todayProtein',0)}g protein "
                f"({prot_left}g to go). You've burned {ctx.get('todayBurned',0)} kcal. "
                f"{'Close the protein gap with a whey shake or Greek yogurt.' if prot_left>20 else 'Protein is on track — nice work.'} "
                f"(Local preview reply.)")
    if any(k in m for k in ["dinner", "eat", "recipe", "meal", "food"]):
        return (f"For your goal, try grilled chicken + veggies (~400 kcal, 58g protein) or "
                f"paneer tikka with a roti. Both fit your remaining {left} kcal. (Local preview reply.)")
    if any(k in m for k in ["plateau", "weight", "fat", "loss"]):
        return (f"At {ctx.get('weightKg','?')}kg targeting {ctx.get('targetWeightKg','?')}kg, if the scale stalls "
                f"2+ weeks drop ~150 kcal or add 2,000 steps, and keep protein at {ctx.get('proteinTarget',170)}g. (Local preview reply.)")
    return (f"I'm Nex in local preview mode. I can see your targets and today's log. Ask me about food, "
            f"training or progress, {name}.")

def fake_targets(p):
    # Deterministic local stand-in for the AI planner (fixture only).
    w = float(p.get("weight_kg") or 80); h = float(p.get("height_cm") or 175)
    tw = float(p.get("target_weight_kg") or w)
    age = float(p.get("age") or 25); act = float(p.get("activity") or 1.55)
    sex = str(p.get("gender") or "Male").lower(); goal = p.get("goal") or "recomp"
    bmi = w / ((h / 100) ** 2) if h else 25
    # Size intake to an adjusted weight for an overweight person so we don't over-feed them.
    abw = (tw + 0.4 * (w - tw)) if (bmi >= 25 and tw < w) else w
    bmr = 10 * abw + 6.25 * h - 5 * age + (5 if sex == "male" else -161 if sex == "female" else -78)
    tdee = bmr * act
    if goal == "cut": cal = tdee * 0.78
    elif goal == "recomp": cal = tdee * 0.88
    elif goal == "bulk": cal = tdee + 280
    else: cal = tdee
    floor = 1200 if sex == "female" else 1400
    cal = max(floor, round(cal))
    pbase = w if goal == "bulk" else min(w, abw)
    protein = round(pbase * (1.8 if goal == "bulk" else 2.0 if goal == "cut" else 1.9))
    fat = round(abw * (0.7 if goal == "cut" else 0.8))
    carbs = max(40, round((cal - protein * 4 - fat * 9) / 4))
    return {"calories": round(cal), "protein": protein, "carbs": carbs, "fat": fat,
            "waterMl": round(w * 33), "bmr": round(bmr), "tdee": round(tdee),
            "note": "Local preview plan (fixture AI)."}

# ---- contract ----
def do_action(action, method, body, query):
    if method not in ("GET", "POST"):
        return 405, {"error": "method_not_allowed"}
    _q = None
    if method == "POST" and action in AI_ACTIONS:
        _q, _err = consume_quota()
        if _err:
            return _err
    if action == "boot" and method == "GET":
        d = today()
        prof = DB["profile"]
        if not prof:
            return 200, {"user": FIXTURE_USER, "profile": None}
        foods = [f for f in DB["foods"] if f["log_date"] == d]
        wos = [w for w in DB["workouts"] if w["log_date"] == d]
        wh = [{"date": k, "weight_kg": v["weight_kg"], "body_fat_pct": v.get("body_fat_pct")} for k, v in sorted(DB["weights"].items())]
        return 200, {"user": FIXTURE_USER, "profile": prof, "foods": foods, "workouts": wos,
                     "water": DB["water"].get(d, 0), "weightHistory": wh, "split": DB["split"],
                     "aiQuota": ensure_quota()}
    if action == "quota" and method == "GET":
        return 200, {"ok": True, "quota": ensure_quota()}
    if action == "today" and method == "GET":
        d = today()
        return 200, {"foods": [f for f in DB["foods"] if f["log_date"] == d],
                     "workouts": [w for w in DB["workouts"] if w["log_date"] == d],
                     "water": DB["water"].get(d, 0)}
    if action == "profile" and method == "POST":
        prof = {
            "user_id": FIXTURE_USER["id"], "display_name": str(body.get("display_name", "You"))[:60],
            "age": int(body.get("age") or 25), "gender": body.get("gender", "Male"),
            "height_cm": float(body.get("height_cm") or 175), "weight_kg": float(body.get("weight_kg") or 75),
            "target_weight_kg": float(body.get("target_weight_kg") or 70),
            "body_fat_pct": body.get("body_fat_pct"), "activity": float(body.get("activity") or 1.55),
            "goal": body.get("goal", "recomp"), "diet_pref": body.get("diet_pref", ""), "split": DB["split"],
            "meta": body.get("meta") or {}, "targets": (DB["profile"] or {}).get("targets"),
        }
        DB["profile"] = prof
        return 200, {"profile": prof, "split": DB["split"]}
    if action == "split-save" and method == "POST":
        DB["split"] = body.get("split")
        if DB["profile"]: DB["profile"]["split"] = DB["split"]
        return 200, {"ok": True}
    if action == "food-log" and method == "POST":
        row = {"id": str(uuid.uuid4()), "log_date": today(), "name": body.get("name", "Food"),
               "category": body.get("category", "Snack"), "calories": int(body.get("calories") or 0),
               "protein": int(body.get("protein") or 0), "carbs": int(body.get("carbs") or 0),
               "fat": int(body.get("fat") or 0), "portion": body.get("portion", 1), "source": body.get("source", "")}
        DB["foods"].append(row)
        return 200, {"ok": True, "id": row["id"]}
    if action == "food-delete" and method == "POST":
        DB["foods"] = [f for f in DB["foods"] if f["id"] != body.get("id")]
        return 200, {"ok": True}
    if action == "exercise-log" and method == "POST":
        row = {"id": str(uuid.uuid4()), "log_date": today(), "name": body.get("name", "Exercise"),
               "kind": body.get("kind", "lift"), "sets": int(body.get("sets") or 0), "reps": int(body.get("reps") or 0),
               "weight_kg": body.get("weight_kg") or 0, "duration_mins": int(body.get("duration_mins") or 0),
               "calories_burned": int(body.get("calories_burned") or 0), "detail": body.get("detail") or {}}
        DB["workouts"].append(row)
        return 200, {"ok": True, "id": row["id"]}
    if action == "exercise-delete" and method == "POST":
        DB["workouts"] = [w for w in DB["workouts"] if w["id"] != body.get("id")]
        return 200, {"ok": True}
    if action == "water" and method == "POST":
        d = today()
        DB["water"][d] = max(0, DB["water"].get(d, 0) + int(body.get("delta") or 0))
        return 200, {"ok": True, "water": DB["water"][d]}
    if action == "weight-save" and method == "POST":
        d = body.get("date") or today()
        DB["weights"][d] = {"weight_kg": float(body.get("weight_kg") or 0), "body_fat_pct": body.get("body_fat_pct")}
        if DB["profile"]: DB["profile"]["weight_kg"] = float(body.get("weight_kg") or DB["profile"]["weight_kg"])
        return 200, {"ok": True}
    if action == "history" and method == "GET":
        days = min(90, max(1, int((query.get("days", ["7"])[0]))))
        out = []
        base = date.today()
        lastw = None
        for i in range(days - 1, -1, -1):
            d = (base - timedelta(days=i)).isoformat()
            cal = sum(f["calories"] for f in DB["foods"] if f["log_date"] == d)
            prot = sum(f["protein"] for f in DB["foods"] if f["log_date"] == d)
            burn = sum(w["calories_burned"] for w in DB["workouts"] if w["log_date"] == d)
            wv = DB["weights"].get(d, {}).get("weight_kg")
            if wv: lastw = wv
            out.append({"date": d, "calories": cal, "protein": prot, "burned": burn, "weight": wv or lastw})
        return 200, {"days": out}
    if action == "ai-food" and method == "POST":
        return 200, {"ok": True, "result": fake_food(body.get("text"), None), "quota": _q}
    if action == "ai-url" and method == "POST":
        u = body.get("url", "")
        slug = re.sub(r"[^a-z ]", " ", urlparse(u).path.lower()).strip() if u.startswith("http") else u
        return 200, {"ok": True, "result": fake_food(slug or u, (slug or "Ordered item").title()), "quota": _q}
    if action == "ai-burn" and method == "POST":
        ctx = body.get("context", {})
        if body.get("kind") == "cardio":
            return 200, {"ok": True, "result": fake_burn_cardio(ctx, int(body.get("minutes") or 0), body.get("intensity")), "quota": _q}
        return 200, {"ok": True, "result": fake_burn_lift(ctx, int(body.get("sets") or 0), int(body.get("reps") or 0), float(body.get("weightKg") or 0)), "quota": _q}
    if action == "ai-chat" and method == "POST":
        return 200, {"ok": True, "result": {"reply": fake_chat(body.get("message", ""), body.get("context", {}))}, "quota": _q}
    if action == "ai-targets" and method == "POST":
        prof = DB["profile"] or {}
        res = fake_targets(prof)
        if DB["profile"]: DB["profile"]["targets"] = res
        return 200, {"ok": True, "result": res, "quota": _q}
    return 404, {"error": "not_found"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send_json(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_static(self, path):
        if path in ("/__qoder_auth/start", "/__qoder_auth/logout") or path.startswith("/__qoder_auth/"):
            self.send_response(302); self.send_header("location", "/"); self.end_headers(); return
        rel = path.lstrip("/") or "index.html"
        rel = rel.split("?")[0]
        full = os.path.normpath(os.path.join(WEB, rel))
        if not full.startswith(WEB) or not os.path.isfile(full):
            self.send_error(404, "Not found"); return
        ctype = {".html": "text/html", ".css": "text/css", ".js": "text/javascript",
                 ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json"}.get(
                 os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/functions/v1/app"):
            query = parse_qs(parsed.query)
            action = query.get("action", [""])[0]
            status, obj = do_action(action, "GET", {}, query)
            self._send_json(status, obj)
        else:
            self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/functions/v1/app"):
            self.send_error(404); return
        query = parse_qs(parsed.query)
        action = query.get("action", [""])[0]
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except Exception:
            body = {}
        status, obj = do_action(action, "POST", body, query)
        self._send_json(status, obj)


if __name__ == "__main__":
    print(f"NexForm local preview (FIXTURE data) -> http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
