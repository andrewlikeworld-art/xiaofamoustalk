const app = document.getElementById('app');

const USERNAME_KEY = 'xft.username';
const SORT_KEY = 'xft.sort';

function getUsername() {
  return localStorage.getItem(USERNAME_KEY) || '';
}
function setUsername(name) {
  localStorage.setItem(USERNAME_KEY, name);
}
function getSort() {
  return localStorage.getItem(SORT_KEY) === 'new' ? 'new' : 'hot';
}
function setSort(v) {
  localStorage.setItem(SORT_KEY, v);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function timeAgo(ts) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  const date = new Date(ts * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function firstChar(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

function showLightbox(src) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${src}" alt="" />`;
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

async function renderHome() {
  app.innerHTML = `
    <section class="hero">
      <h1>小有名气 · Talk</h1>
      <p>一个轻巧的产品聊天站——看看我们挑的东西，留下你真实的想法。图片、吐槽、夸奖都欢迎。</p>
    </section>
    <div class="product-grid" id="grid"><div class="loading">加载中…</div></div>
  `;
  try {
    const products = await api('/api/products');
    const grid = document.getElementById('grid');
    if (products.length === 0) {
      grid.innerHTML = '<p class="empty">还没有产品</p>';
      return;
    }
    const tpl = document.getElementById('tpl-product-card');
    grid.innerHTML = '';
    for (const p of products) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.href = `#/product/${p.id}`;
      node.querySelector('img').src = p.image;
      node.querySelector('img').alt = p.name;
      node.querySelector('.product-name').textContent = p.name;
      node.querySelector('.product-desc').textContent = p.description;
      node.querySelector('.meta-comments').textContent = `${p.comment_count} 条评论`;
      if (p.sellable && p.price) {
        const tag = document.createElement('span');
        tag.className = 'card-price';
        tag.textContent = `¥${(p.price / 100).toFixed(2)}`;
        node.querySelector('.product-body').appendChild(tag);
      }
      grid.appendChild(node);
    }
  } catch (err) {
    app.innerHTML = `<p class="empty">加载失败：${escapeHtml(err.message)}</p>`;
  }
}

async function renderAbout() {
  app.innerHTML = `
    <section class="hero">
      <h1>关于 Talk</h1>
      <p>Talk 是 xiaofamous 的实验性评论区。一个产品一页，评论区支持图片、点赞、按热度排序。留下你觉得好玩的那一句话就够了。</p>
    </section>
  `;
}

function attachReplyForm(parentId, commentNode, onSubmitted) {
  const slot = commentNode.querySelector(':scope > .comment-main > .reply-slot');
  if (slot.querySelector('.reply-form')) {
    slot.querySelector('textarea').focus();
    return;
  }
  const tpl = document.getElementById('tpl-reply-form');
  const form = tpl.content.firstElementChild.cloneNode(true);
  slot.appendChild(form);
  const ta = form.querySelector('textarea');
  const err = form.querySelector('.reply-error');
  ta.focus();

  form.querySelector('.reply-cancel').addEventListener('click', () => form.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    const body = ta.value.trim();
    const username = getUsername();
    if (!username) {
      err.textContent = '请先在上方的评论框里填一个昵称';
      err.classList.remove('hidden');
      return;
    }
    if (!body) return;
    const fd = new FormData();
    fd.append('username', username);
    fd.append('body', body);
    fd.append('parent_id', parentId);
    const submit = form.querySelector('.reply-submit');
    submit.disabled = true;
    try {
      const reply = await api(`/api/products/${window.__productId}/comments`, {
        method: 'POST',
        body: fd,
      });
      form.remove();
      onSubmitted(reply);
    } catch (e2) {
      err.textContent = e2.message;
      err.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  });
}

function renderComment(c, { isReply = false } = {}) {
  const tpl = document.getElementById('tpl-comment');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = c.id;
  if (isReply) node.classList.add('is-reply');
  node.querySelector('.comment-avatar').textContent = firstChar(c.username);
  node.querySelector('.comment-user').textContent = c.username;
  node.querySelector('.comment-time').textContent = timeAgo(c.created_at);
  node.querySelector('.comment-time').dateTime = new Date(c.created_at * 1000).toISOString();
  node.querySelector('.comment-body').textContent = c.body;
  if (!c.body) node.querySelector('.comment-body').classList.add('hidden');
  if (c.image) {
    const wrap = node.querySelector('.comment-image-wrap');
    wrap.classList.remove('hidden');
    const img = wrap.querySelector('img');
    img.src = c.image;
    img.addEventListener('click', () => showLightbox(c.image));
  }

  const likeBtn = node.querySelector('.like-btn');
  likeBtn.querySelector('.like-count').textContent = c.likes || 0;
  if (c.liked_by_me) likeBtn.classList.add('liked');
  likeBtn.addEventListener('click', async () => {
    likeBtn.disabled = true;
    try {
      const r = await api(`/api/comments/${c.id}/like`, { method: 'POST' });
      likeBtn.classList.toggle('liked', r.liked);
      likeBtn.querySelector('.like-count').textContent = r.likes;
    } catch (err) {
      console.error(err);
    } finally {
      likeBtn.disabled = false;
    }
  });

  const replyBtn = node.querySelector('.reply-btn');
  const repliesBox = node.querySelector(':scope > .comment-main > .replies');
  replyBtn.addEventListener('click', () => {
    attachReplyForm(c.id, node, (reply) => {
      repliesBox.appendChild(renderComment(reply, { isReply: true }));
      bumpTotal(1);
    });
  });

  const deleteBtn = node.querySelector('.delete-btn');
  if (c.mine) {
    deleteBtn.classList.remove('hidden');
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('确定删除这条评论？')) return;
      deleteBtn.disabled = true;
      try {
        await api(`/api/comments/${c.id}`, { method: 'DELETE' });
        const removed = 1 + (repliesBox ? repliesBox.querySelectorAll('.comment').length : 0);
        node.remove();
        bumpTotal(-removed);
      } catch (err) {
        alert(err.message);
        deleteBtn.disabled = false;
      }
    });
  }

  if (!isReply && Array.isArray(c.replies)) {
    for (const r of c.replies) repliesBox.appendChild(renderComment(r, { isReply: true }));
  }

  return node;
}

