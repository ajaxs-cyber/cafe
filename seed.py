# -*- coding: utf-8 -*-
"""种子数据脚本：生成试点周期 2025-05-25 ~ 2025-07-05 的逐日经营数据与历史订单。

用法：
    python seed.py          # 若 daily_metrics / orders 已有数据则跳过
    python seed.py --force  # 清空并重新生成

应用启动时也会自动执行同样的初始化（已存在则跳过），本脚本用于手动重建数据。
历史订单逐日数量与 daily_metrics 的线上订单数（双组之和）一一对应。
"""
import sqlite3
import sys

from app import DB_PATH, SCHEMA, seed_metrics, seed_orders

if __name__ == "__main__":
    force = "--force" in sys.argv
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.row_factory = sqlite3.Row
    done = seed_metrics(conn, force=force)
    if done:
        n = conn.execute("SELECT COUNT(*) c FROM daily_metrics").fetchone()["c"]
        print(f"种子数据已生成：daily_metrics 共 {n} 行（42 天 × 2 组）")
    else:
        print("daily_metrics 已存在数据，跳过（使用 --force 可重新生成）")
    done_orders = seed_orders(conn, force=force)
    if done_orders:
        n = conn.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"]
        aov = conn.execute("SELECT AVG(total) a FROM orders").fetchone()["a"]
        print(f"历史订单已生成：orders 共 {n} 笔，平均客单价 ¥{aov:.2f}")
    else:
        print("orders 已存在数据，跳过（使用 --force 可重新生成）")
    conn.close()
