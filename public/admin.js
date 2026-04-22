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
const currentExtras = form.querySelector('.current-extras');
const extrasRow = currentExtras.querySelector('.extras-row');
const currentVideo = form.querySelector('.current-video');
const currentVideoEl = currentVideo.querySelector('video');

const infoEls = {
  image: form.querySelector('.compress-info[data-target="image"]'),
  extra_images: form.querySelector('.compress-info[data-target="extra_images"]'),
  video: form.querySelector('.compress-info[data-target="video"]'),
};

// 压缩后的 File 缓存；submit 时优先用这里的，而不是直接读 input.files
const compressed = { image: null, extra_images: [], video: null };

function setInfo(key, html, level) {
  const el = infoEls[key];
  if (!el) return;
  if (!html) {
    el.classList.add('hidden');
    el.textContent = '';
    el.classList.remove('info-warn', 'info-ok', 'info-error');
    return;
  }
  el.classList.remove('hidden', 'info-warn', 'info-ok', 'info-error');
  if (level) el.classList.add('info-' + level);
  el.innerHTML = html;
}

function clearAllCompressInfo() {
  setInfo('image', null);
  setInfo('extra_images', null);
  setInfo('video', null);
  compressed.image = null;
  compressed.extra_images = [];
  compressed.video = null;
}

function fmtSaving(originalSize, newSize) {
  const { fmtSize } = window.xftUpload;
  if (newSize >= originalSize) return fmtSize(originalSize);
  return `${fmtSize(originalSize)} → <b>${fmtSize(newSize)}</b> (-${Math.round((1 - newSize / originalSize) * 100)}%)`;
}

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

// --- 上传前处理：HEIC 拦截、图片压缩、视频大小警告 ---
form.image.addEventListener('change', async () => {
  const f = form.image.files?.[0];
  compressed.image = null;
  if (!f) return setInfo('image', null);
  setInfo('image', '处理中…');
  try {
    const r = await window.xftUpload.compressImage(f);
    compressed.image = r.file;
    setInfo('image', r.skipped ? `无需压缩（${window.xftUpload.fmtSize(r.originalSize)}）` : fmtSaving(r.originalSize, r.newSize), 'ok');
  } catch (e) {
    if (e.code === 'HEIC') {
      alert(window.xftUpload.HEIC_MSG);
      form.image.value = '';
      setInfo('image', null);
    } else {
      setInfo('image', '处理失败：' + e.message, 'error');
    }
  }
});

form.extra_images.addEventListener('change', async () => {
  const files = Array.from(form.extra_images.files || []);
  compressed.extra_images = [];
  if (!files.length) return setInfo('extra_images', null);
  if (files.length > 4) {
    setInfo('extra_images', `最多 4 张，当前选了 ${files.length} 张`, 'error');
    return;
  }
  setInfo('extra_images', `处理中…（${files.length} 张）`);
  try {
    const results = await window.xftUpload.compressFileList(files);
    compressed.extra_images = results.map((r) => r.file);
    const totalOrig = results.reduce((a, r) => a + r.originalSize, 0);
    const totalNew = results.reduce((a, r) => a + r.newSize, 0);
    setInfo('extra_images', `${files.length} 张 · ` + fmtSaving(totalOrig, totalNew), 'ok');
  } catch (e) {
    if (e.code === 'HEIC') {
      form.extra_images.value = '';
      setInfo('extra_images', null);
    } else {
      setInfo('extra_images', '处理失败：' + e.message, 'error');
    }
  }
});

form.video.addEventListener('change', () => {
  const f = form.video.files?.[0];
  compressed.video = null;
  if (!f) return setInfo('video', null);
  compressed.video = f; // 视频不压缩，直接放原文件
  const r = window.xftUpload.checkVideoSize(f);
  if (r.overLimit) setInfo('video', r.message, 'warn');
  else setInfo('video', `${r.sizeText} · 正常`, 'ok');
});

async function loadCategorySuggestions() {
  const dl = document.getElementById('category-suggestions');
  if (!dl) return;
  try {
    const cats = await api('/api/categories');
    dl.innerHTML = cats.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join('');
  } catch {
    dl.innerHTML = '';
  }
}

