# -*- coding: utf-8 -*-
"""
黑泡咖啡 HEYPOUR COFFEE —— 音乐情绪匹配商业化试点
Flask + SQLite 单体应用：线上商城 / 扫码支付流程 / 订单查询 / 管理后台 / 经营数据面板
"""
import json
import os
import random
import sqlite3
import string
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template,
                   request, session, url_for)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "heipao.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "heypour-dev-secret-change-me")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "heypour2025")

# ---------------------------------------------------------------- 商品
PRODUCTS = [
    {
        "id": "latte",
        "name": "暖阳拿铁 · 饮品券",
        "price": 29.90,
        "img": "img/latte.jpg",
        "tag": "门店核销",
        "desc": "中深烘拼配与鲜奶的柔和平衡，焦糖与坚果尾韵。凭券至门店兑换任意热/冰拿铁一杯。",
    },
    {
        "id": "beans",
        "name": "山丘拼配 · 精品咖啡豆 200g",
        "price": 68.00,
        "img": "img/beans.jpg",
        "tag": "自烘焙",
        "desc": "埃塞俄比亚与哥伦比亚双产地拼配，中烘曲线，柑橘酸质叠着太妃糖甜感，适合手冲与意式。",
    },
    {
        "id": "drip",
        "name": "漫步系列 · 挂耳咖啡礼盒 12包",
        "price": 59.00,
        "img": "img/drip.jpg",
        "tag": "礼盒装",
        "desc": "四种风味各三包的环游礼盒：花香、莓果、坚果、可可。撕开挂耳，两分钟拥有一杯好咖啡。",
    },
    {
        "id": "combo",
        "name": "午后慢时光 · 咖啡可颂双人下午茶",
        "price": 45.90,
        "img": "img/combo.jpg",
        "tag": "人气组合",
        "desc": "任意咖啡两杯搭配现烤黄油可颂一份，下午两点后供应。把一段慢下来的时光，送给重要的人。",
    },
]
PRODUCT_MAP = {p["id"]: p for p in PRODUCTS}

ORDER_STATUS = {
    "unpaid": "待支付",
    "pending": "待确认",
    "confirmed": "已发货",
    "cancelled": "已取消",
}

