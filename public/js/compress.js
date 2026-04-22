// 上传前端辅助：图片压缩、HEIC 检测、视频尺寸检查
// 挂到 window.xftUpload，保持项目其它脚本那种全局风格（不用模块系统）

(function () {
  const HEIC_MSG =
    'iPhone 的 HEIC 格式浏览器不支持，请先转成 JPG。\n\n' +
    'iPhone 设置方法：设置 → 相机 → 格式 → 选"兼容性最佳"';

  function isHeic(file) {
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    return /\.(heic|heif)$/.test(name) || type.includes('heic') || type.includes('heif');
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  async function loadBitmap(file) {
    // createImageBitmap + imageOrientation:'from-image' 会读 EXIF 旋转，避免 iPhone 竖拍躺下
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
        img.src = url;
      });
    }
  }

  // 压缩策略：
  //   - HEIC/HEIF：抛错（调用方负责弹窗）
  //   - 非图片：抛错
  //   - 宽度 <= maxWidth：保持原文件，不重编码（skipped=true）
  //   - 否则：按比例缩到 maxWidth，输出 JPEG，扩展名改 .jpg
  async function compressImage(file, opts) {
    const maxWidth = (opts && opts.maxWidth) || 1600;
    const quality = (opts && opts.quality) || 0.85;

    if (isHeic(file)) {
      const err = new Error(HEIC_MSG);
      err.code = 'HEIC';
      throw err;
    }
    if (!/^image\//.test(file.type)) {
      throw new Error('不是图片文件：' + (file.type || '未知类型'));
    }

    const bmp = await loadBitmap(file);
    const srcW = bmp.width || bmp.naturalWidth;
    const srcH = bmp.height || bmp.naturalHeight;

    if (srcW <= maxWidth) {
      if (bmp.close) bmp.close();
      return { file, originalSize: file.size, newSize: file.size, skipped: true, width: srcW, height: srcH };
    }

    const scale = maxWidth / srcW;
    const dstW = Math.round(srcW * scale);
    const dstH = Math.round(srcH * scale);
    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, dstW, dstH);
    if (bmp.close) bmp.close();

    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('压缩失败'))), 'image/jpeg', quality)
    );

    const base = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    const out = new File([blob], base + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    return { file: out, originalSize: file.size, newSize: out.size, skipped: false, width: dstW, height: dstH };
  }

  // 视频不压缩，只看大小：>limitMB 返回警告文本（调用方渲染）
  function checkVideoSize(file, limitMB) {
    limitMB = limitMB || 100;
    const mb = file.size / 1024 / 1024;
    if (mb <= limitMB) return { overLimit: false, size: file.size, sizeText: fmtSize(file.size), message: null };
    return {
      overLimit: true,
      size: file.size,
      sizeText: fmtSize(file.size),
      message: `视频 ${mb.toFixed(1)}MB 超过 Cloudflare Tunnel ~${limitMB}MB 上限，建议压缩，或改用局域网直连 http://100.93.5.119:3000/admin 绕过 CF`,
    };
  }

  // 便捷封装：对一个 <input type="file"> 的 change 事件拿到文件列表后，
  // 依次跑 compressImage 并返回 [{file, originalSize, newSize, skipped}, ...]。
  // 若有一个 HEIC，会 alert 并 throw（调用方 catch 即可中断）。
  async function compressFileList(files, opts) {
    const out = [];
    for (const f of files) {
      try {
        out.push(await compressImage(f, opts));
      } catch (e) {
        if (e.code === 'HEIC') {
          alert(HEIC_MSG);
        }
        throw e;
      }
    }
    return out;
  }

  window.xftUpload = { compressImage, compressFileList, checkVideoSize, isHeic, fmtSize, HEIC_MSG };
})();