async function loadProducts() {
  listEl.innerHTML = '<p class="loading">加载中…</p>';
  try {
    const products = await api('/api/products');
    loadCategorySuggestions();
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
      const catTag = p.category
        ? `<span class="cat-tag">${escapeHtml(p.category)}</span>`
        : '';
      row.innerHTML = `
        <div class="admin-row-img"><img src="${escapeHtml(p.image)}" alt="" /></div>
        <div class="admin-row-body">
          <div class="admin-row-title">${escapeHtml(p.name)} ${catTag}${priceTag}</div>
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
  form.category.value = product?.category || '';
  form.image_url.value = product && !product.image.startsWith('/uploads/') ? product.image : '';
  form.image.value = '';
  form.extra_images.value = '';
  form.video.value = '';
  clearAllCompressInfo();
  form.video_url.value = product && product.video && !product.video.startsWith('/uploads/') ? product.video : '';
  form.remove_extras.checked = false;
  form.remove_video.checked = false;
  form.sellable.checked = !!(product && product.sellable);
  form.price.value = product && product.price != null ? (product.price / 100).toFixed(2) : '';
  if (product) {
    currentImage.classList.remove('hidden');
    currentImage.querySelector('img').src = product.image;
  } else {
    currentImage.classList.add('hidden');
  }
  const extras = Array.isArray(product?.images) ? product.images : [];
  if (extras.length) {
    extrasRow.innerHTML = extras
      .map((url) => `<img src="${escapeHtml(url)}" alt="" />`)
      .join('');
    currentExtras.classList.remove('hidden');
  } else {
    extrasRow.innerHTML = '';
    currentExtras.classList.add('hidden');
  }
  if (product && product.video) {
    currentVideoEl.src = product.video;
    currentVideo.classList.remove('hidden');
  } else {
    currentVideoEl.removeAttribute('src');
    currentVideoEl.load();
    currentVideo.classList.add('hidden');
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
  currentImage.classList.add('hidden');
  currentExtras.classList.add('hidden');
  extrasRow.innerHTML = '';
  currentVideo.classList.add('hidden');
  currentVideoEl.removeAttribute('src');
  currentVideoEl.load();
  clearAllCompressInfo();
  formError.classList.add('hidden');
}

newBtn.addEventListener('click', () => openForm(null));
formCancel.addEventListener('click', closeForm);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');

  const name = form.name.value.trim();
  const description = form.description.value.trim();
  const category = form.category.value.trim();

  // 取最终要上传的文件：优先用 change 事件缓存好的压缩版；若 change 还没跑完就当场补压一次。
  // 保证提交出去的永远是压缩过的版本，避免用户手快点提交导致原图被发上去。
  let file = null;
  const rawImage = form.image.files?.[0];
  if (rawImage) {
    try {
      file = compressed.image || (await window.xftUpload.compressImage(rawImage)).file;
      compressed.image = file;
    } catch (err) {
      if (err.code === 'HEIC') return showFormError('封面图是 HEIC，请先转成 JPG');
      return showFormError('封面图处理失败：' + err.message);
    }
  }
  const imageUrl = form.image_url.value.trim();

  let extraFiles = [];
  const rawExtras = Array.from(form.extra_images.files || []);
  if (rawExtras.length) {
    if (compressed.extra_images.length === rawExtras.length) {
      extraFiles = compressed.extra_images;
    } else {
      try {
        const results = await window.xftUpload.compressFileList(rawExtras);
        extraFiles = results.map((r) => r.file);
        compressed.extra_images = extraFiles;
      } catch (err) {
        if (err.code === 'HEIC') return showFormError('附图里有 HEIC，请先转成 JPG');
        return showFormError('附图处理失败：' + err.message);
      }
    }
  }

  const videoFile = compressed.video || form.video.files?.[0] || null;
  const videoUrl = form.video_url.value.trim();
  const removeExtras = form.remove_extras.checked;
  const removeVideo = form.remove_video.checked;
  const sellable = form.sellable.checked;
  const priceStr = form.price.value.trim();

  if (!name) return showFormError('请填写产品名称');
  if (!description) return showFormError('请填写产品描述');
  if (!editingId && !file && !imageUrl) return showFormError('请上传封面图或填写图片链接');
  if (extraFiles.length > 4) return showFormError('其他图片最多 4 张');
  if (sellable) {
    const p = Number(priceStr);
    if (!priceStr || !Number.isFinite(p) || p <= 0) return showFormError('开启销售时请填写价格');
  }

  const fd = new FormData();
  fd.append('name', name);
  fd.append('description', description);
  fd.append('category', category); // 空串 = 清空分类
  if (file) fd.append('image', file);
  if (imageUrl) fd.append('image_url', imageUrl);
  for (const f of extraFiles) fd.append('extra_images', f);
  if (videoFile) fd.append('video', videoFile);
  if (videoUrl) fd.append('video_url', videoUrl);
  if (removeExtras) fd.append('remove_extras', '1');
  if (removeVideo) fd.append('remove_video', '1');
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
