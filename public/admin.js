const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const newBtn = document.getElementById('new-product-btn');
const formWrap = document.getElementById('product-form-wrap');
const form = document.getElementById('product-form');
const formTitle = document.getElementById('form-title');
const formError = document.getElementById('form-error');
const formCancel = document.getElementById('form-cancel');
const listEl = document.getElementById('product-list');
const currentImage = form.querySelector('.current-image');

let editingId = null;

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function showLogin() {
  loginView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

function showDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  loadProducts();
}

async function checkAuth() {
  try {
    const { authenticated } = await api('/api/admin/me');
    if (authenticated) showDashboard();
    else showLogin();
  } catch {
    showLogin();
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const password = loginForm.password.value;
  try {
    await api('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    loginForm.reset();
    showDashboard();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch {}
  showLogin();
});

async function loadProducts() {
  listEl.innerHTML = '<p class="loading">加载中…</p>';
  try {
    const products = await api('/api/products');
    if (products.length === 0) {
      listEl.innerHTML = '<p class="empty">暂无产品，点击右上角新增。</p>';
      return;
    }
    listEl.innerHTML = '';
    for (const p of products) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      const priceTag = p.sellable && p.price
        ? `<span class="price-tag">¥${(p.price / 100).toFixed(2)} · 销售中</span>`
        : '<span class="off-tag">未销售</span>';
      row.innerHTML = `
        <div class="admin-row-img"><img src="${escapeHtml(p.image)}" alt="" /></div>
        <div class="admin-row-body">
          <div class="admin-row-title">${escapeHtml(p.name)} ${priceTag}</div>
          <div class="admin-row-desc">${escapeHtml(p.description)}</div>
          <div class="admin-row-meta muted">${p.comment_count} 条评论 · #${p.id}</div>
        </div>
        <div class="admin-row-actions">
          <button type="button" class="link-btn edit">编辑</button>
          <button type="button" class="link-btn delete danger">删除</button>
        </div>
      `;
      row.querySelector('.edit').addEventListener('click', () => openForm(p));
      row.querySelector('.delete').addEventListener('click', () => handleDelete(p));
      listEl.appendChild(row);
    }
  } catch (err) {
    listEl.innerHTML = `<p class="empty">加载失败：${escapeHtml(err.message)}</p>`;
  }
}

function openForm(product = null) {
  editingId = product ? product.id : null;
  formTitle.textContent = product ? `编辑：${product.name}` : '新增产品';
  form.name.value = product?.name || '';
  form.description.value = product?.description || '';
  form.image_url.value = product && !product.image.startsWith('/uploads/') ? product.image : '';
  form.image.value = '';
  form.sellable.checked = !!(product && product.sellable);
  form.price.value = product && product.price != null ? (product.price / 100).toFixed(2) : '';
  if (product) {
    currentImage.classList.remove('hidden');
    currentImage.querySelector('img').src = product.image;
  } else {
    currentImage.classList.add('hidden');
  }
  formError.classList.add('hidden');
  formWrap.classList.remove('hidden');
  form.name.focus();
  formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  formWrap.classList.add('hidden');
  editingId = null;
  form.reset();
  formError.classList.add('hidden');
}

newBtn.addEventListener('click', () => openForm(null));
formCancel.addEventListener('click', closeForm);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');

  const name = form.name.value.trim();
  const description = form.description.value.trim();
  const file = form.image.files?.[0];
  const imageUrl = form.image_url.value.trim();
  const sellable = form.sellable.checked;
  const priceStr = form.price.value.trim();

  if (!name) return showFormError('请填写产品名称');
  if (!description) return showFormError('请填写产品描述');
  if (!editingId && !file && !imageUrl) return showFormError('请上传图片或填写图片链接');
  if (file && file.size > 5 * 1024 * 1024) return showFormError('图片不能超过 5MB');
  if (sellable) {
    const p = Number(priceStr);
    if (!priceStr || !Number.isFinite(p) || p <= 0) return showFormError('开启销售时请填写价格');
  }

  const fd = new FormData();
  fd.append('name', name);
  fd.append('description', description);
  if (file) fd.append('image', file);
  if (imageUrl) fd.append('image_url', imageUrl);
  fd.append('sellable', sellable ? '1' : '0');
  if (priceStr) fd.append('price', priceStr);

  const submitBtn = form.querySelector('.submit-btn');
  submitBtn.disabled = true;
  try {
    if (editingId) {
      await api(`/api/admin/products/${editingId}`, { method: 'PUT', body: fd });
    } else {
      await api('/api/admin/products', { method: 'POST', body: fd });
    }
    closeForm();
    loadProducts();
  } catch (err) {
    showFormError(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

function showFormError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}

const importForm = document.getElementById('import-form');
const importResult = document.getElementById('import-result');
const templateLink = document.getElementById('template-link');

// fetch the template via auth cookie then trigger download (the endpoint requires admin session)
templateLink.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch('/api/admin/products/template.csv', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('需要登录管理员');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products_template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
});

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  importResult.classList.add('hidden');
  const file = importForm.file.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const btn = importForm.querySelector('.submit-btn');
  btn.disabled = true;
  btn.textContent = '导入中…';
  try {
    const r = await api('/api/admin/products/import', { method: 'POST', body: fd });
    importResult.classList.remove('hidden');
    importResult.classList.remove('import-error');
    importResult.innerHTML =
      `<div class="import-summary">
         新增 <b>${r.created}</b> · 更新 <b>${r.updated}</b> · 失败 <b>${r.failed}</b> · 共 ${r.total} 行
       </div>` +
      (r.errors?.length
        ? '<ul class="import-errors">' +
          r.errors.map((e) => `<li>第 ${e.row} 行：${escapeHtml(e.error)}</li>`).join('') +
          '</ul>'
        : '');
    importForm.reset();
    loadProducts();
  } catch (err) {
    importResult.classList.remove('hidden');
    importResult.classList.add('import-error');
    importResult.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '导入';
  }
});

async function handleDelete(p) {
  if (!confirm(`删除产品「${p.name}」？相关评论和上传图片都会一起删掉。`)) return;
  try {
    await api(`/api/admin/products/${p.id}`, { method: 'DELETE' });
    loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

checkAuth();
