/* 试点数据看板：拉取 /admin/api/metrics，渲染横幅、指标卡、Chart.js 图表、周度表与结论 */
(function () {
  var COLOR_MUSIC = '#a67c52';
  var COLOR_MUSIC_FILL = 'rgba(166, 124, 82, .14)';
  var COLOR_BASE = '#b9a98f';
  var COLOR_BASE_FILL = 'rgba(185, 169, 143, .55)';
  var COLOR_OLIVE = '#5d7a52';
  var COLOR_GRID = 'rgba(133, 119, 103, .12)';

  fetch('/admin/api/metrics')
    .then(function (r) {
      if (r.status === 401 || r.redirected) { window.location.href = '/admin/login'; throw new Error('auth'); }
      return r.json();
    })
    .then(function (data) {
      renderBanner(data);
      renderMetrics(data);
      renderCharts(data);
      renderWeekly(data);
      renderConclusion(data);
    })
    .catch(function (e) {
      var grid = document.getElementById('metricGrid');
      if (grid && e.message !== 'auth') grid.innerHTML = '<div class="loading-hint">数据加载失败，请刷新重试</div>';
    });

  /* ---------------- 工具 ---------------- */
  function r1(n) { return Math.round(n * 10) / 10; }
  function setText(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }
  function pctChange(oldV, newV) { return ((newV - oldV) / oldV) * 100; }
  function signed(n, digits) { return (n >= 0 ? '+' : '') + n.toFixed(digits); }
  function cnDate(iso, withYear) {
    var p = iso.split('-');
    var s = (+p[1]) + '.' + (+p[2]);
    return withYear ? p[0] + '.' + s : s;
  }

  /* ---------------- 试点概览横幅 ---------------- */
  function renderBanner(data) {
    var b = data.summary.baseline, m = data.summary.music;
    var totalVisits = b.visits + m.visits;
    var totalOffline = b.offline_orders + m.offline_orders;
    var days = (data.period && data.period.days) || data.daily.baseline.length;
    if (data.period && data.period.start) {
      setText('bsPeriod', cnDate(data.period.start, true) + ' – ' + cnDate(data.period.end, false));
    }
    setText('bsDays', days);
    setText('bsWeeks', '天 · 共 ' + Math.round(days / 7) + ' 周');
    setText('bsVisits', totalVisits.toLocaleString());
    setText('bsOffline', totalOffline.toLocaleString());
  }

  /* ---------------- 8 个核心指标对比卡 ---------------- */
  function metricDefs(b, m) {
    // 展示值先按精度取整，变化幅度由取整后的展示值计算（与试点报告口径一致）
    return [
      { name: '线上平均停留时长', scope: '线上', unit: '秒', old: r1(b.avg_stay_sec), neu: r1(m.avg_stay_sec), type: 'pct' },
      { name: '商品详情点击率', scope: '线上', unit: '%', old: r1(b.detail_ctr * 100), neu: r1(m.detail_ctr * 100), type: 'pp' },
      { name: '线上订单转化率', scope: '线上', unit: '%', old: r1(b.conv_rate * 100), neu: r1(m.conv_rate * 100), type: 'pct' },
      { name: '线上平均客单价', scope: '线上', unit: '元', old: r1(b.online_aov), neu: r1(m.online_aov), type: 'pct' },
      { name: '线下平均客单价', scope: '线下', unit: '元', old: r1(b.offline_aov), neu: r1(m.offline_aov), type: 'pct' },
      { name: '饮品与甜品搭配率', scope: '线下', unit: '%', old: r1(b.pairing_rate * 100), neu: r1(m.pairing_rate * 100), type: 'pp' },
      { name: '非高峰平均停留时间', scope: '线下', unit: '分钟', old: r1(b.offpeak_stay_min), neu: r1(m.offpeak_stay_min), type: 'pct' },
      { name: '顾客满意度（5分制）', scope: '线下', unit: '分', old: +b.satisfaction.toFixed(2), neu: +m.satisfaction.toFixed(2), type: 'abs' }
    ];
  }

  function changeText(d) {
    if (d.type === 'pct') return signed(pctChange(d.old, d.neu), 1) + '%';
    if (d.type === 'pp') return signed(d.neu - d.old, 1) + ' 个百分点';
    return signed(d.neu - d.old, 2) + ' 分';
  }

  function renderMetrics(data) {
    var defs = metricDefs(data.summary.baseline, data.summary.music);
    document.getElementById('metricGrid').innerHTML = defs.map(function (d) {
      var oldTxt = d.type === 'abs' ? d.old.toFixed(2) : d.old;
      var newTxt = d.type === 'abs' ? d.neu.toFixed(2) : d.neu;
      return '<div class="metric-card">' +
        '<div class="metric-head"><div class="metric-name">' + d.name + '</div>' +
        '<span class="metric-scope">' + d.scope + '</span></div>' +
        '<div class="metric-row"><span>原方案 / 无音乐</span><b class="num-old">' + oldTxt + '</b></div>' +
        '<div class="metric-row"><span>匹配音乐方案</span><b class="num-new">' + newTxt +
        '<i>' + d.unit + '</i></b></div>' +
        '<div class="metric-change"><span class="up">▲</span>' + changeText(d) + '</div>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 图表 ---------------- */
  function renderCharts(data) {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = '#857767';
    Chart.defaults.font.family = "'Noto Sans SC', sans-serif";

    var base = data.daily.baseline, music = data.daily.music;
    var b = data.summary.baseline, m = data.summary.music;
    var labels = base.map(function (d) { return d.date.slice(5); });

    renderTrend(labels, base, music);
    renderFunnel(b, m);
    renderRadar(b, m);
    renderOffline(b, m);
  }

  /* 42 天双组趋势（指标可切换） */
  var TREND_DEFS = [
    { key: 'conv', label: '订单转化率', unit: '%', get: function (d) { return d.conv_rate * 100; } },
    { key: 'stay', label: '平均停留时长', unit: '秒', get: function (d) { return d.avg_stay_sec; } },
    { key: 'aov', label: '线上客单价', unit: '元', get: function (d) { return d.online_aov; } },
    { key: 'ctr', label: '详情点击率', unit: '%', get: function (d) { return d.detail_ctr * 100; } },
    { key: 'pair', label: '搭配率', unit: '%', get: function (d) { return d.pairing_rate * 100; } },
    { key: 'sat', label: '满意度', unit: '分', get: function (d) { return d.satisfaction; } }
  ];

  function renderTrend(labels, base, music) {
    var el = document.getElementById('chartTrend');
    var tabs = document.getElementById('trendTabs');
    if (!el || !tabs) return;
    var current = TREND_DEFS[0];

    var chart = new Chart(el, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: '原方案 / 无音乐', data: base.map(current.get), borderColor: COLOR_BASE,
            backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 5],
            pointRadius: 0, pointHoverRadius: 4, tension: 0.35 },
          { label: '匹配音乐方案', data: music.map(current.get), borderColor: COLOR_MUSIC,
            backgroundColor: COLOR_MUSIC_FILL, borderWidth: 2.5, fill: true,
            pointRadius: 0, pointHoverRadius: 4, tension: 0.35 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 14, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (c) {
                var def = TREND_DEFS.find(function (d) { return d.key === chart.$key; });
                var digits = def && def.key === 'sat' ? 2 : 1;
                return ' ' + c.dataset.label + '：' + c.parsed.y.toFixed(digits) + (def ? def.unit : '');
              }
            }
          }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 10, font: { size: 10 } }, grid: { display: false } },
          y: { title: { display: true, text: current.unit, font: { size: 10 } }, grid: { color: COLOR_GRID } }
        }
      }
    });
    chart.$key = current.key;

    tabs.innerHTML = '';
    TREND_DEFS.forEach(function (def, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chart-tab' + (i === 0 ? ' active' : '');
      btn.textContent = def.label;
      btn.addEventListener('click', function () {
        tabs.querySelectorAll('.chart-tab').forEach(function (t) { t.classList.remove('active'); });
        btn.classList.add('active');
        chart.$key = def.key;
        chart.data.datasets[0].data = base.map(def.get);
        chart.data.datasets[1].data = music.map(def.get);
        chart.options.scales.y.title.text = def.unit;
        chart.update();
      });
      tabs.appendChild(btn);
    });
  }

  /* 访问 → 点击 → 下单 漏斗 */
  function renderFunnel(b, m) {
    var el = document.getElementById('chartFunnel');
    if (!el) return;
    var sums = {
      baseline: [b.visits, b.detail_clicks, b.orders],
      music: [m.visits, m.detail_clicks, m.orders]
    };
    new Chart(el, {
      type: 'bar',
      data: {
        labels: ['线上访问', '商品详情点击', '成功下单'],
        datasets: [
          { label: '原方案 / 无音乐', data: sums.baseline, backgroundColor: COLOR_BASE_FILL, borderRadius: 8 },
          { label: '匹配音乐方案', data: sums.music, backgroundColor: 'rgba(166, 124, 82, .9)', borderRadius: 8 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 14, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (c) {
                return ' ' + c.dataset.label + '：' + c.parsed.x.toLocaleString();
              },
              afterLabel: function (c) {
                var arr = c.datasetIndex === 0 ? sums.baseline : sums.music;
                if (c.dataIndex === 1) return '组内点击率 ' + (arr[1] / arr[0] * 100).toFixed(1) + '%';
                if (c.dataIndex === 2) return '组内转化率 ' + (arr[2] / arr[0] * 100).toFixed(1) + '%';
                return '';
              }
            }
          }
        },
        scales: { x: { grid: { color: COLOR_GRID } }, y: { grid: { display: false } } }
      }
    });
  }

  /* 多维综合雷达（原方案 = 100 指数化） */
  function renderRadar(b, m) {
    var el = document.getElementById('chartRadar');
    if (!el) return;
    var dims = [
      { label: '停留时长', bv: b.avg_stay_sec, mv: m.avg_stay_sec, unit: ' 秒' },
      { label: '点击率', bv: b.detail_ctr * 100, mv: m.detail_ctr * 100, unit: '%' },
      { label: '转化率', bv: b.conv_rate * 100, mv: m.conv_rate * 100, unit: '%' },
      { label: '线上客单', bv: b.online_aov, mv: m.online_aov, unit: ' 元' },
      { label: '线下客单', bv: b.offline_aov, mv: m.offline_aov, unit: ' 元' },
      { label: '搭配率', bv: b.pairing_rate * 100, mv: m.pairing_rate * 100, unit: '%' },
      { label: '非高峰停留', bv: b.offpeak_stay_min, mv: m.offpeak_stay_min, unit: ' 分钟' },
      { label: '满意度', bv: b.satisfaction, mv: m.satisfaction, unit: ' 分' }
    ];
    new Chart(el, {
      type: 'radar',
      data: {
        labels: dims.map(function (d) { return d.label; }),
        datasets: [
          { label: '原方案 / 无音乐', data: dims.map(function () { return 100; }),
            borderColor: COLOR_BASE, backgroundColor: 'rgba(185, 169, 143, .12)',
            borderWidth: 2, borderDash: [6, 5], pointRadius: 2, pointBackgroundColor: COLOR_BASE },
          { label: '匹配音乐方案', data: dims.map(function (d) { return d.mv / d.bv * 100; }),
            borderColor: COLOR_MUSIC, backgroundColor: 'rgba(166, 124, 82, .18)',
            borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: COLOR_MUSIC }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 14, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (c) {
                var d = dims[c.dataIndex];
                var actual = c.datasetIndex === 0 ? d.bv : d.mv;
                var digits = d.label === '满意度' ? 2 : 1;
                return ' ' + c.dataset.label + '：指数 ' + c.parsed.r.toFixed(1) +
                  '（实际 ' + actual.toFixed(digits) + d.unit + '）';
              }
            }
          }
        },
        scales: {
          r: {
            suggestedMin: 90, suggestedMax: 120,
            angleLines: { color: COLOR_GRID }, grid: { color: COLOR_GRID },
            pointLabels: { font: { size: 11 } }, ticks: { display: false }
          }
        }
      }
    });
  }

  /* 线下空间指标柱状对比（原方案 = 100 指数化） */
  function renderOffline(b, m) {
    var el = document.getElementById('chartOffline');
    if (!el) return;
    var dims = [
      { label: '线下日均订单', bv: b.offline_orders / 42, mv: m.offline_orders / 42, unit: ' 单/日' },
      { label: '线下客单价', bv: b.offline_aov, mv: m.offline_aov, unit: ' 元' },
      { label: '非高峰停留', bv: b.offpeak_stay_min, mv: m.offpeak_stay_min, unit: ' 分钟' },
      { label: '饮品甜品搭配率', bv: b.pairing_rate * 100, mv: m.pairing_rate * 100, unit: '%' },
      { label: '顾客满意度', bv: b.satisfaction, mv: m.satisfaction, unit: ' 分' }
    ];
    new Chart(el, {
      type: 'bar',
      data: {
        labels: dims.map(function (d) { return d.label; }),
        datasets: [
          { label: '原方案 / 无音乐（=100）', data: dims.map(function () { return 100; }),
            backgroundColor: COLOR_BASE_FILL, borderRadius: 8 },
          { label: '匹配音乐方案', data: dims.map(function (d) { return d.mv / d.bv * 100; }),
            backgroundColor: 'rgba(166, 124, 82, .9)', borderRadius: 8 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 14, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (c) {
                var d = dims[c.dataIndex];
                var actual = c.datasetIndex === 0 ? d.bv : d.mv;
                var digits = d.label === '顾客满意度' ? 2 : 1;
                return ' ' + c.dataset.label + '：指数 ' + c.parsed.y.toFixed(1) +
                  '（实际 ' + actual.toFixed(digits) + d.unit + '）';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { suggestedMin: 90, suggestedMax: 115, grid: { color: COLOR_GRID },
               title: { display: true, text: '指数（原方案 = 100）', font: { size: 10 } } }
        }
      }
    });
  }

  /* ---------------- 周度汇总表 ---------------- */
  function renderWeekly(data) {
    var base = data.daily.baseline, music = data.daily.music;
    var body = document.getElementById('weeklyBody');
    var foot = document.getElementById('weeklyFoot');
    if (!body) return;

    function mean(arr) { return arr.reduce(function (s, v) { return s + v; }, 0) / (arr.length || 1); }
    function range(arr, i) { return arr.slice(i * 7, i * 7 + 7); }

    var rows = [];
    for (var w = 0; w < 6; w++) {
      var wb = range(base, w), wm = range(music, w);
      if (!wb.length) break;
      var vb = wb.reduce(function (s, d) { return s + d.visits; }, 0);
      var vm = wm.reduce(function (s, d) { return s + d.visits; }, 0);
      var ob = wb.reduce(function (s, d) { return s + d.orders; }, 0);
      var om = wm.reduce(function (s, d) { return s + d.orders; }, 0);
      var cb = ob / vb * 100, cm = om / vm * 100;
      var gain = pctChange(cb, cm);
      rows.push(
        '<tr><td class="week-label">第 ' + (w + 1) + ' 周' +
        '<span class="week-dates">' + wb[0].date.slice(5) + ' – ' + wb[wb.length - 1].date.slice(5) + '</span></td>' +
        '<td>' + (vb + vm).toLocaleString() + '</td>' +
        '<td>' + cb.toFixed(1) + '%<span class="arr">→</span>' + cm.toFixed(1) + '%</td>' +
        '<td>' + mean(wb.map(function (d) { return d.avg_stay_sec; })).toFixed(1) + 's' +
        '<span class="arr">→</span>' + mean(wm.map(function (d) { return d.avg_stay_sec; })).toFixed(1) + 's</td>' +
        '<td>¥' + mean(wb.map(function (d) { return d.online_aov; })).toFixed(1) +
        '<span class="arr">→</span>¥' + mean(wm.map(function (d) { return d.online_aov; })).toFixed(1) + '</td>' +
        '<td>' + mean(wb.map(function (d) { return d.satisfaction; })).toFixed(2) +
        '<span class="arr">→</span>' + mean(wm.map(function (d) { return d.satisfaction; })).toFixed(2) + '</td>' +
        '<td class="delta">▲ ' + signed(gain, 1) + '%</td></tr>'
      );
    }
    body.innerHTML = rows.join('');

    if (foot) {
      var b = data.summary.baseline, m = data.summary.music;
      // 与指标卡口径一致：由取整后的展示值计算变化幅度
      var cb2 = r1(b.conv_rate * 100), cm2 = r1(m.conv_rate * 100);
      foot.innerHTML =
        '<tr><td class="week-label">全程汇总<span class="week-dates">六周整体口径</span></td>' +
        '<td>' + (b.visits + m.visits).toLocaleString() + '</td>' +
        '<td>' + cb2.toFixed(1) + '%<span class="arr">→</span>' + cm2.toFixed(1) + '%</td>' +
        '<td>' + b.avg_stay_sec.toFixed(1) + 's<span class="arr">→</span>' + m.avg_stay_sec.toFixed(1) + 's</td>' +
        '<td>¥' + b.online_aov.toFixed(1) + '<span class="arr">→</span>¥' + m.online_aov.toFixed(1) + '</td>' +
        '<td>' + b.satisfaction.toFixed(2) + '<span class="arr">→</span>' + m.satisfaction.toFixed(2) + '</td>' +
        '<td class="delta">▲ ' + signed(pctChange(cb2, cm2), 1) + '%</td></tr>';
    }
  }

  /* ---------------- 结论 · 证据链 ---------------- */
  function renderConclusion(data) {
    var b = data.summary.baseline, m = data.summary.music;
    var stayOld = r1(b.avg_stay_sec), stayNew = r1(m.avg_stay_sec);
    var ctrOld = r1(b.detail_ctr * 100), ctrNew = r1(m.detail_ctr * 100);
    var pairOld = r1(b.pairing_rate * 100), pairNew = r1(m.pairing_rate * 100);
    var convOld = r1(b.conv_rate * 100), convNew = r1(m.conv_rate * 100);
    var aovOld = r1(b.online_aov), aovNew = r1(m.online_aov);
    var oaovOld = r1(b.offline_aov), oaovNew = r1(m.offline_aov);

    var stayPct = signed(pctChange(stayOld, stayNew), 1) + '%';
    var ctrPp = (ctrNew - ctrOld).toFixed(1);
    var pairPp = (pairNew - pairOld).toFixed(1);
    var convPct = signed(pctChange(convOld, convNew), 1) + '%';
    var aovPct = signed(pctChange(aovOld, aovNew), 1) + '%';
    var oaovPct = signed(pctChange(oaovOld, oaovNew), 1) + '%';

    // 证据链节点
    setText('fStayOld', stayOld.toFixed(1)); setText('fStayNew', stayNew.toFixed(1));
    setText('fStayPct', stayPct);
    setText('fCtrOld', ctrOld.toFixed(1) + '%'); setText('fCtrNew', ctrNew.toFixed(1) + '%');
    setText('fCtrPp', ctrPp + ' 个百分点');
    setText('fPairOld', pairOld.toFixed(1) + '%'); setText('fPairNew', pairNew.toFixed(1) + '%');
    setText('fPairPp', pairPp + ' 个百分点');
    setText('fConvOld', convOld.toFixed(1) + '%'); setText('fConvNew', convNew.toFixed(1) + '%');
    setText('fConvPct', convPct); setText('fAovPct', aovPct);

    // 结论正文
    setText('conclVisits', (b.visits + m.visits).toLocaleString());
    setText('conclOffline', (b.offline_orders + m.offline_orders).toLocaleString());
    setText('cStayPct', stayPct);
    setText('cCtrPp', ctrPp);
    setText('cConvOld', convOld.toFixed(1) + '%'); setText('cConvNew', convNew.toFixed(1) + '%');
    setText('cConvPct', convPct);
    setText('cAovPct', aovPct);
    setText('cOffAovPct', oaovPct);
  }
})();
