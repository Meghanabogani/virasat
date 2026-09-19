/* Virasat prototype – frontend logic (no build step) */

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');

const FALLBACK = { lat: 17.385, lng: 78.4867 }; // Hyderabad, used if location is blocked
const state = { pos: null, lastFetchPos: null, sites: [], selected: null, config: { paymentMode: 'demo', platformFeePercent: 0 } };

/* ---------- map ---------- */

const map = L.map('map').setView([FALLBACK.lat, FALLBACK.lng], 11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const pinSvg =
  '<svg viewBox="0 0 26 32" aria-hidden="true"><path d="M13 1C6.4 1 1.5 6 1.5 12.3 1.5 20.6 13 31 13 31s11.5-10.4 11.5-18.7C24.5 6 19.6 1 13 1z" fill="#1b2440"/><circle cx="13" cy="12.5" r="4.5" fill="#fff"/></svg>';
let youMarker = null;
const pins = new Map();

function buildPins() {
  pins.forEach((m) => m.remove());
  pins.clear();
  state.sites.forEach((s) => {
    const icon = L.divIcon({ className: 'pin', html: pinSvg, iconSize: [26, 32], iconAnchor: [13, 31] });
    const m = L.marker([s.lat, s.lng], { icon, title: s.name, keyboard: true }).addTo(map);
    m.on('click', () => openSite(s.id));
    pins.set(s.id, m);
  });
}

function highlightPin(id) {
  pins.forEach((m, key) => m.getElement()?.classList.toggle('active', key === id));
}

/* ---------- live location ---------- */

function movedFar(a, b) {
  if (!a || !b) return true;
  const dLat = (a.lat - b.lat) * 111; // km
  const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng) > 0.2; // refresh list after ~200 m of movement
}

