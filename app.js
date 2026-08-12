import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCxnA6DM1NT7PTobeR9NAzJrUV5qyPx7qE",
  authDomain: "van-trip-log.firebaseapp.com",
  projectId: "van-trip-log",
  storageBucket: "van-trip-log.firebasestorage.app",
  messagingSenderId: "228942866414",
  appId: "1:228942866414:web:2e3c2765dd286ea40a10ff"
};

const fbApp = initializeApp(firebaseConfig);
let db;
try {
  // Offline persistence needs IndexedDB + the Web Locks API, which some
  // browsers restrict under strict privacy settings — fall back to an
  // in-memory (network-only) Firestore instance rather than breaking the
  // whole script (which would also take the PIN gate down with it).
  db = initializeFirestore(fbApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  console.error('Persistent Firestore cache unavailable, falling back to in-memory cache', err);
  db = getFirestore(fbApp);
}
const campsitesCol = collection(db, "campsites");

function startApp() {
  const MAX_PHOTO_DIM = 900;
  const PHOTO_QUALITY = 0.72;

  /** @type {Array<Object>} */
  let campsites = [];
  let currentRating = 0;
  let currentPhotoDataUrl = null;
  let editingId = null;
  let detailId = null;

  function newId() {
    return doc(campsitesCol).id;
  }

  // ---------- DOM refs ----------

  const grid = document.getElementById('grid');
  const listEl = document.getElementById('list');
  const viewToggle = document.getElementById('viewToggle');
  const emptyState = document.getElementById('emptyState');
  const noResults = document.getElementById('noResults');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const filterRating = document.getElementById('filterRating');
  const filterType = document.getElementById('filterType');

  const VIEW_KEY = 'tripLog.viewMode';
  let viewMode = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';

  const modalOverlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const campsiteForm = document.getElementById('campsiteForm');
  const deleteBtn = document.getElementById('deleteBtn');

  const detailOverlay = document.getElementById('detailOverlay');
  const detailTitle = document.getElementById('detailTitle');
  const detailBody = document.getElementById('detailBody');

  const toast = document.getElementById('toast');

  // ---------- Rendering ----------

  function render() {
    renderStats();
    renderTypeFilter();
    renderResults();
  }

  function renderStats() {
    const count = campsites.length;
    const nights = campsites.reduce((sum, c) => sum + (Number(c.nights) || 0), 0);
    const countries = new Set(campsites.map(c => (c.country || '').trim().toLowerCase()).filter(Boolean)).size;
    const rated = campsites.filter(c => c.rating > 0);
    const avgRating = rated.length ? (rated.reduce((s, c) => s + c.rating, 0) / rated.length).toFixed(1) : '–';

    document.getElementById('statCount').textContent = count;
    document.getElementById('statNights').textContent = nights;
    document.getElementById('statCountries').textContent = countries;
    document.getElementById('statRating').textContent = avgRating;
  }

  function renderTypeFilter() {
    const current = filterType.value;
    const types = Array.from(new Set(campsites.map(c => c.type).filter(Boolean))).sort();
    filterType.innerHTML = '<option value="">All types</option>' +
      types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if (types.includes(current)) filterType.value = current;
  }

  function getFilteredSorted() {
    const q = searchInput.value.trim().toLowerCase();
    const minRating = Number(filterRating.value);
    const type = filterType.value;

    let list = campsites.filter(c => {
      if (minRating && (c.rating || 0) < minRating) return false;
      if (type && c.type !== type) return false;
      if (q) {
        const haystack = [c.name, c.place, c.country, c.notes].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sortMode = sortSelect.value;
    list.sort((a, b) => {
      switch (sortMode) {
        case 'date-asc': return (a.date || '').localeCompare(b.date || '');
        case 'rating-desc': return (b.rating || 0) - (a.rating || 0);
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'date-desc':
        default: return (b.date || '').localeCompare(a.date || '');
      }
    });

    return list;
  }

  function renderResults() {
    const list = getFilteredSorted();
    const hasResults = list.length > 0;

    emptyState.hidden = campsites.length !== 0;
    noResults.hidden = !(campsites.length > 0 && list.length === 0);
    grid.hidden = !(hasResults && viewMode === 'grid');
    listEl.hidden = !(hasResults && viewMode === 'list');

    if (viewMode === 'list') {
      listEl.innerHTML = '';
      for (const c of list) {
        listEl.appendChild(buildRow(c));
      }
    } else {
      grid.innerHTML = '';
      for (const c of list) {
        grid.appendChild(buildCard(c));
      }
    }
  }

  function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem(VIEW_KEY, mode);
    viewToggle.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });
    renderResults();
  }

  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    setViewMode(btn.dataset.view);
  });

  function starString(rating) {
    let out = '';
    for (let i = 1; i <= 5; i++) {
      out += i <= rating ? '★' : '<span class="off">★</span>';
    }
    return out;
  }

  function buildCard(c) {
    const card = document.createElement('div');
    card.className = 'card';
    card.addEventListener('click', () => openDetail(c.id));

    const photoHtml = c.photo
      ? `<img class="card-photo" src="${c.photo}" alt="${escapeHtml(c.name)}">`
      : `<div class="card-photo-placeholder">🏕️</div>`;

    const facilities = (c.facilities || []).slice(0, 3).join(' · ');
    const moreCount = (c.facilities || []).length - 3;

    card.innerHTML = `
      ${photoHtml}
      <div class="card-body">
        <h3 class="card-name">${escapeHtml(c.name)}</h3>
        <p class="card-place">${escapeHtml(c.place || '')}${c.country ? ', ' + escapeHtml(c.country) : ''}</p>
        <div class="card-meta">
          <span class="stars">${starString(c.rating || 0)}</span>
          <span class="badge">${escapeHtml(c.type || 'Campsite')}</span>
        </div>
        <div class="card-meta">
          <span>${c.date ? formatDate(c.date) : 'No date'}</span>
          <span>${c.nights ? c.nights + ' night' + (c.nights == 1 ? '' : 's') : ''}</span>
        </div>
        ${facilities ? `<div class="card-facilities">${escapeHtml(facilities)}${moreCount > 0 ? ` +${moreCount} more` : ''}</div>` : ''}
      </div>
    `;
    return card;
  }

  function buildRow(c) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.addEventListener('click', () => openDetail(c.id));

    const thumbHtml = c.photo
      ? `<img class="list-thumb" src="${c.photo}" alt="${escapeHtml(c.name)}">`
      : `<div class="list-thumb-placeholder">🏕️</div>`;

    row.innerHTML = `
      ${thumbHtml}
      <div class="list-main">
        <div class="list-name">${escapeHtml(c.name)}</div>
        <div class="list-place">${escapeHtml(c.place || '')}${c.country ? ', ' + escapeHtml(c.country) : ''}</div>
      </div>
      <div class="list-meta">
        <span class="stars">${starString(c.rating || 0)}</span>
        <span class="badge">${escapeHtml(c.type || 'Campsite')}</span>
        <span class="list-date">${c.date ? formatDate(c.date) : 'No date'}</span>
      </div>
    `;
    return row;
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return iso;
    }
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, s => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[s]));
  }

  // ---------- Add/Edit modal ----------

  function openAddModal() {
    editingId = null;
    modalTitle.textContent = 'Add campsite';
    deleteBtn.hidden = true;
    campsiteForm.reset();
    document.getElementById('fieldId').value = '';
    document.getElementById('fieldNights').value = '1';
    document.getElementById('fieldType').value = 'Campsite';
    setRating(0);
    clearPhoto();
    campsiteForm.querySelectorAll('.chip input').forEach(cb => cb.checked = false);
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('fieldDate').value = today;
    modalOverlay.hidden = false;
    document.getElementById('fieldName').focus();
  }

  function openEditModal(c) {
    editingId = c.id;
    modalTitle.textContent = 'Edit campsite';
    deleteBtn.hidden = false;
    document.getElementById('fieldId').value = c.id;
    document.getElementById('fieldName').value = c.name || '';
    document.getElementById('fieldPlace').value = c.place || '';
    document.getElementById('fieldCountry').value = c.country || '';
    document.getElementById('fieldDate').value = c.date || '';
    document.getElementById('fieldNights').value = c.nights ?? 1;
    document.getElementById('fieldType').value = c.type || 'Campsite';
    document.getElementById('fieldClub').value = c.club || '';
    document.getElementById('fieldPitch').value = c.pitch || '';
    document.getElementById('fieldCost').value = c.cost || '';
    document.getElementById('fieldNotes').value = c.notes || '';
    setRating(c.rating || 0);
    campsiteForm.querySelectorAll('.chip input').forEach(cb => {
      cb.checked = (c.facilities || []).includes(cb.value);
    });
    if (c.photo) {
      showPhotoPreview(c.photo);
    } else {
      clearPhoto();
    }
    modalOverlay.hidden = false;
  }

  function closeModal() {
    modalOverlay.hidden = true;
  }

  function setRating(n) {
    currentRating = n;
    document.getElementById('fieldRating').value = n;
    document.querySelectorAll('#starPicker .star').forEach(btn => {
      btn.classList.toggle('on', Number(btn.dataset.value) <= n);
    });
  }

  document.getElementById('starPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('.star');
    if (!btn) return;
    const val = Number(btn.dataset.value);
    setRating(val === currentRating ? 0 : val);
  });

  document.getElementById('addBtn').addEventListener('click', openAddModal);
  document.getElementById('emptyAddBtn').addEventListener('click', openAddModal);
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

  // ---------- Photo handling ----------

  document.getElementById('fieldPhoto').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, MAX_PHOTO_DIM, PHOTO_QUALITY);
      showPhotoPreview(dataUrl);
    } catch (err) {
      console.error(err);
      showToast('Could not read that image');
    }
  });

  document.getElementById('removePhotoBtn').addEventListener('click', () => {
    clearPhoto();
    document.getElementById('fieldPhoto').value = '';
  });

  function showPhotoPreview(dataUrl) {
    currentPhotoDataUrl = dataUrl;
    document.getElementById('photoPreview').src = dataUrl;
    document.getElementById('photoPreviewWrap').hidden = false;
  }

  function clearPhoto() {
    currentPhotoDataUrl = null;
    document.getElementById('photoPreviewWrap').hidden = true;
    document.getElementById('photoPreview').src = '';
  }

  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round(height * (maxDim / width));
              width = maxDim;
            } else {
              width = Math.round(width * (maxDim / height));
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- Form submit / delete ----------

  campsiteForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const facilities = Array.from(campsiteForm.querySelectorAll('.chip input:checked')).map(cb => cb.value);

    const id = editingId || newId();
    const data = {
      name: document.getElementById('fieldName').value.trim(),
      place: document.getElementById('fieldPlace').value.trim(),
      country: document.getElementById('fieldCountry').value.trim(),
      date: document.getElementById('fieldDate').value,
      nights: Number(document.getElementById('fieldNights').value) || 0,
      type: document.getElementById('fieldType').value,
      club: document.getElementById('fieldClub').value,
      pitch: document.getElementById('fieldPitch').value,
      cost: document.getElementById('fieldCost').value.trim(),
      rating: currentRating,
      facilities,
      notes: document.getElementById('fieldNotes').value.trim(),
      photo: currentPhotoDataUrl,
    };

    if (!data.name || !data.place) return;

    const wasEditing = !!editingId;
    closeModal();

    try {
      await setDoc(doc(campsitesCol, id), data);
      showToast(wasEditing ? 'Campsite updated' : 'Campsite added');
    } catch (err) {
      console.error(err);
      showToast('Could not save — check your connection');
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('Delete this campsite from your log?')) return;
    const id = editingId;
    closeModal();
    try {
      await deleteDoc(doc(campsitesCol, id));
      showToast('Campsite deleted');
    } catch (err) {
      console.error(err);
      showToast('Could not delete — check your connection');
    }
  });

  // ---------- Detail view ----------

  function openDetail(id) {
    const c = campsites.find(x => x.id === id);
    if (!c) return;
    detailId = id;
    detailTitle.textContent = c.name;

    const mapQuery = [c.name, c.place, c.country].filter(Boolean).join(', ');
    const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQuery);

    detailBody.innerHTML = `
      ${c.photo ? `<img class="detail-photo" src="${c.photo}" alt="${escapeHtml(c.name)}">` : ''}
      <div class="stars" style="font-size:1.1rem;margin-bottom:10px;">${starString(c.rating || 0)}</div>
      <div class="detail-grid">
        <div>
          <div class="detail-field-label">Location</div>
          <div class="detail-field-value">${escapeHtml(c.place || '–')}${c.country ? ', ' + escapeHtml(c.country) : ''}</div>
        </div>
        <div>
          <div class="detail-field-label">Type</div>
          <div class="detail-field-value">${escapeHtml(c.type || '–')}</div>
        </div>
        <div>
          <div class="detail-field-label">Date visited</div>
          <div class="detail-field-value">${c.date ? formatDate(c.date) : '–'}</div>
        </div>
        <div>
          <div class="detail-field-label">Nights stayed</div>
          <div class="detail-field-value">${c.nights ?? '–'}</div>
        </div>
        <div>
          <div class="detail-field-label">Cost per night</div>
          <div class="detail-field-value">${escapeHtml(c.cost || '–')}</div>
        </div>
        <div>
          <div class="detail-field-label">Club site</div>
          <div class="detail-field-value">${escapeHtml(c.club || '–')}</div>
        </div>
        <div>
          <div class="detail-field-label">Pitch type</div>
          <div class="detail-field-value">${escapeHtml(c.pitch || '–')}</div>
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <a class="map-link" target="_blank" rel="noopener" href="${mapUrl}">📍 Open in Google Maps</a>
      </div>
      ${(c.facilities || []).length ? `
        <div class="detail-field-label">Facilities</div>
        <div class="detail-facilities">${c.facilities.map(f => `<span class="badge">${escapeHtml(f)}</span>`).join('')}</div>
      ` : ''}
      ${c.notes ? `
        <div class="detail-field-label" style="margin-top:14px;">Notes</div>
        <div class="detail-notes">${escapeHtml(c.notes)}</div>
      ` : ''}
    `;

    detailOverlay.hidden = false;
  }

  function closeDetail() {
    detailOverlay.hidden = true;
    detailId = null;
  }

  document.getElementById('closeDetailBtn').addEventListener('click', closeDetail);
  document.getElementById('detailCloseBtn').addEventListener('click', closeDetail);
  detailOverlay.addEventListener('click', (e) => { if (e.target === detailOverlay) closeDetail(); });

  document.getElementById('detailEditBtn').addEventListener('click', () => {
    const c = campsites.find(x => x.id === detailId);
    if (!c) return;
    closeDetail();
    openEditModal(c);
  });

  // ---------- Search / filter / sort ----------

  searchInput.addEventListener('input', renderResults);
  sortSelect.addEventListener('change', renderResults);
  filterRating.addEventListener('change', renderResults);
  filterType.addEventListener('change', renderResults);

  // ---------- Export / Import ----------

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(campsites, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `trip-log-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error('Invalid file format');
        const existingIds = new Set(campsites.map(c => c.id));
        let added = 0;
        for (const item of imported) {
          if (!item || typeof item !== 'object' || !item.name) continue;
          const id = (item.id && !existingIds.has(item.id)) ? item.id : newId();
          const { id: _drop, ...rest } = item;
          await setDoc(doc(campsitesCol, id), rest);
          existingIds.add(id);
          added++;
        }
        showToast(`Imported ${added} campsite${added === 1 ? '' : 's'}`);
      } catch (err) {
        console.error(err);
        showToast('Could not import that file');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  // ---------- Toast ----------

  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
  }

  // ---------- Keyboard ----------

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modalOverlay.hidden) closeModal();
      if (!detailOverlay.hidden) closeDetail();
    }
  });

  // ---------- Init ----------

  viewToggle.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewMode);
  });

  render();

  onSnapshot(campsitesCol, (snapshot) => {
    campsites = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error('Firestore sync error', err);
    showToast('Sync error — check your connection');
  });
}

// ---------- PIN gate ----------

const PIN_HASH = 'ae600959378c54c51d1b867e77cef34eba55658bf2abcec187cfe901526d0a80';
const UNLOCK_KEY = 'tripLog.unlocked';

async function hashPin(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function unlockApp() {
  document.getElementById('lockOverlay').hidden = true;
  document.getElementById('appRoot').hidden = false;
  startApp();
}

if (localStorage.getItem(UNLOCK_KEY) === 'true') {
  unlockApp();
} else {
  const lockForm = document.getElementById('lockForm');
  const lockPin = document.getElementById('lockPin');
  const lockError = document.getElementById('lockError');
  const lockCard = document.querySelector('.lock-card');

  lockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hash = await hashPin(lockPin.value.trim());
    if (hash === PIN_HASH) {
      localStorage.setItem(UNLOCK_KEY, 'true');
      unlockApp();
    } else {
      lockError.hidden = false;
      lockCard.classList.remove('shake');
      void lockCard.offsetWidth;
      lockCard.classList.add('shake');
      lockPin.value = '';
      lockPin.focus();
    }
  });
}