# ---------------------------------------------------------------- 数据库
def get_db():
    if "db" not in g:
        os.makedirs(DATA_DIR, exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid',
    created_at TEXT NOT NULL,
    paid_at TEXT,
    confirmed_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    grp TEXT NOT NULL,
    visits INTEGER NOT NULL,
    avg_stay_sec REAL NOT NULL,
    detail_ctr REAL NOT NULL,
    orders INTEGER NOT NULL,
    conv_rate REAL NOT NULL,
    online_aov REAL NOT NULL,
    offline_orders INTEGER NOT NULL,
    offline_aov REAL NOT NULL,
    pairing_rate REAL NOT NULL,
    offpeak_stay_min REAL NOT NULL,
    satisfaction REAL NOT NULL,
    UNIQUE(date, grp)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def get_setting(key, default=None):
    row = get_db().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    db = get_db()
    db.execute(
        "INSERT INTO settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    db.commit()


# ---------------------------------------------------------------- 种子数据
def seed_metrics(db, force=False):
    """生成试点周期 2025-05-25 ~ 2025-07-05 共 42 天 × 2 组的逐日经营数据。
    整体均值吻合试点文档：停留 79.3s→90.8s(+14.5%)、点击率 35.7%→40.1%、
    转化率 7.3%→8.5%(+16.4%)、线上客单 33.1→34.4、线下客单 31.2→32.5、
    搭配率 29.8%→33.4%、非高峰停留 47.6→51.8 分钟、满意度 4.16→4.34；
    线上总访问约 2064 次、线下总订单约 1100 笔。"""
    if not force and db.execute("SELECT COUNT(*) c FROM daily_metrics").fetchone()["c"]:
        return False

    rng = random.Random(20250525)
    start = datetime(2025, 5, 25)
    days = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(42)]
    n = len(days)

    def series(mean, sd, lo=None, hi=None):
        """生成 n 个随机样本（平移校正使样本均值精确等于目标 mean）。"""
        x = [rng.gauss(mean, sd) for _ in range(n)]
        diff = mean - sum(x) / n
        x = [v + diff for v in x]
        if lo is not None or hi is not None:
            x = [min(max(v, lo), hi) for v in x]
            diff = mean - sum(x) / n
            x = [min(max(v + diff, lo), hi) for v in x]
        return x

    def daily_ints(total, weights):
        """按权重把整数 total 分配到 n 天（最大余数法）。"""
        s = float(sum(weights))
        raw = [w / s * total for w in weights]
        base = [int(v) for v in raw]
        rem = total - sum(base)
        order = sorted(range(n), key=lambda i: -(raw[i] - base[i]))
        for i in order[:rem]:
            base[i] += 1
        return base

    def unif(a, b):
        return [rng.uniform(a, b) for _ in range(n)]

    # 周末客流权重（周六日更高）
    wk = [1.25 if datetime.strptime(d, "%Y-%m-%d").weekday() >= 5 else 1.0 for d in days]

    visits_b = daily_ints(1030, [w * u for w, u in zip(wk, unif(0.85, 1.15))])   # 线上总访问 1030+1034=2064
    visits_m = daily_ints(1034, [w * u for w, u in zip(wk, unif(0.85, 1.15))])
    orders_b = daily_ints(75, [v * u for v, u in zip(visits_b, unif(0.7, 1.3))])  # 75/1030 ≈ 7.3%
    orders_m = daily_ints(88, [v * u for v, u in zip(visits_m, unif(0.7, 1.3))])  # 88/1034 ≈ 8.5%
    off_b = daily_ints(545, [w * u for w, u in zip(wk, unif(0.8, 1.2))])          # 线下总订单 545+555=1100
    off_m = daily_ints(555, [w * u for w, u in zip(wk, unif(0.8, 1.2))])

    params = {
        "baseline": dict(stay=79.3, ctr=0.357, aov=33.1, oaov=31.2,
                         pair=0.298, offpk=47.6, sat=4.16,
                         visits=visits_b, orders=orders_b, off=off_b),
        "music": dict(stay=90.8, ctr=0.401, aov=34.4, oaov=32.5,
                      pair=0.334, offpk=51.8, sat=4.34,
                      visits=visits_m, orders=orders_m, off=off_m),
    }
    sds = dict(stay=6.5, ctr=0.035, aov=2.2, oaov=1.9, pair=0.035, offpk=3.2, sat=0.11)

    db.execute("DELETE FROM daily_metrics")
    for grp, p in params.items():
        stay = [round(v, 1) for v in series(p["stay"], sds["stay"], 55, 115)]
        ctr = series(p["ctr"], sds["ctr"], 0.24, 0.52)
        aov = [round(v, 1) for v in series(p["aov"], sds["aov"], 26, 42)]
        oaov = [round(v, 1) for v in series(p["oaov"], sds["oaov"], 25, 40)]
        pair = series(p["pair"], sds["pair"], 0.18, 0.46)
        offpk = [round(v, 1) for v in series(p["offpk"], sds["offpk"], 38, 64)]
        sat = [round(v, 2) for v in series(p["sat"], sds["sat"], 3.8, 4.8)]
        for i, d in enumerate(days):
            v = int(p["visits"][i])
            o = int(min(p["orders"][i], v))
            db.execute(
                "INSERT INTO daily_metrics(date,grp,visits,avg_stay_sec,detail_ctr,"
                "orders,conv_rate,online_aov,offline_orders,offline_aov,pairing_rate,"
                "offpeak_stay_min,satisfaction) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (d, grp, v, stay[i], round(ctr[i], 4), o,
                 round(o / v, 4), aov[i], int(p["off"][i]), oaov[i],
                 round(pair[i], 4), offpk[i], sat[i]),
            )
    db.commit()
    return True