async function setPosition(pos, isReal) {
  const first = !state.pos;
  state.pos = pos;
  $('#locStatus').textContent = isReal ? 'Live location on' : 'Location off, showing Hyderabad';

  if (!youMarker) {
    youMarker = L.marker([pos.lat, pos.lng], {
      icon: L.divIcon({ className: '', html: '<div class="you-dot"></div>', iconSize: [18, 18] }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(map);
  } else {
    youMarker.setLatLng([pos.lat, pos.lng]);
  }

  if (movedFar(pos, state.lastFetchPos)) {
    state.lastFetchPos = pos;
    await loadSites();
  }
  if (first && !state.selected) map.setView([pos.lat, pos.lng], 11);
}

function startLocation() {
  if (!('geolocation' in navigator)) return setPosition(FALLBACK, false);
  $('#locStatus').textContent = 'Finding your location…';
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = navigator.geolocation.watchPosition(
    (p) => { state.real = true; setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }, true); },
    () => { if (!state.pos || !state.real) setPosition(FALLBACK, false); },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

/* ---------- sites ---------- */

async function loadSites() {
  const q = state.pos ? `?lat=${state.pos.lat}&lng=${state.pos.lng}` : '';
  state.sites = await (await fetch('/api/sites' + q)).json();
  if (pins.size === 0) buildPins();
  renderList();
  if (state.selected) highlightPin(state.selected);
}

function renderList() {
  $('#siteList').innerHTML = state.sites
    .map(
      (s) => `<li><button class="site-btn" data-id="${esc(s.id)}">
        <h3>${esc(s.name)}</h3>
        <span class="meta">${esc(s.type)} · ${esc(s.city)}, ${esc(s.state)}</span>
        ${s.distanceKm != null ? `<span class="dist">${s.distanceKm < 10 ? s.distanceKm : Math.round(s.distanceKm)} km</span>` : ''}
      </button></li>`
    )
    .join('');
}

$('#siteList').addEventListener('click', (e) => {
  const btn = e.target.closest('.site-btn');
  if (btn) openSite(btn.dataset.id);
});

/* ---------- site detail ---------- */

async function openSite(id) {
  const site = state.sites.find((s) => s.id === id);
  if (!site) return;
  state.selected = id;
  highlightPin(id);
  map.flyTo([site.lat, site.lng], 15, { duration: 0.8 });

  const guides = await (await fetch('/api/guides?siteId=' + encodeURIComponent(id))).json();
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lng}`;

  $('#detailView').innerHTML = `
    <div class="detail">
      <button class="link back" id="backBtn">Back to all sites</button>
      <h2>${esc(site.name)}</h2>
      <p class="sub">${esc(site.type)}, ${esc(site.era)} · ${esc(site.city)}, ${esc(site.state)}</p>
      <p class="blurb">${esc(site.blurb)}</p>
      <dl class="facts">
        <div><dt>Hours: </dt><dd>${esc(site.hours)}</dd></div>
        <div><dt>Best time: </dt><dd>${esc(site.bestTime)}</dd></div>
        ${site.distanceKm != null ? `<div><dt>From you: </dt><dd>${site.distanceKm} km · <a href="${dir}" target="_blank" rel="noopener">Get directions</a></dd></div>` : ''}
      </dl>
      <p class="hint">Check current timings and tickets before you go.</p>

      <h3>Shots to recreate</h3>
      <p class="hint">Popular photo and reel ideas at this site. Open the tag to see what people are posting.</p>
      <ul class="shots">
        ${site.spots.map((sp) => `<li class="shot">
          <strong>${esc(sp.title)}</strong>
          <div class="when">Best at ${esc(sp.time)}</div>
          <p>${esc(sp.how)}</p>
          <a href="https://www.instagram.com/explore/tags/${encodeURIComponent(site.hashtag)}/" target="_blank" rel="noopener">See #${esc(site.hashtag)} on Instagram</a>
        </li>`).join('')}
      </ul>

      <h3>Local guides</h3>
      <p class="hint">Students who know this place. Paid by the hour, directly to the guide.</p>
      <ul class="guides">
        ${guides.length ? guides.map((g) => `<li class="guide">
          <div class="guide-top">
            <strong>${esc(g.name)}${g.verified ? '<span class="badge">Verified student</span>' : '<span class="badge pending">Verification pending</span>'}</strong>
            <span class="rate">${inr(g.ratePerHour)}/hr</span>
          </div>
          <small>${esc(g.college)} · ${esc(g.languages.join(', '))}${g.rating ? ` · ${g.rating}★ (${g.tripsCompleted} trips)` : ' · New guide'}</small>
          ${g.bio ? `<p>${esc(g.bio)}</p>` : ''}
          <div><button class="btn" data-book="${esc(g.id)}">Book ${esc(g.name.split(' ')[0])}</button></div>
        </li>`).join('') : '<li class="empty">No guides here yet. Be the first to sign up.</li>'}
      </ul>
    </div>`;

  $('#listView').hidden = true;
  $('#detailView').hidden = false;
  $('#scroll').scrollTop = 0;

  $('#backBtn').onclick = closeSite;
  $('#detailView').querySelectorAll('[data-book]').forEach((b) => {
    b.onclick = () => openBooking(guides.find((g) => g.id === b.dataset.book), site);
  });
}

function closeSite() {
  state.selected = null;
  highlightPin(null);
  $('#detailView').hidden = true;
  $('#listView').hidden = false;
  if (state.pos) map.flyTo([state.pos.lat, state.pos.lng], 11, { duration: 0.6 });
}

/* ---------- booking ---------- */

function openBooking(guide, site) {
  const dlg = $('#bookDialog');
  const today = new Date().toISOString().slice(0, 10);
  dlg.innerHTML = `
    <form class="dlg" id="bookForm" method="dialog">
      <h2>Book ${esc(guide.name)}</h2>
      <p class="note">${esc(site.name)} · ${inr(guide.ratePerHour)} per hour</p>
      <label class="field">Your name<input name="visitorName" required maxlength="60" autocomplete="name"></label>
      <div class="row">
        <label class="field">Date<input type="date" name="date" min="${today}" value="${today}" required></label>
        <label class="field">Start time<input type="time" name="time" value="09:00" required></label>
      </div>
      <label class="field">Hours<input type="number" name="hours" min="1" max="8" value="2" required></label>
      <div class="price" id="price"></div>
      <p class="note" id="payNote"></p>
      <p class="error" id="bookError" role="alert"></p>
      <div class="actions">
        <button type="button" class="btn secondary" id="bookCancel">Cancel</button>
        <button type="submit" class="btn" id="payBtn">Pay</button>
      </div>
    </form>`;
  const form = $('#bookForm');

  const fee = state.config.platformFeePercent || 0;
  const update = () => {
    const hrs = Math.min(Math.max(parseInt(form.hours.value, 10) || 1, 1), 8);
    const total = guide.ratePerHour * hrs;
    const cut = Math.round((total * fee) / 100);
    $('#price').innerHTML = `
      <div><span>${hrs} hr × ${inr(guide.ratePerHour)}</span><span>${inr(total)}</span></div>
      ${fee ? `<div><span>Platform fee (${fee}%)</span><span>${inr(cut)}</span></div>` : ''}
      <div class="total"><span>You pay</span><span>${inr(total)}</span></div>
      <div><span>${esc(guide.name.split(' ')[0])} receives</span><span>${inr(total - cut)}</span></div>`;
    $('#payBtn').textContent = `Pay ${inr(total)}`;
  };
  form.hours.addEventListener('input', update);
  update();

  $('#payNote').textContent =
    state.config.paymentMode === 'razorpay'
      ? 'Secure payment by Razorpay. Your guide is paid directly.'
      : 'Demo mode: no real money moves. Add Razorpay test keys to try real checkout.';

  $('#bookCancel').onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    $('#bookError').textContent = '';
    const btn = $('#payBtn');
    btn.disabled = true;
    try {
      const body = {
        guideId: guide.id, siteId: site.id,
        visitorName: form.visitorName.value, date: form.date.value, time: form.time.value,
        hours: parseInt(form.hours.value, 10),
      };
      const r = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not create the booking.');

      if (data.mode === 'razorpay') {
        await payWithRazorpay(data, guide, dlg, site);
      } else {
        const c = await fetch('/api/payments/demo-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: data.booking.id }) });
        const cd = await c.json();
        if (!c.ok) throw new Error(cd.error);
        showBookingSuccess(dlg, cd.booking, guide, site);
      }
    } catch (err) {
      $('#bookError').textContent = err.message;
      btn.disabled = false;
    }
  };
  dlg.showModal();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the payment window.'));
    document.head.appendChild(s);
  });
}

async function payWithRazorpay(data, guide, dlg, site) {
  if (!window.Razorpay) await loadScript('https://checkout.razorpay.com/v1/checkout.js');
  const b = data.booking;
  const rzp = new window.Razorpay({
    key: data.keyId,
    amount: b.total * 100,
    currency: 'INR',
    order_id: b.orderId,
    name: 'Virasat',
    description: `${guide.name} at ${site.name}, ${b.hours} hr`,
    handler: async (resp) => {
      const v = await fetch('/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: b.id, ...resp }) });
      const vd = await v.json();
      if (v.ok) showBookingSuccess(dlg, vd.booking, guide, site);
      else { $('#bookError').textContent = vd.error; $('#payBtn').disabled = false; }
    },
    modal: { ondismiss: () => { $('#payBtn').disabled = false; } },
  });
  rzp.open();
}

function showBookingSuccess(dlg, b, guide, site) {
  dlg.innerHTML = `<div class="dlg success">
    <div class="tick" aria-hidden="true">✓</div>
    <h2>You're booked</h2>
    <p>${esc(guide.name)} will meet you at ${esc(site.name)} on ${esc(b.date)} at ${esc(b.time)} for ${b.hours} hr.</p>
    <p class="note">Booking ${esc(b.id)} · ${inr(b.guidePayout)} goes to ${esc(guide.name.split(' ')[0])}. Meet in a public spot at the entrance.</p>
    <div class="actions"><button class="btn" id="doneBtn">Done</button></div>
  </div>`;
  $('#doneBtn').onclick = () => dlg.close();
}

/* ---------- become a guide ---------- */

$('#becomeGuide').onclick = () => {
  const dlg = $('#guideDialog');
  dlg.innerHTML = `
    <form class="dlg" id="guideForm" method="dialog">
      <h2>Become a local guide</h2>
      <p class="note">For students and gig workers. Set your hourly rate, and visitors pay you directly.</p>
      <label class="field">Full name<input name="name" required maxlength="60"></label>
      <div class="row">
        <label class="field">College or gig platform<input name="college" required maxlength="80"></label>
        <label class="field">City<input name="city" required maxlength="40"></label>
      </div>
      <div class="row">
        <label class="field">Rate per hour (₹)<input type="number" name="ratePerHour" min="100" max="2000" step="10" value="300" required></label>
        <label class="field">Languages<input name="languages" placeholder="English, Hindi, Telugu" required></label>
      </div>
      <div class="field">Sites you can guide at
        <div class="checks">${state.sites.map((s) => `<label><input type="checkbox" name="siteIds" value="${esc(s.id)}"> ${esc(s.name)}</label>`).join('')}</div>
      </div>
      <label class="field">Short intro<textarea name="bio" rows="2" maxlength="240"></textarea></label>
      <label class="field">Payout account ID
        <input name="payoutAccountId" placeholder="Razorpay linked account (acc_…), optional in demo">
      </label>
      <p class="note">Guides start as "Verification pending". A real launch would check a student ID and government ID before showing the verified badge.</p>
      <p class="error" id="guideError" role="alert"></p>
      <div class="actions">
        <button type="button" class="btn secondary" id="guideCancel">Cancel</button>
        <button type="submit" class="btn">Create guide profile</button>
      </div>
    </form>`;
  $('#guideCancel').onclick = () => dlg.close();
  $('#guideForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      name: f.name.value, college: f.college.value, city: f.city.value,
      ratePerHour: Number(f.ratePerHour.value), languages: f.languages.value, bio: f.bio.value,
      payoutAccountId: f.payoutAccountId.value,
      siteIds: [...f.querySelectorAll('input[name=siteIds]:checked')].map((c) => c.value),
    };
    const r = await fetch('/api/guides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) { $('#guideError').textContent = data.error; return; }
    dlg.close();
    if (state.selected && data.siteIds.includes(state.selected)) openSite(state.selected);
  };
  dlg.showModal();
};

$('#relocate').onclick = startLocation;

/* ---------- start ---------- */

(async function init() {
  try { state.config = await (await fetch('/api/config')).json(); } catch { /* keep defaults */ }
  startLocation();
})();