function bumpTotal(delta) {
  const el = document.getElementById('comment-total');
  if (!el) return;
  const n = Math.max(0, (Number(el.dataset.n) || 0) + delta);
  el.dataset.n = n;
  el.textContent = n;
}

async function renderProduct(id) {
  app.innerHTML = `<p class="loading">加载中…</p>`;
  window.__productId = id;
  const sort = getSort();
  let data;
  try {
    data = await api(`/api/products/${id}?sort=${sort}`);
  } catch (err) {
    app.innerHTML = `<p class="empty">找不到这个产品：${escapeHtml(err.message)}</p>`;
    return;
  }
  const { product, comments, total } = data;

  const priceBlock = product.sellable && product.price
    ? `<div class="price-block">
         <div class="price-amount">¥<span>${(product.price / 100).toFixed(2)}</span></div>
         <div class="pay-buttons">
           <button class="pay-btn pay-wechat" type="button" data-provider="wechat">
             <span class="pay-icon">💬</span>微信支付
           </button>
           <button class="pay-btn pay-alipay" type="button" data-provider="alipay">
             <span class="pay-icon">💙</span>支付宝
           </button>
         </div>
       </div>`
    : '';

  app.innerHTML = `
    <a class="back-link" href="#/">← 返回全部产品</a>
    <section class="product-page">
      <div class="product-hero-img"><img alt="${escapeHtml(product.name)}" src="${escapeHtml(product.image)}" /></div>
      <div class="product-detail">
        <h1>${escapeHtml(product.name)}</h1>
        <p>${escapeHtml(product.description)}</p>
        ${priceBlock}
      </div>
    </section>

    <section class="comments-section">
      <div class="comments-header">
        <h2>评论 · <span id="comment-total" data-n="${total}">${total}</span></h2>
        <div class="sort-tabs" role="tablist">
          <button type="button" data-sort="hot" class="${sort === 'hot' ? 'active' : ''}">热度</button>
          <button type="button" data-sort="new" class="${sort === 'new' ? 'active' : ''}">最新</button>
        </div>
      </div>

      <form class="comment-form" id="comment-form">
        <input type="text" name="username" placeholder="你的昵称" maxlength="40" required />
        <textarea name="body" placeholder="聊聊你对这件东西的想法…" maxlength="1000"></textarea>
        <div class="form-row">
          <label class="file-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            <span>添加图片</span>
            <input type="file" name="image" accept="image/png,image/jpeg,image/gif,image/webp" />
          </label>
          <div class="file-preview hidden" id="file-preview">
            <img id="file-thumb" alt="" />
            <span id="file-name"></span>
            <button type="button" id="file-clear">移除</button>
          </div>
          <button type="submit" class="submit-btn">发布评论</button>
        </div>
        <p class="form-error hidden" id="form-error"></p>
      </form>

      <div class="comments-list" id="comments-list"></div>
    </section>
  `;

  const list = document.getElementById('comments-list');
  if (comments.length === 0) {
    list.innerHTML = '<p class="empty">还没有评论，来做第一个。</p>';
  } else {
    for (const c of comments) list.appendChild(renderComment(c));
  }

  document.querySelectorAll('.sort-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.sort;
      if (v === getSort()) return;
      setSort(v);
      renderProduct(id);
    });
  });

  const form = document.getElementById('comment-form');
  const usernameInput = form.querySelector('input[name="username"]');
  const bodyInput = form.querySelector('textarea[name="body"]');
  const fileInput = form.querySelector('input[name="image"]');
  const filePreview = document.getElementById('file-preview');
  const fileThumb = document.getElementById('file-thumb');
  const fileName = document.getElementById('file-name');
  const fileClear = document.getElementById('file-clear');
  const errorEl = document.getElementById('form-error');

  usernameInput.value = getUsername();

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) {
      filePreview.classList.add('hidden');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      fileInput.value = '';
      errorEl.textContent = '图片不能超过 5MB';
      errorEl.classList.remove('hidden');
      return;
    }
    fileThumb.src = URL.createObjectURL(f);
    fileName.textContent = f.name;
    filePreview.classList.remove('hidden');
  });

  fileClear.addEventListener('click', () => {
    fileInput.value = '';
    filePreview.classList.add('hidden');
  });

  document.querySelectorAll('.pay-btn').forEach((btn) => {
    btn.addEventListener('click', () => openPayModal(id, btn.dataset.provider));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const username = usernameInput.value.trim();
    const body = bodyInput.value.trim();
    const file = fileInput.files?.[0];
    if (!username) {
      errorEl.textContent = '请填写昵称';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!body && !file) {
      errorEl.textContent = '写点什么或者传张图吧';
      errorEl.classList.remove('hidden');
      return;
    }
    setUsername(username);

    const fd = new FormData();
    fd.append('username', username);
    fd.append('body', body);
    if (file) fd.append('image', file);

    const submitBtn = form.querySelector('.submit-btn');
    submitBtn.disabled = true;
    try {
      const newComment = await api(`/api/products/${id}/comments`, { method: 'POST', body: fd });
      bodyInput.value = '';
      fileInput.value = '';
      filePreview.classList.add('hidden');
      if (list.querySelector('.empty')) list.innerHTML = '';
      newComment.replies = [];
      list.insertBefore(renderComment(newComment), list.firstChild);
      bumpTotal(1);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function openPayModal(productId, provider) {
  const overlay = document.createElement('div');
  overlay.className = 'pay-modal';
  overlay.innerHTML = `
    <div class="pay-modal-card" role="dialog" aria-modal="true">
      <button class="pay-close" type="button" aria-label="关闭">×</button>
      <h3 class="pay-title">${provider === 'alipay' ? '支付宝支付' : '微信支付'}</h3>
      <div class="pay-body">
        <p class="loading">正在生成支付二维码…</p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('.pay-body');
  const close = () => { clearInterval(overlay._poll); overlay.remove(); };
  overlay.querySelector('.pay-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let order;
  try {
    order = await api(`/api/products/${productId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
  } catch (err) {
    body.innerHTML = `<p class="pay-error">下单失败：${escapeHtml(err.message)}</p>`;
    return;
  }

  const amount = (order.amount / 100).toFixed(2);
  const mockHint = order.mode === 'mock'
    ? `<p class="pay-mock-hint">⚠️ 当前为模拟支付模式（未接入真实支付）。扫码或 <a href="${order.mock_url}" target="_blank" rel="noopener">点此模拟支付</a>。</p>`
    : '';
  body.innerHTML = `
    <div class="pay-amount">¥ ${amount}</div>
    <div class="pay-qr-wrap">
      ${order.qr_data_url
        ? `<img class="pay-qr" alt="支付二维码" src="${order.qr_data_url}" />`
        : '<p class="empty">二维码生成失败</p>'}
    </div>
    <p class="pay-tip">${provider === 'alipay' ? '请使用支付宝扫码' : '请使用微信扫码'}支付</p>
    ${mockHint}
    <p class="pay-status muted">订单号：${order.out_trade_no}</p>
    <p class="pay-poll-status muted">正在等待支付…</p>
  `;

  const statusEl = overlay.querySelector('.pay-poll-status');
  let stopped = false;
  overlay._poll = setInterval(async () => {
    if (stopped) return;
    try {
      const s = await api(`/api/orders/${order.out_trade_no}`);
      if (s.status === 'paid') {
        stopped = true;
        clearInterval(overlay._poll);
        body.innerHTML = `
          <div class="pay-success">
            <div class="pay-success-icon">✅</div>
            <div class="pay-success-title">支付成功</div>
            <div class="muted">感谢你的购买 · ¥${amount}</div>
            <button class="submit-btn pay-success-close" type="button">关闭</button>
          </div>`;
        body.querySelector('.pay-success-close').addEventListener('click', close);
      } else if (s.status === 'failed' || s.status === 'canceled') {
        stopped = true;
        clearInterval(overlay._poll);
        statusEl.innerHTML = `<span class="pay-error">支付已${s.status === 'failed' ? '失败' : '取消'}</span>`;
      }
    } catch {}
  }, 2000);
}

function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/product\/(\d+)/);
  if (m) return renderProduct(m[1]);
  if (hash === '#/about') return renderAbout();
  return renderHome();
}

window.addEventListener('hashchange', route);
route();