def seed_orders(db, force=False):
    """生成试点周期内的历史线上订单，与 daily_metrics 相洽：
    每天订单数 = 该日 daily_metrics 双组线上订单数之和（合计约 163 笔）；
    订单号沿用 CF+yymmdd+4位随机码（与下单日期一致）；商品偏向 1 件低价饮品券，
    使整体平均客单价落在 33~35 元；状态约 88% 已发货 / 6% 已取消 /
    4% 待确认（集中在最后三天，便于演示一键确认）/ 2% 待支付。"""
    if not force and db.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"]:
        return False

    rng = random.Random(20250705)
    start = datetime(2025, 5, 25)
    days = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(42)]

    # 每天的订单数与该日 daily_metrics 的线上订单数（双组之和）对应
    rows = db.execute(
        "SELECT date, SUM(orders) n FROM daily_metrics GROUP BY date").fetchall()
    per_day = {r["date"]: int(r["n"]) for r in rows}
    if not per_day:  # daily_metrics 缺失时兜底：均匀分配到 42 天
        base, rem = divmod(163, len(days))
        per_day = {d: base + (1 if i < rem else 0) for i, d in enumerate(days)}

    surnames = "王李张刘陈杨赵黄周吴徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭"
    given = ["伟", "芳", "娜", "敏", "静", "磊", "军", "洋", "勇", "艳", "杰", "娟",
             "涛", "明", "超", "秀英", "雪", "晨", "子涵", "雨桐", "欣怡", "梓萱",
             "浩然", "子墨", "宇航", "思远", "嘉琪", "梦琪", "若曦", "晓燕", "文博",
             "婷婷", "志强", "丹丹", "丽丽", "海燕", "俊杰", "晓彤", "一诺", "沐宸"]
    phone_prefix = ["130", "131", "135", "136", "137", "138", "139",
                    "150", "151", "152", "156", "158", "159",
                    "180", "181", "185", "186", "187", "188", "189"]
    districts = {
        "鼓楼区": (["中山北路", "湖南路", "中央路", "广州路"],
                 ["龙江小区", "银城花园", "宝船听涛", "金陵世纪花园"]),
        "玄武区": (["珠江路", "中山东路", "板仓街", "红山路"],
                 ["锁金村", "樱驼花园", "玄武公馆", "紫金东郡"]),
        "建邺区": (["江东中路", "奥体大街", "莫愁湖东路", "庐山路"],
                 ["万达华府", "仁恒江湾城", "莫愁新寓", "金鹰国际花园"]),
        "栖霞区": (["仙林大道", "文枢东路", "学则路", "尧佳路"],
                 ["亚东城", "仙林新村", "保利罗兰香谷", "尧化新村"]),
        "江宁区": (["双龙大道", "胜太路", "天元东路", "将军大道"],
                 ["百家湖国际花园", "托乐嘉", "21世纪太阳城", "武夷绿洲"]),
        "雨花台区": (["雨花西路", "软件大道", "安德门大街", "春江路"],
                  ["雨花新村", "春江新城", "金地自在城", "中海城南公馆"]),
        "秦淮区": (["长乐路", "瑞金路", "中华路", "升州路"],
                 ["夫子庙大市场", "瑞金新村", "王府花园", "大光路小区"]),
        "浦口区": (["文德路", "浦珠路", "江浦街道", "团结路"],
                 ["明发滨江新城", "威尼斯水城", "天润城", "江浦丽都"]),
    }
    # 购物车配额：绝大多数为「饮品券 ×1」，少量多件/高价组合（1~3 种、数量 1~2），
    # 使整体平均客单价稳定在 ~34.5 元（与面板 34.4 元量级一致），仿 daily_ints 的精确配比
    total_n = sum(per_day.get(d, 0) for d in days)
    special_quota = [
        ([("latte", 2)], 3), ([("combo", 1)], 3), ([("combo", 2)], 1),
        ([("drip", 1)], 2), ([("drip", 2)], 1), ([("beans", 1)], 1),
        ([("latte", 1), ("combo", 1)], 2), ([("latte", 1), ("drip", 1)], 2),
        ([("latte", 1), ("beans", 1)], 1),
        ([("latte", 1), ("combo", 1), ("drip", 1)], 1),
    ]
    carts = []
    for lines, cnt in special_quota:
        scaled = max(1, round(cnt * total_n / 163))
        carts.extend([list(lines) for _ in range(scaled)])
    del carts[total_n:]  # 超出部分截断
    carts.extend([[("latte", 1)]] * (total_n - len(carts)))
    rng.shuffle(carts)

    def gen_items(lines):
        items, total = [], 0.0
        for pid, qty in lines:
            p = PRODUCT_MAP[pid]
            items.append({"id": p["id"], "name": p["name"], "price": p["price"], "qty": qty})
            total += p["price"] * qty
        return items, round(total, 2)

    def gen_name():
        return rng.choice(surnames) + rng.choice(given)

    def gen_phone():
        return rng.choice(phone_prefix) + "".join(rng.choices(string.digits, k=8))

    def gen_address():
        d = rng.choice(list(districts))
        roads, estates = districts[d]
        addr = f"南京市{d}{rng.choice(roads)}{rng.randint(2, 288)}号{rng.choice(estates)}"
        addr += f"{rng.randint(1, 32)}栋"
        if rng.random() < 0.6:
            addr += f"{rng.randint(1, 4)}单元"
        addr += f"{rng.randint(1, 32)}0{rng.randint(1, 4)}室"
        return addr

    used_nos = set()

    def gen_order_no(date_str):
        prefix = "CF" + date_str[2:4] + date_str[5:7] + date_str[8:10]
        alphabet = string.ascii_uppercase + string.digits
        while True:
            no = prefix + "".join(rng.choices(alphabet, k=4))
            if no not in used_nos:
                used_nos.add(no)
                return no

    fmt = "%Y-%m-%d %H:%M:%S"
    recent_cutoff = "2025-07-03"  # 待确认/待支付集中在最后三天，便于演示
    orders = []
    for d in days:
        n = per_day.get(d, 0)
        day_start = datetime.strptime(d, "%Y-%m-%d")
        # 当天 08:00~21:30 随机下单，按时间先后排序
        times = sorted(day_start + timedelta(hours=8, minutes=rng.uniform(0, 810))
                       for _ in range(n))
        for t in times:
            items, total = gen_items(carts.pop())
            orders.append({
                "order_no": gen_order_no(d),
                "customer_name": gen_name(),
                "phone": gen_phone(),
                "address": gen_address(),
                "items": json.dumps(items, ensure_ascii=False),
                "total": total,
                "status": "confirmed",
                "created_at": t.strftime(fmt),
                "paid_at": (t + timedelta(minutes=rng.uniform(1, 20))).strftime(fmt),
                "confirmed_at": None,
                "_t": t,
            })

    # 状态分布：约 88% confirmed / 6% cancelled / 4% pending / 2% unpaid
    total_n = len(orders)
    n_cancelled = round(total_n * 0.06)
    n_pending = round(total_n * 0.04)
    n_unpaid = round(total_n * 0.02)

    recent_idx = [i for i, o in enumerate(orders)
                  if o["created_at"][:10] >= recent_cutoff]
    rng.shuffle(recent_idx)
    recent_set = set(recent_idx)
    older_idx = [i for i in range(total_n) if i not in recent_set]
    rng.shuffle(older_idx)
    pool = recent_idx + older_idx  # 优先取最近日期，不够时向前补充

    pending_idx = pool[:n_pending]
    unpaid_idx = pool[n_pending:n_pending + n_unpaid]
    skip = set(pending_idx) | set(unpaid_idx)
    rest = [i for i in range(total_n) if i not in skip]
    rng.shuffle(rest)
    cancelled_idx = rest[:n_cancelled]

    for i in pending_idx:
        orders[i]["status"] = "pending"  # 已支付待确认，保留 paid_at
    for i in unpaid_idx:
        orders[i]["status"] = "unpaid"
        orders[i]["paid_at"] = None
    for i in cancelled_idx:
        orders[i]["status"] = "cancelled"
        if rng.random() < 0.6:  # 多数为未支付即取消
            orders[i]["paid_at"] = None
    for o in orders:
        if o["status"] == "confirmed":
            paid_t = datetime.strptime(o["paid_at"], fmt)
            # 确认（发货）时间 = 下单后 10 分钟 ~ 3 小时，且不早于支付时间
            conf_t = o["_t"] + timedelta(minutes=rng.uniform(10, 180))
            if conf_t < paid_t:
                conf_t = paid_t + timedelta(minutes=rng.uniform(5, 30))
            o["confirmed_at"] = conf_t.strftime(fmt)

    db.execute("DELETE FROM orders")
    db.executemany(
        "INSERT INTO orders(order_no,customer_name,phone,address,items,total,"
        "status,created_at,paid_at,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [(o["order_no"], o["customer_name"], o["phone"], o["address"], o["items"],
          o["total"], o["status"], o["created_at"], o["paid_at"], o["confirmed_at"])
         for o in orders],
    )
    db.commit()
    return True


