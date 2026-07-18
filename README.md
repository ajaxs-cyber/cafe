# 黑泡咖啡 HEYPOUR COFFEE · 音乐情绪匹配商业化试点

「音乐情绪匹配」三创赛项目的商业化试点站点：黑泡咖啡店线上商城 + 经营数据面板。

- 前台：品牌首页、背景音乐播放器（用户自主点击播放）、购物袋、下单 + 扫码支付流程、订单查询
- 后台（`/admin`）：订单管理（待确认置顶 / 一键确认发货 / 取消）、收款码上传、六周 A/B 试点经营数据面板（Chart.js 可视化）
- 技术栈：Flask + SQLite + 原生 JS + Chart.js + gunicorn，可直接部署到 Render

---

## 一、本地运行

```bash
# 1. 进入项目目录
cd heipao-cafe

# 2. （推荐）创建虚拟环境
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 3. 安装依赖
pip install -r requirements.txt

# 4. 启动（开发模式）
python app.py
# 或使用生产服务器：
gunicorn app:app --bind 0.0.0.0:5000
```

浏览器访问：

| 页面 | 地址 |
| --- | --- |
| 商城首页 | http://localhost:5000/ |
| 订单查询 | http://localhost:5000/track |
| 管理后台 | http://localhost:5000/admin |

- 首次启动会自动建表并写入试点数据（`data/heipao.db`，42 天 × 2 组逐日指标 + 与之逐日对应的 163 笔历史订单，已存在则跳过）。
- 如需重置演示数据：`python seed.py --force` 后重启。
- 管理员账号：`admin`，密码读取环境变量 `ADMIN_PASSWORD`，未配置时默认为 `heypour2025`。
- 登录后台 →「收款码设置」上传微信/支付宝收款码后，支付页即时展示；未上传时显示「收款码配置中」占位。

## 二、部署到 Render（图文步骤）

### 1. 推送代码到 GitHub

```bash
cd heipao-cafe
git init
git add .
git commit -m "黑泡咖啡：音乐情绪匹配试点站点"
# 在 GitHub 新建一个仓库（如 heipao-cafe），然后：
git remote add origin https://github.com/<你的用户名>/heipao-cafe.git
git branch -M main
git push -u origin main
```

### 2. 创建 Web Service

1. 登录 https://dashboard.render.com ，点击右上角 **「New +」→「Web Service」**。
2. 选择 **「Build and deploy from a Git repository」**，点击 **Next**，连接你的 GitHub 账号并授权。
3. 在仓库列表中找到 `heipao-cafe`，点击 **「Connect」**。

### 3. 填写配置

| 配置项 | 填写内容 |
| --- | --- |
| Name | `heipao-cafe`（决定访问域名 heipao-cafe.onrender.com） |
| Region | Singapore（或任意） |
| Branch | `main` |
| Runtime | Python 3 |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `gunicorn app:app --bind 0.0.0.0:$PORT` |
| Instance Type | Free |

> 也可以直接利用仓库自带的 `render.yaml`：在 New 页面选择 **「New +」→「Blueprint」**，选中仓库后 Render 会自动读取上述配置。

### 4. 配置环境变量

在 **「Environment」→「Environment Variables」** 中添加：

| Key | Value | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 你自己设置的强密码 | 管理后台登录密码（不设置则默认为 `heypour2025`，上线后务必修改） |
| `SECRET_KEY` | 随机长字符串 | Flask session 签名密钥（render.yaml 中已配置自动生成） |

`PORT` 由 Render 自动注入，无需手动设置。

### 5. 部署与验证

1. 点击 **「Create Web Service」**，等待构建日志出现 `==> Build successful` 与 `Starting gunicorn`。
2. 打开 Render 分配的域名（如 `https://heipao-cafe.onrender.com`），确认首页正常。
3. 完整走一遍流程验证：选购商品 → 提交订单 → 支付页点击「我已支付」→ 访问 `/admin` 登录 → 订单管理「确认收款并发货」→ 前台「订单查询」查看状态变更。
4. 登录后台 →「收款码设置」上传真实收款码，再回到任一未支付订单的支付页确认图片已生效。

### 免费实例注意事项

- **休眠唤醒**：免费实例约 15 分钟无请求会休眠，下次访问首次加载需 30–60 秒，属正常现象，评委演示前请先手动访问一次唤醒。
- **磁盘非持久**：免费实例的本地文件系统在重新部署/重启后会被重置，`data/heipao.db` 与上传的收款码会丢失，重启时会自动重新建表 + 生成种子数据，商城功能不受影响；收款码需重新上传。若需长期保存订单数据，可升级付费实例并挂载 Persistent Disk（挂载路径设为项目 `data/` 目录），或改用 Render PostgreSQL。
- **静态资源**：商品图、音乐、Chart.js 均已随仓库分发，不依赖外部 CDN；仅字体使用 Google Fonts CDN。

## 三、项目结构

```
heipao-cafe/
├── app.py                  # Flask 主应用（路由 / 订单状态机 / 自动建表+seed）
├── seed.py                 # 手动重建种子数据脚本（逐日指标 + 历史订单，python seed.py --force）
├── requirements.txt        # flask + gunicorn
├── render.yaml             # Render Blueprint 配置（可选）
├── data/                   # SQLite 数据库（运行时自动生成，已 gitignore）
├── static/
│   ├── css/style.css       # 全站样式（暖米色/奶油/陶土棕，Noto Serif SC 标题）
│   ├── js/                 # 播放器 / 购物袋 / 支付 / 查询 / 数据面板
│   ├── img/                # 4 张商品图
│   ├── audio/ambient.mp3   # 环境音乐（合成的暖色钢琴，48s 循环）
│   ├── uploads/            # 管理员上传的收款码
│   └── vendor/chart.umd.min.js   # Chart.js 本地化
└── templates/              # Jinja2 模板（前台 + admin/）
```

## 四、订单状态机

```
unpaid(待支付) ──顾客点击「我已支付」──▶ pending(待确认) ──管理员「确认收款并发货」──▶ confirmed(已发货)
    │                                       │
    └──────────管理员「取消订单」─────────────┴──────▶ cancelled(已取消)
```

- 订单号格式：`CF` + `yymmdd` + 4 位大写字母数字随机码（如 `CF250718A3F9`），当日不重复；转账备注取后 4 位。
- 支付页含 30 分钟倒计时；超时后需重新下单。
- 订单查询需同时提供订单号 + 下单手机号。
