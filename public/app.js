const pages = {
  home: '/pages/home.html',
  clients: '/pages/clients.html',
  create: '/pages/create.html',
  assets: '/pages/assets.html',
  generate: '/pages/generate.html',
  history: '/pages/history.html',
};

let currentPage = null;

async function loadPage(pageName) {
  if (!pages[pageName]) return;
  currentPage = pageName;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageName);
  });

  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const res = await fetch(pages[pageName]);
    if (!res.ok) {
      content.innerHTML = '<div class="empty-state">Page unavailable.</div>';
      return;
    }
    const html = await res.text();
    content.innerHTML = html;

    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      const fn = new Function(scriptMatch[1]);
      fn();
    }
  } catch (err) {
    content.innerHTML = '<div class="empty-state">Failed to load page.</div>';
  }
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'));
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    loadPage(el.dataset.page);
  });
});

// Auth check and default page
fetch('/api/me').then(r => {
  if (r.status === 401) { location.href = '/login.html'; return; }
  loadPage('home');
});