def init_db():
    """启动时自动建表 + 首次 seed（已存在则跳过）。"""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.row_factory = sqlite3.Row
    try:
        seeded = seed_metrics(conn)
        seeded_orders = seed_orders(conn)
    except sqlite3.IntegrityError:
        # 多进程（多 worker）同时首次启动时，另一进程已完成 seed
        conn.rollback()
        seeded = seeded_orders = False
    conn.close()
    if seeded:
        app.logger.info("daily_metrics 种子数据已生成（42 天 × 2 组）")
    if seeded_orders:
        app.logger.info("历史订单种子数据已生成（与 daily_metrics 逐日对应）")


# ---------------------------------------------------------------- 工具
def gen_order_no(db):
    """CF + yymmdd + 4位大写字母数字随机码，当日不重复。"""
    prefix = "CF" + datetime.now().strftime("%y%m%d")
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(50):
        code = "".join(random.choices(alphabet, k=4))
        no = prefix + code
        if not db.execute("SELECT 1 FROM orders WHERE order_no=?", (no,)).fetchone():
            return no
    raise RuntimeError("订单号生成失败")


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("admin"):
            return redirect(url_for("admin_login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


@app.context_processor
def inject_globals():
    return {"PRODUCTS": PRODUCTS, "ORDER_STATUS": ORDER_STATUS}


# ---------------------------------------------------------------- 前台
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/orders", methods=["POST"])
def create_order():
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    address = (data.get("address") or "").strip()
    items = data.get("items") or []
    if not name or not phone or not address:
        return jsonify({"ok": False, "msg": "请完整填写姓名、手机号与收货地址"}), 400
    if len(phone) < 7:
        return jsonify({"ok": False, "msg": "手机号格式不正确"}), 400
    if not items:
        return jsonify({"ok": False, "msg": "购物车为空"}), 400

    order_items, total = [], 0.0
    for it in items:
        p = PRODUCT_MAP.get((it.get("id") or ""))
        try:
            qty = int(it.get("qty", 0))
        except (TypeError, ValueError):
            qty = 0
        if not p or qty <= 0 or qty > 99:
            return jsonify({"ok": False, "msg": "购物车数据异常，请刷新后重试"}), 400
        order_items.append({"id": p["id"], "name": p["name"], "price": p["price"], "qty": qty})
        total += p["price"] * qty
    total = round(total, 2)

    db = get_db()
    order_no = gen_order_no(db)
    db.execute(
        "INSERT INTO orders(order_no,customer_name,phone,address,items,total,status,created_at)"
        " VALUES(?,?,?,?,?,?, 'unpaid', ?)",
        (order_no, name, phone, address, json.dumps(order_items, ensure_ascii=False),
         total, now_str()),
    )
    db.commit()
    return jsonify({"ok": True, "order_no": order_no, "total": total,
                    "pay_url": url_for("pay_page", order_no=order_no)})


@app.route("/pay/<order_no>")
def pay_page(order_no):
    order = get_db().execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
    if not order:
        abort(404)
    created = datetime.strptime(order["created_at"], "%Y-%m-%d %H:%M:%S")
    deadline = created + timedelta(minutes=30)
    expired = datetime.now() > deadline and order["status"] == "unpaid"
    qr = get_setting("payment_qr")
    return render_template(
        "pay.html", order=order, items=json.loads(order["items"]),
        qr=qr, expired=expired, deadline_ts=int(deadline.timestamp() * 1000),
        tail4=order_no[-4:],
    )


@app.route("/api/orders/<order_no>/pay", methods=["POST"])
def mark_paid(order_no):
    db = get_db()
    order = db.execute("SELECT * FROM orders WHERE order_no=?", (order_no,)).fetchone()
    if not order:
        abort(404)
    if order["status"] == "unpaid":
        db.execute("UPDATE orders SET status='pending', paid_at=? WHERE order_no=? AND status='unpaid'",
                   (now_str(), order_no))
        db.commit()
    return jsonify({"ok": True, "status": "pending"})


@app.route("/track")
def track_page():
    return render_template("track.html")


@app.route("/api/track", methods=["POST"])
def track_api():
    data = request.get_json(force=True, silent=True) or {}
    order_no = (data.get("order_no") or "").strip().upper()
    phone = (data.get("phone") or "").strip()
    order = get_db().execute(
        "SELECT * FROM orders WHERE order_no=? AND phone=?", (order_no, phone)).fetchone()
    if not order:
        return jsonify({"ok": False, "msg": "未查询到订单，请核对订单号与下单手机号"}), 404
    return jsonify({
        "ok": True,
        "order": {
            "order_no": order["order_no"],
            "status": order["status"],
            "status_text": ORDER_STATUS[order["status"]],
            "total": order["total"],
            "items": json.loads(order["items"]),
            "created_at": order["created_at"],
            "paid_at": order["paid_at"],
            "confirmed_at": order["confirmed_at"],
        },
    })


# ---------------------------------------------------------------- 管理后台
@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if username == "admin" and password == ADMIN_PASSWORD:
            session["admin"] = True
            return redirect(request.args.get("next") or url_for("admin_orders"))
        flash("账号或密码不正确", "error")
    return render_template("admin/login.html")


@app.route("/admin/logout")
def admin_logout():
    session.pop("admin", None)
    return redirect(url_for("admin_login"))


@app.route("/admin")
@login_required
def admin_home():
    return redirect(url_for("admin_orders"))


@app.route("/admin/orders")
@login_required
def admin_orders():
    status = request.args.get("status", "")
    db = get_db()
    sql = ("SELECT * FROM orders ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'unpaid' THEN 1"
           " WHEN 'confirmed' THEN 2 ELSE 3 END, created_at DESC")
    rows = db.execute(sql).fetchall()
    if status in ORDER_STATUS:
        rows = [r for r in rows if r["status"] == status]
    orders = [dict(r, item_list=json.loads(r["items"]), tail4=r["order_no"][-4:]) for r in rows]
    counts = {s: db.execute("SELECT COUNT(*) c FROM orders WHERE status=?", (s,)).fetchone()["c"]
              for s in ORDER_STATUS}
    return render_template("admin/orders.html", orders=orders, counts=counts, active=status)


@app.route("/admin/orders/<order_no>/confirm", methods=["POST"])
@login_required
def admin_confirm(order_no):
    db = get_db()
    db.execute(
        "UPDATE orders SET status='confirmed', confirmed_at=? WHERE order_no=? AND status='pending'",
        (now_str(), order_no))
    db.commit()
    flash(f"订单 {order_no} 已确认收款并发货", "ok")
    return redirect(url_for("admin_orders", status=request.args.get("status", "")))


@app.route("/admin/orders/<order_no>/cancel", methods=["POST"])
@login_required
def admin_cancel(order_no):
    db = get_db()
    db.execute(
        "UPDATE orders SET status='cancelled' WHERE order_no=? AND status IN ('unpaid','pending')",
        (order_no,))
    db.commit()
    flash(f"订单 {order_no} 已取消", "ok")
    return redirect(url_for("admin_orders", status=request.args.get("status", "")))


@app.route("/admin/settings", methods=["GET", "POST"])
@login_required
def admin_settings():
    if request.method == "POST":
        f = request.files.get("qr")
        if not f or not f.filename:
            flash("请选择要上传的收款码图片", "error")
            return redirect(url_for("admin_settings"))
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            flash("仅支持 png / jpg / webp / gif 图片", "error")
            return redirect(url_for("admin_settings"))
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        # 清理旧收款码
        old = get_setting("payment_qr")
        if old:
            old_path = os.path.join(UPLOAD_DIR, old)
            if os.path.exists(old_path):
                os.remove(old_path)
        fname = "payment_qr" + ext
        f.save(os.path.join(UPLOAD_DIR, fname))
        set_setting("payment_qr", fname)
        flash("收款码已更新，支付页即时生效", "ok")
        return redirect(url_for("admin_settings"))
    return render_template("admin/settings.html", qr=get_setting("payment_qr"))


@app.route("/admin/dashboard")
@login_required
def admin_dashboard():
    return render_template("admin/dashboard.html")


@app.route("/admin/api/metrics")
@login_required
def admin_metrics_api():
    rows = get_db().execute(
        "SELECT * FROM daily_metrics ORDER BY date, grp").fetchall()
    groups = {"baseline": [], "music": []}
    for r in rows:
        groups[r["grp"]].append(dict(r))

    def agg(items):
        visits = sum(x["visits"] for x in items)
        orders = sum(x["orders"] for x in items)
        clicks = sum(x["visits"] * x["detail_ctr"] for x in items)
        offline_orders = sum(x["offline_orders"] for x in items)
        n = len(items) or 1
        return {
            "visits": visits,
            "orders": orders,
            "detail_clicks": round(clicks),
            "conv_rate": orders / visits if visits else 0,
            "avg_stay_sec": sum(x["avg_stay_sec"] for x in items) / n,
            "detail_ctr": sum(x["detail_ctr"] for x in items) / n,
            "online_aov": sum(x["online_aov"] for x in items) / n,
            "offline_orders": offline_orders,
            "offline_aov": sum(x["offline_aov"] for x in items) / n,
            "pairing_rate": sum(x["pairing_rate"] for x in items) / n,
            "offpeak_stay_min": sum(x["offpeak_stay_min"] for x in items) / n,
            "satisfaction": sum(x["satisfaction"] for x in items) / n,
        }

    return jsonify({
        "period": {"start": rows[0]["date"] if rows else None,
                   "end": rows[-1]["date"] if rows else None, "days": len(groups["baseline"])},
        "summary": {"baseline": agg(groups["baseline"]), "music": agg(groups["music"])},
        "daily": groups,
    })


@app.route("/healthz")
def healthz():
    return "ok", 200


@app.errorhandler(404)
def not_found(_e):
    return render_template("404.html"), 404


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
