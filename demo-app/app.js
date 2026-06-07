/**
 * demo-app/app.js — tiny static SaaS flows under test.
 *
 * INTENTIONAL BUG (assignment): checkout tax is not applied to the displayed
 * total. Subtotal is correct; tax rate is 8% but updateTotals() omits tax from
 * #order-total. E2E asserts the correct total so TestRelic AI gets a realistic
 * failure (Expected 108, Received 100) with a real business impact story.
 */
(function () {
  const TAX_RATE = 0.08;

  function qs(sel) {
    return document.querySelector(sel);
  }

  function setDisabled(btn, disabled) {
    if (!btn) return;
    btn.disabled = disabled;
  }

  function initLogin() {
    const email = qs('#email');
    const password = qs('#password');
    const submit = qs('#login-submit');
    const err = qs('#login-error');
    if (!email || !password || !submit) return;

    function validate() {
      const ok = email.value.includes('@') && password.value.length >= 6;
      setDisabled(submit, !ok);
      if (err) err.textContent = '';
    }
    email.addEventListener('input', validate);
    password.addEventListener('input', validate);
    submit.addEventListener('click', () => {
      if (submit.disabled) return;
      window.location.href = 'checkout.html';
    });
    validate();
  }

  function initSignup() {
    const form = qs('#signup-form');
    const msg = qs('#signup-success');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (msg) {
        msg.textContent = 'Account created — you can sign in now.';
        msg.className = 'success';
      }
    });
  }

  function initCheckout() {
    const subtotalEl = qs('#subtotal');
    const taxEl = qs('#tax');
    const totalEl = qs('#order-total');
    const banner = qs('#shipping-banner');
    if (!subtotalEl || !taxEl || !totalEl) return;

    const subtotal = 100;
    const tax = Math.round(subtotal * TAX_RATE);
    // Bug: we compute tax for display but forget to add it to the order total.
    const buggyTotal = subtotal; // should be subtotal + tax

    subtotalEl.textContent = String(subtotal);
    taxEl.textContent = String(tax);
    totalEl.textContent = String(buggyTotal);
    totalEl.dataset.expectedTotal = String(subtotal + tax);

    if (banner && subtotal >= 50) {
      banner.style.display = 'block';
      banner.textContent = 'Free shipping on orders over $50';
    }
  }

  function initSearch() {
    const input = qs('#search-input');
    const results = qs('#search-results');
    if (!input || !results) return;
    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (!q) {
        results.innerHTML = '';
        return;
      }
      results.innerHTML = `<p>Results for <mark>${q}</mark> (demo)</p>`;
    });
  }

  const page = document.body.dataset.page;
  if (page === 'login') initLogin();
  if (page === 'signup') initSignup();
  if (page === 'checkout') initCheckout();
  if (page === 'search') initSearch();
})();
