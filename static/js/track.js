/* 订单查询 */
(function () {
  var form = document.getElementById('trackForm');
  var box = document.getElementById('trackResult');
  if (!form || !box) return;

  function fmt(n) { return '¥' + Number(n).toFixed(2); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '查询中…';
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_no: form.order_no.value.trim(), phone: form.phone.value.trim() })
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        btn.disabled = false; btn.textContent = '查询订单';
        box.hidden = false;
        if (!res.body.ok) {
          box.innerHTML = '<p class="muted" style="text-align:center">' + esc(res.body.msg || '查询失败') + '</p>';
          return;
        }
        var o = res.body.order;
        var items = o.items.map(function (it) {
          return '<div class="pay-item"><span>' + esc(it.name) + ' × ' + it.qty + '</span><span>' +
                 fmt(it.price * it.qty) + '</span></div>';
        }).join('');
        var timeline = '<div>下单时间：' + esc(o.created_at) + '</div>';
        if (o.paid_at) timeline += '<div>支付时间：' + esc(o.paid_at) + '</div>';
        if (o.confirmed_at) timeline += '<div>发货时间：' + esc(o.confirmed_at) + '</div>';
        var hint = '';
        if (o.status === 'unpaid') hint = '<p class="muted">订单尚未支付，<a href="/pay/' + esc(o.order_no) + '">点击前往支付</a></p>';
        if (o.status === 'pending') hint = '<p class="muted">支付确认中，我们将在核对转账备注后尽快发货。</p>';
        box.innerHTML =
          '<div class="track-status-line"><h3>' + esc(o.order_no) + '</h3>' +
          '<span class="status-pill status-' + esc(o.status) + '">' + esc(o.status_text) + '</span></div>' +
          items +
          '<div class="cart-total-row" style="margin-top:12px"><span>合计</span><strong>' + fmt(o.total) + '</strong></div>' +
          hint +
          '<div class="track-timeline">' + timeline + '</div>';
      }).catch(function () {
        btn.disabled = false; btn.textContent = '查询订单';
        box.hidden = false;
        box.innerHTML = '<p class="muted" style="text-align:center">网络异常，请稍后重试</p>';
      });
  });
})();
