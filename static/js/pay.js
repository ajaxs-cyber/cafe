/* 支付页：30 分钟倒计时 / 复制备注 / 我已支付 */
(function () {
  var cfg = window.PAY_CONFIG || {};

  /* 倒计时 */
  var cd = document.getElementById('countdown');
  var text = document.getElementById('countdownText');
  if (cd && text) {
    var deadline = parseInt(cd.dataset.deadline, 10);
    var timer = setInterval(function () {
      var left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      var m = String(Math.floor(left / 60)).padStart(2, '0');
      var s = String(left % 60).padStart(2, '0');
      text.textContent = m + ':' + s;
      if (left <= 0) {
        clearInterval(timer);
        var btn = document.getElementById('paidBtn');
        if (btn) {
          btn.disabled = true;
          btn.textContent = '订单已超时，请重新下单';
        }
        cd.innerHTML = '订单已超时';
      }
    }, 500);
  }

  /* 复制备注后4位 */
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var val = btn.dataset.copy;
      function done() { btn.textContent = '已复制'; setTimeout(function () { btn.textContent = '复制'; }, 1500); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(done).catch(function () { fallback(); });
      } else { fallback(); }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = val; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  });

  /* 我已支付 */
  var paidBtn = document.getElementById('paidBtn');
  if (paidBtn) {
    paidBtn.addEventListener('click', function () {
      if (!confirm('请确认已完成转账，并在转账备注中填写了订单号后 4 位。是否继续？')) return;
      paidBtn.disabled = true;
      paidBtn.textContent = '正在提交…';
      fetch('/api/orders/' + cfg.orderNo + '/pay', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok) { window.location.reload(); }
          else {
            paidBtn.disabled = false; paidBtn.textContent = '我已支付';
            alert('提交失败，请重试');
          }
        }).catch(function () {
          paidBtn.disabled = false; paidBtn.textContent = '我已支付';
          alert('网络异常，请重试');
        });
    });
  }
})();
