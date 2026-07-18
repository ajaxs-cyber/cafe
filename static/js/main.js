/* 购物袋（localStorage）+ 结算下单 */
(function () {
  var KEY = 'heypour_cart';

  function readCart() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function saveCart(cart) {
    localStorage.setItem(KEY, JSON.stringify(cart));
    renderCart();
  }
  function cartCount(cart) {
    return cart.reduce(function (s, it) { return s + it.qty; }, 0);
  }
  function cartTotal(cart) {
    return cart.reduce(function (s, it) { return s + it.qty * it.price; }, 0);
  }
  function fmt(n) { return '¥' + n.toFixed(2); }

  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  /* ---- 渲染抽屉 ---- */
  var drawer = document.getElementById('cartDrawer');
  var mask = document.getElementById('drawerMask');
  var itemsBox = document.getElementById('cartItems');
  var totalEl = document.getElementById('cartTotal');
  var countEl = document.getElementById('cartCount');

  function renderCart() {
    var cart = readCart();
    if (countEl) countEl.textContent = cartCount(cart);
    if (totalEl) totalEl.textContent = fmt(cartTotal(cart));
    if (!itemsBox) return;
    if (!cart.length) {
      itemsBox.innerHTML = '<div class="cart-empty">购物袋还是空的，<br>去挑一杯喜欢的咖啡吧。</div>';
      return;
    }
    itemsBox.innerHTML = cart.map(function (it, i) {
      return '<div class="cart-row">' +
        '<img src="' + it.img + '" alt="">' +
        '<div class="cart-row-info"><div class="cart-row-name">' + it.name + '</div>' +
        '<div class="cart-row-price">' + fmt(it.price) + '</div></div>' +
        '<div class="qty-ctrl">' +
        '<button type="button" data-dec="' + i + '">−</button>' +
        '<span>' + it.qty + '</span>' +
        '<button type="button" data-inc="' + i + '">＋</button>' +
        '</div></div>';
    }).join('');
  }

  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add-to-cart]');
    if (add) {
      var cart = readCart();
      var found = cart.find(function (it) { return it.id === add.dataset.id; });
      if (found) { found.qty += 1; }
      else {
        cart.push({ id: add.dataset.id, name: add.dataset.name,
                    price: parseFloat(add.dataset.price), img: add.dataset.img, qty: 1 });
      }
      saveCart(cart);
      toast('已加入购物袋');
      return;
    }
    var inc = e.target.closest('[data-inc]');
    if (inc) {
      var c1 = readCart(); c1[+inc.dataset.inc].qty += 1; saveCart(c1); return;
    }
    var dec = e.target.closest('[data-dec]');
    if (dec) {
      var c2 = readCart(); var it = c2[+dec.dataset.dec];
      it.qty -= 1;
      if (it.qty <= 0) c2.splice(+dec.dataset.dec, 1);
      saveCart(c2); return;
    }
  });

  function openDrawer() { if (drawer) { drawer.classList.add('show'); mask.classList.add('show'); } }
  function closeDrawer() { if (drawer) { drawer.classList.remove('show'); mask.classList.remove('show'); } }

  var openBtn = document.getElementById('cartOpenBtn');
  var closeBtn = document.getElementById('cartCloseBtn');
  if (openBtn) openBtn.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (mask) mask.addEventListener('click', closeDrawer);

  /* ---- 移动端导航 ---- */
  var navToggle = document.getElementById('navToggle');
  var siteNav = document.getElementById('siteNav');
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () { siteNav.classList.toggle('open'); });
  }

  /* ---- 结算 ---- */
  var checkoutMask = document.getElementById('checkoutMask');
  var checkoutBtn = document.getElementById('checkoutBtn');
  var checkoutClose = document.getElementById('checkoutClose');
  var checkoutItems = document.getElementById('checkoutItems');
  var checkoutTotal = document.getElementById('checkoutTotal');
  var form = document.getElementById('checkoutForm');

  function openCheckout() {
    var cart = readCart();
    if (!cart.length) { toast('购物袋是空的'); return; }
    closeDrawer();
    if (!checkoutMask) return;
    checkoutItems.innerHTML = cart.map(function (it) {
      return '<div class="pay-item"><span>' + it.name + ' × ' + it.qty + '</span><span>' +
             fmt(it.price * it.qty) + '</span></div>';
    }).join('');
    checkoutTotal.textContent = fmt(cartTotal(cart));
    checkoutMask.classList.add('show');
  }
  function closeCheckout() { if (checkoutMask) checkoutMask.classList.remove('show'); }

  if (checkoutBtn) checkoutBtn.addEventListener('click', openCheckout);
  if (checkoutClose) checkoutClose.addEventListener('click', closeCheckout);
  if (checkoutMask) {
    checkoutMask.addEventListener('click', function (e) {
      if (e.target === checkoutMask) closeCheckout();
    });
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var cart = readCart();
      if (!cart.length) { toast('购物袋是空的'); return; }
      var btn = document.getElementById('submitOrderBtn');
      btn.disabled = true; btn.textContent = '正在提交…';
      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.value.trim(),
          phone: form.phone.value.trim(),
          address: form.address.value.trim(),
          items: cart.map(function (it) { return { id: it.id, qty: it.qty }; })
        })
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (res) {
          if (res.body.ok) {
            localStorage.removeItem(KEY);
            window.location.href = res.body.pay_url;
          } else {
            toast(res.body.msg || '下单失败，请重试');
            btn.disabled = false; btn.textContent = '提交订单';
          }
        }).catch(function () {
          toast('网络异常，请稍后重试');
          btn.disabled = false; btn.textContent = '提交订单';
        });
    });
  }

  renderCart();
})();
